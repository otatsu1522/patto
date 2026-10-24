import { SYNC } from '@/config/limits';
import { mergeRecords } from '@/domain/merge';
import { fromRemoteRow, TABLE_NAMES, toRemoteRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import type { RemoteApi, SyncResult } from './types';
import {
  flushPendingRemoteDeleteAllBeforePush,
  flushPendingRemoteDeletes,
  pendingRemoteProjectDeleteIds,
  reconcilePreparedRemoteDeleteAll,
} from './pendingDeletes';
import { DAY_MS } from '@/lib/dates';
import { RESET_GENERATION_META_KEY } from './resetGeneration';

/** エンジンが必要とする端末側の入出力（ストアとDBへの橋渡し）。 */
export interface LocalPort {
  snapshot(): Snapshot;
  apply(
    changes: Partial<Record<TableName, AnyRecord[]>>,
    removed: { table: TableName; ids: string[] }[],
  ): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Pull の全ページ処理が終わった後に一度だけ実行する。 */
  afterSync?(): Promise<void>;
}

export interface SyncOptions {
  /** この同期で固定したアカウントID（保留削除を同じ所有者に限定する）。 */
  ownerId: string;
  /** ごみ箱の自動削除（保持日数）。null なら行わない */
  trashRetentionDays: number | null;
  now: () => number;
  /** 同期専用時計を補正し、必要な場合だけアプリ全体の時計へ反映する。 */
  onServerTime?: (serverNow: number) => void;
}

const rowsOf = (snap: Snapshot, table: TableName): AnyRecord[] =>
  table === 'projects' ? snap.projects : table === 'kanban_columns' ? snap.columns : snap.tasks;

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// v2 starts from zero once after the commit-order fix, so rows skipped by an older cursor are re-read.
const cursorKey = (table: TableName) => `cursor:v2:${table}`;

/** 同期開始時のローカルレコードと、完了時点のレコードが同一か確認する。 */
function sameRecordSnapshot(a: AnyRecord, b: AnyRecord): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        JSON.stringify(left[key]) === JSON.stringify(right[key]),
    )
  );
}

/**
 * 同期の本体: Push（未送信を送る）→ Pull（新しい変更を受け取る）→ 後片付け。
 * 競合は項目単位の最終更新優先でマージする（domain/merge.ts）。
 * 送信は id 基準の upsert なので、途中で失敗して再実行しても二重適用にならない。
 */
