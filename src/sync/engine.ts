import { SYNC } from '@/config/limits';
import { mergeRecords } from '@/domain/merge';
import { fromRemoteRow, TABLE_NAMES, toRemoteRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import { setClockOffset } from '@/lib/clock';
import type { RemoteApi, SyncResult } from './types';

/** エンジンが必要とする端末側の入出力（ストアとDBへの橋渡し）。 */
export interface LocalPort {
  snapshot(): Snapshot;
  apply(changes: Partial<Record<TableName, AnyRecord[]>>, removed: { table: TableName; ids: string[] }[]): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

export interface SyncOptions {
  /** ごみ箱の自動削除（保持日数）。null なら行わない */
  trashRetentionDays: number | null;
  now: () => number;
}

const rowsOf = (snap: Snapshot, table: TableName): AnyRecord[] =>
  table === 'projects' ? snap.projects : table === 'kanban_columns' ? snap.columns : snap.tasks;

const chunk = <T,>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const cursorKey = (table: TableName) => `cursor:${table}`;

/**
 * 同期の本体: Push（未送信を送る）→ Pull（新しい変更を受け取る）→ 後片付け。
 * 競合は項目単位の最終更新優先でマージする（domain/merge.ts）。
 * 送信は id 基準の upsert なので、途中で失敗して再実行しても二重適用にならない。
 */
export async function runSync(remote: RemoteApi, local: LocalPort, opts: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, purged: 0 };

  const serverNow = await remote.serverTime();
  setClockOffset(serverNow - Date.now());

  // ---- Push ----
  for (const table of TABLE_NAMES) {
    const dirty = rowsOf(local.snapshot(), table).filter((r) => r.dirty);
    if (dirty.length === 0) continue;
    const toPush: AnyRecord[] = [];
    const toStore: AnyRecord[] = [];
    for (const part of chunk(dirty, 100)) {
      const remoteRows = await remote.fetchByIds(table, part.map((r) => r.id));
      const remoteMap = new Map(remoteRows.map((r) => [String(r.id), fromRemoteRow<AnyRecord>(table, r)]));
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
    for (const part of chunk(toPush, 200)) {
      await remote.upsert(table, part.map((r) => toRemoteRow(table, r)));
    }
    result.pushed += toPush.length;
    // 送信中にさらに編集された行は dirty を維持する
    const current = new Map(rowsOf(local.snapshot(), table).map((r) => [r.id, r]));
    const settled = toStore.filter((r) => {
      const now = current.get(r.id);
      return !now || now.updatedAt <= r.updatedAt || !now.dirty;
    });
    await local.apply({ [table]: settled }, []);
  }

  // ---- Pull ----
  for (const table of TABLE_NAMES) {
    let cursor = Number((await local.getMeta(cursorKey(table))) ?? 0);
    for (;;) {
      const rows = await remote.fetchSince(table, cursor, SYNC.pageSize);
      if (rows.length === 0) break;
      const localMap = new Map(rowsOf(local.snapshot(), table).map((r) => [r.id, r]));
      const changes: AnyRecord[] = [];
      for (const raw of rows) {
        const theirs = fromRemoteRow<AnyRecord>(table, raw);
        const mine = localMap.get(theirs.id);
        if (!mine) {
          changes.push(theirs);
        } else {
          const { merged, differsFromRemote } = mergeRecords(table, mine, theirs);
          changes.push({ ...merged, dirty: differsFromRemote || (mine.dirty && differsFromRemote) });
        }
      }
      await local.apply({ [table]: changes }, []);
      result.pulled += rows.length;
      cursor = Number(rows[rows.length - 1]!.server_seq);
      await local.setMeta(cursorKey(table), String(cursor));
      if (rows.length < SYNC.pageSize) break;
    }
  }

  // ---- 後片付け: ごみ箱の自動削除 ----
  if (opts.trashRetentionDays !== null) {
    const limit = opts.now() - opts.trashRetentionDays * 24 * 60 * 60 * 1000;
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
      (r) => !r.dirty && (r.deletedAt !== null || ('archivedAt' in r && (r as { archivedAt: number | null }).archivedAt !== null)),
    );
    if (hidden.length === 0) continue;
    const existing = new Set(await remote.fetchHiddenIds(table));
    const gone = hidden.filter((r) => !existing.has(r.id)).map((r) => r.id);
    if (gone.length === 0) continue;
    await local.apply({}, [{ table, ids: gone }]);
    result.purged += gone.length;
  }

  await local.setMeta('lastSyncedAt', String(opts.now()));
  return result;
}
