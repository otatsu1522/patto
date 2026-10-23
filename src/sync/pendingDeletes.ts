import { kv } from '@/lib/kv';
import { newId } from '@/lib/ids';
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
  version: 2;
  deleteAllData: boolean;
  /** サーバー全件リセットを再試行しても同じ要求として扱うための ID。 */
  deleteAllRequestId: string | null;
  /** Local reset is being prepared; remote deletion must wait until local clear succeeds. */
  deleteAllPreparing: boolean;
  deleteAllPreparingIds: Record<TableName, string[]>;
  projectIds: string[];
  /** テーブルごとの保持期限切れごみ箱削除要求（deleted_at < cutoff）。 */
  expiredTrashBefore: Record<TableName, number | null>;
  tables: Record<TableName, PendingTableDelete>;
}

export interface FlushedDeleteResult {
  /** 全データ削除要求をサーバーで完了したため、ローカルもすべて削除する。 */
  deleteAllLocal: boolean;
  /** 全データ初期化でサーバーが確定した世代番号。 */
  resetGeneration?: number;
  /** 完了したプロジェクト単位削除。子レコードもローカルから除去する。 */
  deletedProjectIds: string[];
  /** 別端末で復元済みのため、削除を取り消してサーバーから再取得するプロジェクトID。 */
  preservedProjectIds: string[];
  /** 完了した単独レコード削除。 */
  deletedIds: Partial<Record<TableName, string[]>>;
  /** テーブル全件削除の保留要求。 */
  clearLocalTables: TableName[];
  /** サーバーで完了した保持期限削除の cutoff。 */
  expiredTrashBefore: Partial<Record<TableName, number>>;
  /** ローカルへの削除反映後にだけ、永続キューを確定する。 */
  complete: () => Promise<void>;
}

const keyForOwner = (ownerId: string) => `${STORAGE_KEY_PREFIX}${ownerId}`;

const emptyQueue = (): PendingRemoteDeletes => ({
  version: 2,
  deleteAllData: false,
  deleteAllRequestId: null,
  deleteAllPreparing: false,
  deleteAllPreparingIds: { projects: [], kanban_columns: [], tasks: [] },
  projectIds: [],
  expiredTrashBefore: { projects: null, kanban_columns: null, tasks: null },
  tables: {
    projects: { all: false, ids: [] },
    kanban_columns: { all: false, ids: [] },
    tasks: { all: false, ids: [] },
  },
});

function validateTables(value: unknown): Record<TableName, PendingTableDelete> {
  if (!value || typeof value !== 'object') throw new Error('Invalid pending remote-delete queue');
  const input = value as Record<string, unknown>;
  const tables = emptyQueue().tables;
  for (const table of TABLES) {
    const entry = input[table] as Partial<PendingTableDelete> | undefined;
    if (
      !entry ||
      typeof entry.all !== 'boolean' ||
      !Array.isArray(entry.ids) ||
      entry.ids.some((id) => typeof id !== 'string')
    ) {
      throw new Error('Invalid pending remote-delete queue');
    }
    tables[table] = { all: entry.all, ids: entry.all ? [] : [...new Set(entry.ids)] };
  }
  return tables;
}

