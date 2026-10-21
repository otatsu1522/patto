import { kv } from '@/lib/kv';
import type { TableName } from '@/domain/types';
import type { RemoteApi } from './types';

/**
 * 手動／オフ中の削除要求をアカウント単位で端末ストレージへ保存する。
 * DBをログアウト時に削除しても要求を失わず、同じアカウントの次回同期で反映できる。
 */
const STORAGE_KEY_PREFIX = 'patto:pending-remote-deletes:v1:';
const TABLES: readonly TableName[] = ['projects', 'kanban_columns', 'tasks'];
const DELETE_ORDER: readonly TableName[] = ['tasks', 'kanban_columns', 'projects'];

interface PendingTableDelete {
  all: boolean;
  ids: string[];
}

interface PendingRemoteDeletes {
  version: 1;
  tables: Record<TableName, PendingTableDelete>;
}

const keyForOwner = (ownerId: string) => `${STORAGE_KEY_PREFIX}${ownerId}`;

const emptyQueue = (): PendingRemoteDeletes => ({
  version: 1,
  tables: {
    projects: { all: false, ids: [] },
    kanban_columns: { all: false, ids: [] },
    tasks: { all: false, ids: [] },
  },
});

async function readQueue(ownerId: string): Promise<PendingRemoteDeletes> {
  const raw = await kv.getRequired(keyForOwner(ownerId));
  if (!raw) return emptyQueue();

  const parsed = JSON.parse(raw) as Partial<PendingRemoteDeletes>;
  if (parsed.version !== 1 || !parsed.tables) {
    throw new Error('Invalid pending remote-delete queue');
  }

  const queue = emptyQueue();
  for (const table of TABLES) {
    const entry = parsed.tables[table];
    if (
      !entry ||
      typeof entry.all !== 'boolean' ||
      !Array.isArray(entry.ids) ||
      entry.ids.some((id) => typeof id !== 'string')
    ) {
      throw new Error('Invalid pending remote-delete queue');
    }
    queue.tables[table] = {
      all: entry.all,
      ids: entry.all ? [] : [...new Set(entry.ids)],
    };
  }
  return queue;
}

async function writeQueue(ownerId: string, queue: PendingRemoteDeletes): Promise<void> {
  await kv.setRequired(keyForOwner(ownerId), JSON.stringify(queue));
}

/** 手動／オフ中の完全削除を端末ストレージに記録する。ここではネットワーク通信しない。 */
export async function queueRemoteDeletes(
  ownerId: string,
  idsByTable: Partial<Record<TableName, string[]>>,
): Promise<void> {
  const queue = await readQueue(ownerId);
  for (const table of TABLES) {
    const entry = queue.tables[table];
    if (entry.all) continue;
    entry.ids = [...new Set([...entry.ids, ...(idsByTable[table] ?? [])])];
  }
  await writeQueue(ownerId, queue);
}

/** 手動／オフ中の全データ初期化を、次回同期時の所有アカウント単位の削除として記録する。 */
export async function queueRemoteDeleteAll(ownerId: string): Promise<void> {
  const queue = emptyQueue();
  for (const table of TABLES) queue.tables[table] = { all: true, ids: [] };
  await writeQueue(ownerId, queue);
}

/**
 * 明示同期または自動同期が開始されたときだけ、保存済みの削除要求を実行する。
 * 各テーブルのリモート削除が成功した直後にキューを更新するため、途中失敗時も再実行可能。
 */
export async function flushPendingRemoteDeletes(remote: RemoteApi, ownerId: string): Promise<void> {
  const queue = await readQueue(ownerId);
  for (const table of DELETE_ORDER) {
    const entry = queue.tables[table];
    if (entry.all) {
      await remote.deleteAllOwned(table, ownerId);
      queue.tables[table] = { all: false, ids: [] };
      await writeQueue(ownerId, queue);
      continue;
    }
    if (entry.ids.length > 0) {
      await remote.deleteByIds(table, entry.ids);
      queue.tables[table] = { all: false, ids: [] };
      await writeQueue(ownerId, queue);
    }
  }
}