export async function runSync(
  remote: RemoteApi,
  local: LocalPort,
  opts: SyncOptions,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, purged: 0 };
  const initialSnapshot = local.snapshot();
  await reconcilePreparedRemoteDeleteAll(opts.ownerId, {
    projects: initialSnapshot.projects.map((record) => record.id),
    kanban_columns: initialSnapshot.columns.map((record) => record.id),
    tasks: initialSnapshot.tasks.map((record) => record.id),
  });
  // A confirmed reset clears old server data before Push. New records created afterward remain local
  // and are then uploaded; processing reset after Push would accidentally delete those new records.
  const resetAppliedHere = await flushPendingRemoteDeleteAllBeforePush(
    remote,
    opts.ownerId,
    async (generation) => {
      await local.setMeta(RESET_GENERATION_META_KEY, String(generation));
      for (const table of TABLE_NAMES) await local.setMeta(cursorKey(table), '0');
    },
  );

  if (resetAppliedHere === null) {
    const remoteGeneration = await remote.getAccountResetGeneration(opts.ownerId);
    const storedGenerationRaw = await local.getMeta(RESET_GENERATION_META_KEY);
    const storedGeneration = storedGenerationRaw === null ? null : Number(storedGenerationRaw);
    const snapshot = local.snapshot();
    const hasLocalRows = TABLE_NAMES.some((table) => rowsOf(snapshot, table).length > 0);
    const generationChanged =
      storedGeneration === null
        ? remoteGeneration > 0 && hasLocalRows
        : !Number.isSafeInteger(storedGeneration) || storedGeneration !== remoteGeneration;

    if (generationChanged) {
      // 別端末が全データをリセットしていた。古い dirty 行も Push せず、先にローカルから除去する。
      await local.apply(
        {},
        TABLE_NAMES.map((table) => ({
          table,
          ids: rowsOf(snapshot, table).map((record) => record.id),
        })),
      );
      for (const table of TABLE_NAMES) await local.setMeta(cursorKey(table), '0');
    }
    await local.setMeta(RESET_GENERATION_META_KEY, String(remoteGeneration));
  }

  // dirty 行の再 Push 前に、物理削除済みの自身・親レコードを確認する。
  // 普段は dirty 行がある同期時だけ実行し、通常の Pull の通信量を増やさない。
  const beforeDeleteCheck = local.snapshot();
  const dirtyProjects = beforeDeleteCheck.projects.filter((record) => record.dirty);
  const dirtyColumns = beforeDeleteCheck.columns.filter((record) => record.dirty);
  const dirtyTasks = beforeDeleteCheck.tasks.filter((record) => record.dirty);
  const hasDirtyRows = dirtyProjects.length + dirtyColumns.length + dirtyTasks.length > 0;
  const deletedBeforePush: Record<TableName, Set<string>> = {
    projects: new Set<string>(),
    kanban_columns: new Set<string>(),
    tasks: new Set<string>(),
  };
  if (hasDirtyRows) {
    const candidatesByTable: Record<TableName, string[]> = {
      projects: [
        ...new Set([
          ...beforeDeleteCheck.projects.map((record) => record.id),
          ...dirtyColumns.map((record) => record.projectId),
          ...dirtyTasks.map((record) => record.projectId),
        ]),
      ],
      kanban_columns: [
        ...new Set([
          ...beforeDeleteCheck.columns.map((record) => record.id),
          ...dirtyTasks.map((record) => record.columnId),
        ]),
      ],
      tasks: [...new Set(dirtyTasks.map((record) => record.id))],
    };
    for (const table of TABLE_NAMES) {
      const candidates = candidatesByTable[table];
      if (candidates.length === 0) continue;
      const deletedIds = await remote.fetchDeletedIds(table, candidates);
      for (const id of deletedIds) deletedBeforePush[table].add(id);
    }
  }
  const deletedProjects = deletedBeforePush.projects;
  const deletedColumns = deletedBeforePush.kanban_columns;
  if (deletedProjects.size > 0) {
    for (const column of beforeDeleteCheck.columns) {
      if (deletedProjects.has(column.projectId)) deletedBeforePush.kanban_columns.add(column.id);
    }
    for (const task of beforeDeleteCheck.tasks) {
      if (deletedProjects.has(task.projectId)) deletedBeforePush.tasks.add(task.id);
    }
  }
  if (deletedColumns.size > 0) {
    for (const task of beforeDeleteCheck.tasks) {
      if (deletedColumns.has(task.columnId)) deletedBeforePush.tasks.add(task.id);
    }
  }
  const deletedBeforePushRemovals = TABLE_NAMES.map((table) => ({
    table,
    ids: [...deletedBeforePush[table]],
  }));
  if (deletedBeforePushRemovals.some((item) => item.ids.length > 0)) {
    await local.apply({}, deletedBeforePushRemovals);
  }

  // プロジェクト削除の要求が保存済みなら、その配下の dirty 行を先にPushしない。
  // アプリ中断中に別端末で復元されていた場合、古い削除状態で復元を上書きしないため。
  const pendingProjectDeleteSet = new Set(await pendingRemoteProjectDeleteIds(opts.ownerId));
  const serverNow = await remote.serverTime();
  opts.onServerTime?.(serverNow);

  // ---- Push ----
  for (const table of TABLE_NAMES) {
    const dirty = rowsOf(local.snapshot(), table).filter((record) => {
      if (!record.dirty) return false;
      const projectId =
        table === 'projects'
          ? record.id
          : String((record as { projectId?: unknown }).projectId ?? '');
      return !pendingProjectDeleteSet.has(projectId);
    });
    if (dirty.length === 0) continue;
    // 同期開始時のレコードを保持し、送信中に更新された行を更新時刻だけで判定しない。
    const dirtySnapshotById = new Map(dirty.map((record) => [record.id, record]));
    const toPush: AnyRecord[] = [];
    const toStore: AnyRecord[] = [];
    for (const part of chunk(dirty, SYNC.dirtyBatchSize)) {
      const remoteRows = await remote.fetchByIds(
        table,
        part.map((r) => r.id),
      );
      const remoteMap = new Map(
        remoteRows.map((r) => [String(r.id), fromRemoteRow<AnyRecord>(table, r)]),
      );
      for (const rec of part) {
        const theirs = remoteMap.get(rec.id);
        if (!theirs) {
          toPush.push(rec);
          toStore.push({ ...rec, dirty: false });
          continue;
        }
        const { merged, differsFromRemote } = mergeRecords(table, rec, theirs);
        if (differsFromRemote) toPush.push(merged);
        toStore.push({ ...merged, dirty: false });
      }
    }
    for (const part of chunk(toPush, SYNC.pushBatchSize)) {
      await remote.upsert(
        table,
        part.map((r) => toRemoteRow(table, r)),
      );
      // 全バッチの送信が成功してからローカル状態を更新する。失敗時は dirty のまま再試行できる。
    }
    result.pushed += toPush.length;
    // 同期開始後に編集された行は未同期のまま残す。同じミリ秒内の更新でも
    // updatedAt が一致することがあるため、時刻だけで clean にしてはいけない。
    // すでにローカルから消えた行も、送信結果で再作成しない。
    const current = new Map(rowsOf(local.snapshot(), table).map((r) => [r.id, r]));
    const settled = toStore.filter((record) => {
      const now = current.get(record.id);
      const original = dirtySnapshotById.get(record.id);
      return !!now && !!original && sameRecordSnapshot(now, original);
    });
    await local.apply({ [table]: settled }, []);
  }

  // 削除要求は Push の後に処理する。削除要求を保存した直後にアプリが中断し、
  // ローカル削除だけが未完了だった場合でも、古い dirty レコードを送った後で確実に削除する。
  // サーバー削除とローカル削除が両方成功した後にだけ、キューを確定して消す。
  const pendingDeletes = await flushPendingRemoteDeletes(remote, opts.ownerId, true);
  // 別端末で復元済みだったプロジェクトは pendingDeletes.deletedProjectIds に含まれない。
  // Pull は続けて行うため、復元後のサーバーレコードをローカルへ取り込める。
  const beforePendingPurge = local.snapshot();
  const removalsByTable: Record<TableName, Set<string>> = {
    projects: new Set<string>(),
    kanban_columns: new Set<string>(),
    tasks: new Set<string>(),
  };
  if (pendingDeletes.deleteAllLocal) {
    for (const table of TABLE_NAMES) {
      for (const record of rowsOf(beforePendingPurge, table)) {
        removalsByTable[table].add(record.id);
      }
    }
  } else {
    for (const table of pendingDeletes.clearLocalTables) {
      for (const record of rowsOf(beforePendingPurge, table)) removalsByTable[table].add(record.id);
    }
    const projectIds = new Set(pendingDeletes.deletedProjectIds);
    for (const id of projectIds) removalsByTable.projects.add(id);
    for (const column of beforePendingPurge.columns) {
      if (projectIds.has(column.projectId)) removalsByTable.kanban_columns.add(column.id);
    }
    for (const task of beforePendingPurge.tasks) {
      if (projectIds.has(task.projectId)) removalsByTable.tasks.add(task.id);
    }
    for (const table of TABLE_NAMES) {
      for (const id of pendingDeletes.deletedIds[table] ?? []) removalsByTable[table].add(id);
      const cutoff = pendingDeletes.expiredTrashBefore[table];
      if (cutoff === undefined) continue;
      for (const record of rowsOf(beforePendingPurge, table)) {
        if (record.deletedAt !== null && record.deletedAt < cutoff)
          removalsByTable[table].add(record.id);
      }
    }
  }
  const pendingRemovals = TABLE_NAMES.map((table) => ({
    table,
    ids: [...removalsByTable[table]],
  }));
  const pendingPurged = pendingRemovals.reduce((sum, item) => sum + item.ids.length, 0);
  if (pendingPurged > 0) await local.apply({}, pendingRemovals);
  if (pendingDeletes.resetGeneration !== undefined) {
    await local.setMeta(RESET_GENERATION_META_KEY, String(pendingDeletes.resetGeneration));
    for (const table of TABLE_NAMES) await local.setMeta(cursorKey(table), '0');
  }
  await pendingDeletes.complete();
  result.purged += pendingPurged;

  // ---- Pull ----
  for (const table of TABLE_NAMES) {
    let cursor = Number((await local.getMeta(cursorKey(table))) ?? 0);
    // tasks では非表示レコードを通常のPull結果から除外するため、今回の差分範囲の上限を固定する。
    // その範囲の表示対象差分を処理し終えたら、非表示だけの末尾を毎回検索し直さないようカーソルを進める。
    const upperBound = table === 'tasks' ? await remote.latestServerSeq(table) : undefined;
    if (upperBound !== undefined && upperBound <= cursor) continue;

    for (;;) {
      const includeVisibleIds =
        table === 'tasks'
          ? local
              .snapshot()
              .tasks.filter((task) => task.deletedAt === null && task.archivedAt === null)
              .map((task) => task.id)
          : undefined;
      const rows = await remote.fetchSince(
        table,
        cursor,
        SYNC.pageSize,
        includeVisibleIds,
        upperBound,
      );
      if (rows.length === 0) {
        if (upperBound !== undefined && cursor < upperBound) {
          cursor = upperBound;
          await local.setMeta(cursorKey(table), String(cursor));
        }
        break;
      }
      const localSnapshot = local.snapshot();
      const localMap = new Map(rowsOf(localSnapshot, table).map((r) => [r.id, r]));
      const changes: AnyRecord[] = [];
      const removedIds = new Set<string>();
      const deletedProjectIds = new Set<string>();
      for (const raw of rows) {
        if (raw._patto_deleted === true) {
          const id = String(raw.id);
          removedIds.add(id);
          if (table === 'projects') deletedProjectIds.add(id);
          continue;
        }
        const theirs = fromRemoteRow<AnyRecord>(table, raw);
        const mine = localMap.get(theirs.id);
        if (!mine) {
          changes.push(theirs);
        } else {
          const { merged, differsFromRemote } = mergeRecords(table, mine, theirs);
          changes.push({
            ...merged,
            dirty: differsFromRemote || (mine.dirty && differsFromRemote),
          });
        }
      }
      const pullRemovals: { table: TableName; ids: string[] }[] = [];
      if (removedIds.size > 0) pullRemovals.push({ table, ids: [...removedIds] });
      // プロジェクトの物理削除イベントは、別端末だけに存在した配下データも含めて除去する。
      if (deletedProjectIds.size > 0) {
        const removedColumnIds = localSnapshot.columns
          .filter((column) => deletedProjectIds.has(column.projectId))
          .map((column) => column.id);
        const removedColumnIdSet = new Set(removedColumnIds);
        pullRemovals.push({ table: 'kanban_columns', ids: removedColumnIds });
        pullRemovals.push({
          table: 'tasks',
          ids: localSnapshot.tasks
            .filter(
              (task) =>
                deletedProjectIds.has(task.projectId) || removedColumnIdSet.has(task.columnId),
            )
            .map((task) => task.id),
        });
      }
      if (table === 'kanban_columns' && removedIds.size > 0) {
        pullRemovals.push({
          table: 'tasks',
          ids: localSnapshot.tasks
            .filter((task) => removedIds.has(task.columnId))
            .map((task) => task.id),
        });
      }
      await local.apply(changes.length > 0 ? { [table]: changes } : {}, pullRemovals);
      result.pulled += changes.length;
      result.purged += removedIds.size;
      cursor = Number(rows[rows.length - 1]!.server_seq);
      await local.setMeta(cursorKey(table), String(cursor));
      if (rows.length < SYNC.pageSize) {
        if (upperBound !== undefined && cursor < upperBound) {
          cursor = upperBound;
          await local.setMeta(cursorKey(table), String(cursor));
        }
        break;
      }
    }
  }

  // ---- 後片付け: ごみ箱の自動削除 ----
  if (opts.trashRetentionDays !== null) {
    const limit = opts.now() - opts.trashRetentionDays * DAY_MS;
    for (const table of ['tasks', 'kanban_columns', 'projects'] as TableName[]) {
      // 端末のローカル一覧に存在しない、サーバー上だけの期限切れごみ箱データも削除する。
      await remote.deleteExpiredTrash(table, opts.ownerId, limit);
      const ids = rowsOf(local.snapshot(), table)
        .filter((record) => record.deletedAt !== null && record.deletedAt < limit)
        .map((record) => record.id);
      if (ids.length === 0) continue;
      await local.apply({}, [{ table, ids }]);
      result.purged += ids.length;
    }
  }

  // ---- 後片付け: 他の端末で完全削除されたものを端末から消す ----
  for (const table of TABLE_NAMES) {
    const hidden = rowsOf(local.snapshot(), table).filter(
      (r) =>
        !r.dirty &&
        (r.deletedAt !== null ||
          ('archivedAt' in r && (r as { archivedAt: number | null }).archivedAt !== null)),
    );
    if (hidden.length === 0) continue;
    const existing = new Set(
      await remote.fetchHiddenIds(
        table,
        hidden.map((record) => record.id),
      ),
    );
    const gone = hidden.filter((r) => !existing.has(r.id)).map((r) => r.id);
    if (gone.length === 0) continue;
    await local.apply({}, [{ table, ids: gone }]);
    result.purged += gone.length;
  }
  // Reset can commit while this sync is in flight. Recheck before declaring success so a tab
  // that had no dirty rows (and therefore no rejected upload) still observes the remote reset.
  const finalRemoteGeneration = await remote.getAccountResetGeneration(opts.ownerId);
  const localGenerationRaw = await local.getMeta(RESET_GENERATION_META_KEY);
  if (localGenerationRaw === null || Number(localGenerationRaw) !== finalRemoteGeneration) {
    const finalSnapshot = local.snapshot();
    await local.apply(
      {},
      TABLE_NAMES.map((table) => ({
        table,
        ids: rowsOf(finalSnapshot, table).map((record) => record.id),
      })),
    );
    for (const table of TABLE_NAMES) await local.setMeta(cursorKey(table), '0');
    await local.setMeta(RESET_GENERATION_META_KEY, String(finalRemoteGeneration));
  }
  await local.afterSync?.();
  await local.setMeta('lastSyncedAt', String(opts.now()));
  return result;
}