async function readQueue(ownerId: string): Promise<PendingRemoteDeletes> {
  const raw = await kv.getRequired(keyForOwner(ownerId));
  if (!raw) return emptyQueue();

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.version === 1) {
    // 既存端末に保存されている v1 キューを失わず v2 に移行する。
    return { ...emptyQueue(), tables: validateTables(parsed.tables) };
  }
  if (parsed.version !== 2) throw new Error('Invalid pending remote-delete queue');

  const tables = validateTables(parsed.tables);
  const projectIds = parsed.projectIds;
  const expiryInput = parsed.expiredTrashBefore as Record<string, unknown> | undefined;
  if (
    typeof parsed.deleteAllData !== 'boolean' ||
    (parsed.deleteAllRequestId !== undefined &&
      parsed.deleteAllRequestId !== null &&
      typeof parsed.deleteAllRequestId !== 'string') ||
    (parsed.deleteAllPreparing !== undefined && typeof parsed.deleteAllPreparing !== 'boolean') ||
    (parsed.deleteAllPreparingIds !== undefined &&
      (!parsed.deleteAllPreparingIds || typeof parsed.deleteAllPreparingIds !== 'object')) ||
    !Array.isArray(projectIds) ||
    projectIds.some((id) => typeof id !== 'string') ||
    !expiryInput
  ) {
    throw new Error('Invalid pending remote-delete queue');
  }
  const expiredTrashBefore = {} as Record<TableName, number | null>;
  for (const table of TABLES) {
    const cutoff = expiryInput[table];
    if (cutoff !== null && (typeof cutoff !== 'number' || !Number.isFinite(cutoff))) {
      throw new Error('Invalid pending remote-delete queue');
    }
    expiredTrashBefore[table] = cutoff as number | null;
  }
  const preparingIdsInput = (parsed.deleteAllPreparingIds ?? {}) as Record<string, unknown>;
  const deleteAllPreparingIds = {} as Record<TableName, string[]>;
  for (const table of TABLES) {
    const ids = preparingIdsInput[table] ?? [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new Error('Invalid pending remote-delete queue');
    }
    deleteAllPreparingIds[table] = [...new Set(ids as string[])];
  }
  return {
    version: 2,
    deleteAllData: parsed.deleteAllData,
    deleteAllRequestId:
      typeof parsed.deleteAllRequestId === 'string' ? parsed.deleteAllRequestId : null,
    deleteAllPreparing: parsed.deleteAllPreparing === true,
    deleteAllPreparingIds,
    projectIds: [...new Set(projectIds as string[])],
    expiredTrashBefore,
    tables,
  };
}

/** プロジェクト単位削除が保留中のID。これらの dirty 行を先にPushしないために使う。 */
export async function pendingRemoteProjectDeleteIds(ownerId: string): Promise<string[]> {
  const queue = await readQueue(ownerId);
  return queue.deleteAllPreparing || queue.deleteAllData ? [] : [...queue.projectIds];
}

async function writeQueue(ownerId: string, queue: PendingRemoteDeletes): Promise<void> {
  await kv.setRequired(keyForOwner(ownerId), JSON.stringify(queue));
}

export interface PendingDeleteQueueSnapshot {
  raw: string | null;
}

export async function capturePendingRemoteDeletes(
  ownerId: string,
): Promise<PendingDeleteQueueSnapshot> {
  return { raw: await kv.getRequired(keyForOwner(ownerId)) };
}

export async function restorePendingRemoteDeletes(
  ownerId: string,
  snapshot: PendingDeleteQueueSnapshot,
): Promise<void> {
  if (snapshot.raw === null) await kv.removeRequired(keyForOwner(ownerId));
  else await kv.setRequired(keyForOwner(ownerId), snapshot.raw);
}

/** 手動／オフ中の単独レコード完全削除を保存する。ここではネットワーク通信しない。 */
export async function queueRemoteDeletes(
  ownerId: string,
  idsByTable: Partial<Record<TableName, string[]>>,
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData) return;
  for (const table of TABLES) {
    const entry = queue.tables[table];
    if (entry.all) continue;
    entry.ids = [...new Set([...entry.ids, ...(idsByTable[table] ?? [])])];
  }
  await writeQueue(ownerId, queue);
}

/** 手動／オフ中のプロジェクト完全削除。サーバーにしかない子レコードも含め、次回同期で一括削除する。 */
export async function queueRemoteProjectDeletes(
  ownerId: string,
  projectIds: string[],
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData) return;
  queue.projectIds = [...new Set([...queue.projectIds, ...projectIds])];
  await writeQueue(ownerId, queue);
}

/** 即時サーバー削除に成功したプロジェクトIDだけ、保留キューから取り除く。 */
export async function removeQueuedRemoteProjectDeletes(
  ownerId: string,
  projectIds: string[],
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData || projectIds.length === 0) return;
  const completed = new Set(projectIds);
  queue.projectIds = queue.projectIds.filter((id) => !completed.has(id));
  await writeQueue(ownerId, queue);
}

/** 同期オフ中の保持期限切れ削除を記録し、次に同期できたときサーバー側も全件検索して削除する。 */
export async function queueRemoteExpiredTrash(ownerId: string, before: number): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData) return;
  for (const table of TABLES) {
    queue.expiredTrashBefore[table] = Math.max(queue.expiredTrashBefore[table] ?? 0, before);
  }
  await writeQueue(ownerId, queue);
}

