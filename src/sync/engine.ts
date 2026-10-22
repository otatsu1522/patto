import { SYNC } from '@/config/limits';
import { mergeRecords } from '@/domain/merge';
import { fromRemoteRow, TABLE_NAMES, toRemoteRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import type { RemoteApi, SyncResult } from './types';
import { flushPendingRemoteDeletes } from './pendingDeletes';
import { DAY_MS } from '@/lib/dates';

/** エンジンが必要とする端末側の入出力（ストアとDBへの橋渡し）。 */
export interface LocalPort {
  snapshot(): Snapshot;
  apply(
    changes: Partial<Record<TableName, AnyRecord[]>>,
    removed: { table: TableName; ids: string[] }[],
  ): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
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

const cursorKey = (table: TableName) => `cursor:${table}`;

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
  const serverNow = await remote.serverTime();
  opts.onServerTime?.(serverNow);

  // 明示同期／自動同期の入口を通った場合だけ、手動／オフ中に端末へ保存した削除を送る。
  // リモート削除が途中で失敗した場合はテーブル単位でキューを残し、次回同期で再試行する。
  await flushPendingRemoteDeletes(remote, opts.ownerId);

  // ---- Push ----
  for (const table of TABLE_NAMES) {
    const dirty = rowsOf(local.snapshot(), table).filter((r) => r.dirty);
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
      const localMap = new Map(rowsOf(local.snapshot(), table).map((r) => [r.id, r]));
      const changes: AnyRecord[] = [];
      for (const raw of rows) {
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
      await local.apply({ [table]: changes }, []);
      result.pulled += rows.length;
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
      const ids = rowsOf(local.snapshot(), table)
        .filter((r) => !r.dirty && r.deletedAt !== null && r.deletedAt < limit)
        .map((r) => r.id);
      if (ids.length === 0) continue;
      await remote.deleteByIds(table, ids);
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
  await local.setMeta('lastSyncedAt', String(opts.now()));
  return result;
}