/**
 * 全データ初期化の準備状態を保存する。まだローカル削除が成功していないため、
 * この段階ではサーバー側の全件削除を実行してはいけない。既存の削除要求は保持する。
 */
export async function queueRemoteDeleteAll(
  ownerId: string,
  originalIds: Record<TableName, string[]>,
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData) return;
  queue.deleteAllPreparing = true;
  // Record the original IDs so interrupted-reset recovery can distinguish old rows from
  // legitimate records created after reset, without clearing the new records during next sync.
  queue.deleteAllPreparingIds = {
    projects: [...new Set(originalIds.projects)],
    kanban_columns: [...new Set(originalIds.kanban_columns)],
    tasks: [...new Set(originalIds.tasks)],
  };
  await writeQueue(ownerId, queue);
}

/** ローカルの全件削除が成功した後に、サーバー削除を再試行可能な状態へ確定する。 */
export async function commitRemoteDeleteAll(ownerId: string): Promise<void> {
  await writeQueue(ownerId, {
    ...emptyQueue(),
    deleteAllData: true,
    deleteAllRequestId: newId(),
  });
}

/** ローカルの全件削除が失敗した場合、未確定の準備状態だけを取り消す。 */
export async function cancelPreparedRemoteDeleteAll(ownerId: string): Promise<void> {
  const queue = await readQueue(ownerId);
  if (!queue.deleteAllPreparing) return;
  queue.deleteAllPreparing = false;
  queue.deleteAllPreparingIds = { projects: [], kanban_columns: [], tasks: [] };
  await writeQueue(ownerId, queue);
}

/**
 * クラッシュ後の準備状態を回復する。ローカルデータが残っていれば準備を取り消し、
 * ローカルDBが空なら確認済みの全件削除要求を確定して次回同期へ引き継ぐ。
 */
export async function reconcilePreparedRemoteDeleteAll(
  ownerId: string,
  currentIds: Record<TableName, string[]>,
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (!queue.deleteAllPreparing) return;
  const current = new Set([
    ...currentIds.projects,
    ...currentIds.kanban_columns,
    ...currentIds.tasks,
  ]);
  const originalIds = [
    ...queue.deleteAllPreparingIds.projects,
    ...queue.deleteAllPreparingIds.kanban_columns,
    ...queue.deleteAllPreparingIds.tasks,
  ];
  // Compare the original ID set, not whether the database contains any rows: new rows may be created
  // after reset. Since local purge is transactional, all original rows remain on failure or are gone on success.
  const localResetCompleted = originalIds.every((id) => !current.has(id));
  if (!localResetCompleted) {
    queue.deleteAllPreparing = false;
    queue.deleteAllPreparingIds = { projects: [], kanban_columns: [], tasks: [] };
    await writeQueue(ownerId, queue);
    return;
  }
  await writeQueue(ownerId, {
    ...emptyQueue(),
    deleteAllData: true,
    deleteAllRequestId: queue.deleteAllRequestId ?? newId(),
  });
}

/** 即時削除に成功した単独レコードIDを保留キューから取り除く。 */
export async function removeQueuedRemoteDeletes(
  ownerId: string,
  idsByTable: Partial<Record<TableName, string[]>>,
): Promise<void> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllData) return;
  for (const table of TABLES) {
    const entry = queue.tables[table];
    if (entry.all) continue;
    const completed = new Set(idsByTable[table] ?? []);
    if (completed.size > 0) entry.ids = entry.ids.filter((id) => !completed.has(id));
  }
  await writeQueue(ownerId, queue);
}

/**
 * Full reset is different from ordinary queued deletes: it clears old server data before Push,
 * so new local records created after the reset can be uploaded afterward. The queue is removed
 * only after both the remote transaction and local queue write succeed.
 */
export async function flushPendingRemoteDeleteAllBeforePush(
  remote: RemoteApi,
  ownerId: string,
  onResetGeneration: (generation: number) => Promise<void>,
): Promise<number | null> {
  const queue = await readQueue(ownerId);
  if (queue.deleteAllPreparing) return null;
  if (!queue.deleteAllData) return null;
  const requestId = queue.deleteAllRequestId ?? newId();
  if (queue.deleteAllRequestId === null) {
    queue.deleteAllRequestId = requestId;
    // RPC前に要求IDを永続化し、RPC成功後に端末側の保存が失敗しても再度全件削除しない。
    await writeQueue(ownerId, queue);
  }
  const generation = await remote.deleteAllOwnedData(ownerId, requestId);
  // 世代をローカルに保存してからキューを消す。保存に失敗した場合は次回同期で同じ要求を再試行する。
  await onResetGeneration(generation);
  await writeQueue(ownerId, emptyQueue());
  return generation;
}

/**
 * 削除要求を実行する。通常の ID／プロジェクト削除は Push の後に呼ぶことで、
 * ローカル削除が途中で失敗して残った dirty レコードを再送しても、最後に削除できる。
 * 保持期限削除も Push 後に実行し、期限切れレコードの復活を防ぐ。
 */
export async function flushPendingRemoteDeletes(
  remote: RemoteApi,
  ownerId: string,
  includeExpiredTrash = false,
): Promise<FlushedDeleteResult> {
  const queue = await readQueue(ownerId);
  const remaining: PendingRemoteDeletes = {
    ...queue,
    projectIds: [...queue.projectIds],
    expiredTrashBefore: { ...queue.expiredTrashBefore },
    tables: {
      projects: { ...queue.tables.projects, ids: [...queue.tables.projects.ids] },
      kanban_columns: { ...queue.tables.kanban_columns, ids: [...queue.tables.kanban_columns.ids] },
      tasks: { ...queue.tables.tasks, ids: [...queue.tables.tasks.ids] },
    },
  };
  let changed = false;
  const result: FlushedDeleteResult = {
    deleteAllLocal: false,
    deletedProjectIds: [],
    preservedProjectIds: [],
    deletedIds: {},
    clearLocalTables: [],
    expiredTrashBefore: {},
    complete: async () => {
      if (changed) await writeQueue(ownerId, remaining);
    },
  };

  if (queue.deleteAllPreparing) {
    // A prepared reset is not yet authorized for remote deletion until the local DB is cleared.
    return result;
  }

  if (queue.deleteAllData) {
    const requestId = queue.deleteAllRequestId ?? newId();
    if (queue.deleteAllRequestId === null) {
      queue.deleteAllRequestId = requestId;
      // RPC前に要求IDを保存し、成功後の端末側エラーで全件削除を繰り返さない。
      await writeQueue(ownerId, queue);
    }
    result.resetGeneration = await remote.deleteAllOwnedData(ownerId, requestId);
    result.deleteAllLocal = true;
    Object.assign(remaining, emptyQueue());
    changed = true;
    return result;
  }

  if (queue.projectIds.length > 0) {
    // 1つのRPCで親と子を原子的に削除する。別端末で復元済みのプロジェクトは
    // 削除しない結果として受け取り、Pullでサーバーの状態をローカルへ戻す。
    const deleted = await remote.deleteProjectsOwned(queue.projectIds, ownerId);
    result.deletedProjectIds = deleted.deletedProjectIds;
    result.preservedProjectIds = deleted.preservedProjectIds;
    // 削除または復元保護の結果が確定したので、同じ要求を再送しない。
    remaining.projectIds = [];
    changed = true;
  }

  for (const table of DELETE_ORDER) {
    const entry = queue.tables[table];
    const remainingEntry = remaining.tables[table];
    if (entry.all) {
      await remote.deleteAllOwned(table, ownerId);
      result.clearLocalTables.push(table);
      remainingEntry.all = false;
      remainingEntry.ids = [];
      remaining.expiredTrashBefore[table] = null;
      changed = true;
    } else if (entry.ids.length > 0) {
      const ids = [...entry.ids];
      await remote.deleteByIds(table, ids);
      result.deletedIds[table] = ids;
      remainingEntry.ids = [];
      changed = true;
    }

    if (includeExpiredTrash && queue.expiredTrashBefore[table] !== null) {
      const cutoff = queue.expiredTrashBefore[table]!;
      await remote.deleteExpiredTrash(table, ownerId, cutoff);
      result.expiredTrashBefore[table] = cutoff;
      remaining.expiredTrashBefore[table] = null;
      changed = true;
    }
  }

  return result;
}
