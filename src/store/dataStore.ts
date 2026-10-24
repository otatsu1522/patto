import { create } from 'zustand';
import { DEFAULT_COLUMNS } from '@/config/defaults';
import {
  TUTORIAL_PREVIOUS_TASK_COUNTS,
  TUTORIAL_PROJECT_COLOR,
  TUTORIAL_PROJECT_TITLE,
  TUTORIAL_TASKS,
  TUTORIAL_TASKS_VERSION,
} from '@/config/tutorial';
import { LIMITS } from '@/config/limits';
import { TIMING } from '@/config/timing';
import { destroyLocalDb, openLocalDb } from '@/db/sqliteDb';
import type { LocalDb } from '@/db/types';
import {
  buildColumn,
  buildProject,
  buildTask,
  moveTaskPatch,
  patchRecord,
  type ColumnInput,
  type ProjectInput,
  type TaskInput,
} from '@/domain/mutations';
import { compareBySortKey, keyAtEnd, keyAtStart, keyForIndex } from '@/domain/ordering';
import { validateImportedBoards, type ImportedBoard } from '@/domain/trello';
import { mergeRecords } from '@/domain/merge';
import { mergeableFields } from '@/domain/schema';
import { UserActionError } from '@/domain/operationError';
import { columnsOf, isActive, purgeTargets, tasksOf } from '@/domain/selectors';
import type {
  AnyRecord,
  ColumnSortMode,
  KanbanColumn,
  Project,
  Snapshot,
  TableName,
  Task,
} from '@/domain/types';
import { emptySnapshot } from '@/domain/types';
import { t } from '@/i18n';
import { nowMs } from '@/lib/clock';
import type { TaskColorKey } from '@/theme/taskColors';
import { DIAGNOSTIC_MESSAGES } from '@/config/diagnostics';

type Listener = () => void;
const changeListeners = new Set<Listener>();
/** ローカルのデータが変わったときに呼ばれる（自動同期のきっかけに使う）。 */
export const onLocalChange = (fn: Listener): (() => void) => {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
};

class DbOpenTimeoutError extends Error {
  constructor() {
    super(t('app.startupTimeout'));
    this.name = 'DbOpenTimeoutError';
  }
}

/** DB オープンが停止した場合に、ログイン／起動を無期限に待たせない。 */
async function openLocalDbWithTimeout(scope: string): Promise<LocalDb> {
  const opening = openLocalDb(scope);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new DbOpenTimeoutError()), TIMING.dbOpenTimeoutMs);
  });
  try {
    return await Promise.race([opening, timeout]);
  } catch (error) {
    // タイムアウト後に open が遅れて完了した場合は、その接続を残さない。
    void opening.then((lateDb) => lateDb.close().catch(() => undefined)).catch(() => undefined);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/** DBを開いて読み込む。Web でも常に同じ共有 DB を使い、競合時に別 DB へ切り替えない。 */
async function openAndLoadDb(scope: string): Promise<{ db: LocalDb; snapshot: Snapshot }> {
  const opened = await openLocalDbWithTimeout(scope);
  try {
    return { db: opened, snapshot: await loadDbWithTimeout(opened) };
  } catch (error) {
    void opened.close().catch(() => undefined);
    throw error;
  }
}

async function loadDbWithTimeout(db: LocalDb): Promise<Snapshot> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(t('app.startupTimeout'))),
      TIMING.dbOpenTimeoutMs,
    );
  });
  try {
    return await Promise.race([db.loadAll(), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

let db: LocalDb | null = null;
type SyncDbTarget = { ownerId: string; scope: string; db: LocalDb };
type SyncContextRegistration = SyncDbTarget & { freeze: () => void };
const syncContextRegistrations = new Set<SyncContextRegistration>();
const dbLeaseCounts = new Map<LocalDb, number>();
const dbLogicalScopes = new Map<LocalDb, string>();
const pendingDbClose = new Set<LocalDb>();
const pendingDbDestroyScopes = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }
>();
const destroyingDbScopes = new Set<string>();
const dbScopeWaiters = new Map<string, Set<() => void>>();

function hasDbLeaseForScope(scope: string): boolean {
  for (const [leasedDb, count] of dbLeaseCounts) {
    if (count > 0 && dbLogicalScopes.get(leasedDb) === scope) return true;
  }
  return false;
}

async function flushPendingDbDestruction(): Promise<void> {
  for (const [scope, pending] of [...pendingDbDestroyScopes]) {
    if (hasDbLeaseForScope(scope) || destroyingDbScopes.has(scope)) continue;
    destroyingDbScopes.add(scope);
    try {
      await destroyLocalDb(scope);
      pendingDbDestroyScopes.delete(scope);
      pending.resolve();
    } catch (error) {
      pendingDbDestroyScopes.delete(scope);
      pending.reject(error);
    } finally {
      destroyingDbScopes.delete(scope);
    }
  }
}

async function closeDbWhenUnused(target: LocalDb): Promise<void> {
  if ((dbLeaseCounts.get(target) ?? 0) > 0) {
    pendingDbClose.add(target);
    return;
  }
  try {
    await target.close();
  } finally {
    dbLogicalScopes.delete(target);
    await flushPendingDbDestruction();
  }
}

async function releaseDbLease(target: LocalDb): Promise<void> {
  const count = dbLeaseCounts.get(target) ?? 0;
  if (count > 1) {
    dbLeaseCounts.set(target, count - 1);
    return;
  }
  dbLeaseCounts.delete(target);
  const scope = dbLogicalScopes.get(target);
  let closeError: unknown;
  if (pendingDbClose.delete(target)) {
    try {
      await target.close();
    } catch (error) {
      closeError = error;
    } finally {
      dbLogicalScopes.delete(target);
    }
  }
  await flushPendingDbDestruction();
  if (scope) {
    const waiters = dbScopeWaiters.get(scope);
    if (waiters) {
      dbScopeWaiters.delete(scope);
      waiters.forEach((resolve) => resolve());
    }
  }
  if (closeError) throw closeError;
}

async function waitForScopeLeases(scope: string): Promise<void> {
  while (hasDbLeaseForScope(scope)) {
    await new Promise<void>((resolve) => {
      const waiters = dbScopeWaiters.get(scope) ?? new Set<() => void>();
      waiters.add(resolve);
      dbScopeWaiters.set(scope, waiters);
    });
  }
  const pendingDestroy = pendingDbDestroyScopes.get(scope);
  if (pendingDestroy) await pendingDestroy.promise;
}

function freezeSyncContexts(ownerId: string, scope: string): void {
  for (const context of syncContextRegistrations) {
    if (context.ownerId === ownerId && context.scope === scope) context.freeze();
  }
}

/** 同期層などから DB に直接アクセスするための入口 */
export const getDb = (): LocalDb => {
  if (!db) throw new Error(DIAGNOSTIC_MESSAGES.databaseNotOpen);
  return db;
};

interface Changes {
  projects?: Project[];
  columns?: KanbanColumn[];
  tasks?: Task[];
}

const upsertById = <T extends { id: string }>(list: T[], changed: T[] | undefined): T[] => {
  if (!changed || changed.length === 0) return list;
  const map = new Map(list.map((r) => [r.id, r]));
  for (const c of changed) map.set(c.id, c);
  return Array.from(map.values());
};

/**
 * 更新関数がキュー投入前に読んだ古いレコードを、そのまま保存しないための三者差分。
 * 呼び出し時点のレコードから実際に変更された項目だけを、キュー実行時点の最新値へ適用する。
 */
function rebaseLocalChanges<T extends AnyRecord>(
  table: TableName,
  baseRecords: AnyRecord[],
  currentRecords: AnyRecord[],
  proposedRecords: T[] | undefined,
): T[] | undefined {
  if (!proposedRecords) return undefined;
  const baseById = new Map(baseRecords.map((record) => [record.id, record]));
  const currentById = new Map(currentRecords.map((record) => [record.id, record]));
  const fields = mergeableFields(table);
  const proposalsById = new Map<string, T[]>();
  for (const proposed of proposedRecords) {
    const list = proposalsById.get(proposed.id) ?? [];
    list.push(proposed);
    proposalsById.set(proposed.id, list);
  }

  return [...proposalsById.entries()].flatMap(([id, proposals]) => {
    const base = baseById.get(id);
    // 新規作成レコードは通常IDごとに1件。重複がある場合は最後の内容を使う。
    if (!base) return [proposals[proposals.length - 1]!];
    const current = currentById.get(id);
    // キューを待つ間に物理削除されたレコードを、遅れてきた編集で復活させない。
    if (!current) return [];

    const baseValues = base as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const changedFields = new Set<string>();
    for (const proposed of proposals) {
      const proposedValues = proposed as unknown as Record<string, unknown>;
      for (const field of fields) {
        if (
          JSON.stringify(proposedValues[field] ?? null) !==
          JSON.stringify(baseValues[field] ?? null)
        ) {
          changedFields.add(field);
          // 同じフィールドが複数回含まれた場合は、変更リスト内の最後の値を採用する。
          patch[field] = proposedValues[field] ?? null;
        }
      }
    }
    if (changedFields.size === 0) return [];

    const latestRevision = Math.max(current.updatedAt, ...Object.values(current.fieldUpdatedAt));
    const revision = Math.max(nowMs(), latestRevision + 1);
    const fieldUpdatedAt = { ...current.fieldUpdatedAt };
    for (const field of changedFields) fieldUpdatedAt[field] = revision;

    return [
      {
        ...current,
        ...patch,
        updatedAt: revision,
        fieldUpdatedAt,
        dirty: true,
      } as T,
    ];
  });
}

function rebaseChanges(base: Snapshot, current: Snapshot, changes: Changes): Changes {
  return {
    projects: rebaseLocalChanges('projects', base.projects, current.projects, changes.projects),
    columns: rebaseLocalChanges('kanban_columns', base.columns, current.columns, changes.columns),
    tasks: rebaseLocalChanges('tasks', base.tasks, current.tasks, changes.tasks),
  };
}

/** Pull結果を適用する直前に、待ち時間中に起きたローカル編集と再マージする。 */
function mergeIncomingChanges(
  current: Snapshot,
  changes: Partial<Record<TableName, AnyRecord[]>>,
): Changes {
  const mergeTable = <T extends AnyRecord>(
    table: TableName,
    existing: T[],
    incoming: AnyRecord[] | undefined,
  ): T[] | undefined => {
    if (!incoming) return undefined;
    const currentById = new Map(existing.map((record) => [record.id, record]));
    return incoming.map((record) => {
      const local = currentById.get(record.id);
      if (!local) return record as T;
      const { merged, differsFromRemote } = mergeRecords(table, local, record as T);
      return { ...merged, dirty: record.dirty || differsFromRemote } as T;
    });
  };

  return {
    projects: mergeTable('projects', current.projects, changes.projects),
    columns: mergeTable('kanban_columns', current.columns, changes.kanban_columns),
    tasks: mergeTable('tasks', current.tasks, changes.tasks),
  };
}

interface DataState extends Snapshot {
  scope: string | null;
  ownerId: string;
  ready: boolean;

  open: (scope: string, ownerId: string) => Promise<void>;
  close: () => Promise<void>;
  /** 同期層からの書き込み（変更通知は発火しない） */
  applyRemote: (changes: Changes, removed?: { table: TableName; ids: string[] }[]) => Promise<void>;
  /** 同期開始時に固定したDBへ書き込み、別アカウントのメモリ状態には触れない。 */
  applyRemoteForSync: (
    target: SyncDbTarget,
    changes: Partial<Record<TableName, AnyRecord[]>>,
    removed?: { table: TableName; ids: string[] }[],
  ) => Promise<void>;
  /** Pull の全ページ適用後に、チュートリアルデータの移行を一度だけ実行する。 */
  completeRemoteSync: (target: SyncDbTarget) => Promise<void>;
  reload: () => Promise<void>;
  snapshot: () => Snapshot;

  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (
    id: string,
    patch: Partial<Pick<Project, 'title' | 'description' | 'color' | 'isFavorite' | 'archivedAt'>>,
  ) => Promise<void>;
  setProjectArchived: (id: string, archived: boolean) => Promise<void>;
  /** アーカイブ済みプロジェクトと配下の有効なカンバン／タスクを一括でごみ箱へ移動する。 */
  moveArchivedProjectsToTrash: (ids: string[]) => Promise<number>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<Project | null>;
  moveProject: (id: string, toIndex: number) => Promise<void>;

  createColumn: (
    input: Omit<ColumnInput, 'isDoneColumn'> & { isDoneColumn?: boolean },
  ) => Promise<KanbanColumn | null>;
  updateColumn: (
    id: string,
    patch: Partial<Pick<KanbanColumn, 'title' | 'color' | 'sortMode' | 'isDoneColumn'>>,
  ) => Promise<void>;
  /** カンバン設定のUndo。カンバンの更新に伴い変わったタスクの内部状態も同時に復元する。 */
  restoreColumnEdit: (
    id: string,
    patch: Partial<Pick<KanbanColumn, 'title' | 'color' | 'sortMode' | 'isDoneColumn'>>,
    taskStates: { id: string; sortKey?: string; completedAt?: number | null }[],
  ) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  duplicateColumn: (id: string) => Promise<KanbanColumn | null>;
  moveColumn: (id: string, toIndex: number) => Promise<void>;

  createTask: (input: TaskInput) => Promise<Task | null>;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'title'
        | 'description'
        | 'color'
        | 'dueAt'
        | 'dueHasTime'
        | 'isFavorite'
        | 'sortKey'
        | 'completedAt'
      >
    >,
  ) => Promise<void>;
  moveTask: (id: string, toColumnId: string) => Promise<void>;
  reorderTask: (id: string, toIndex: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  duplicateTask: (id: string) => Promise<Task | null>;
  archiveTask: (id: string, archived: boolean) => Promise<void>;
  archiveDoneTasks: (projectId: string) => Promise<number>;
  /** アーカイブ済みタスクを、ごみ箱へ一括移動する。 */
  moveArchivedTasksToTrash: (ids: string[], at: number) => Promise<number>;

  restoreItem: (kind: 'project' | 'column' | 'task', id: string) => Promise<void>;
  /** 指定IDを端末から完全に削除する（サーバー側の削除は呼び出し側で先に行う） */
  purgeLocal: (ids: { projects: string[]; columns: string[]; tasks: string[] }) => Promise<void>;
  importBoards: (boards: ImportedBoard[]) => Promise<number>;
  /** 初回だけ、サンプルプロジェクト（TUTORIAL）を作り、そのIDを返す */
  seedTutorial: () => Promise<string | null>;
}

export const useDataStore = create<DataState>((set, get) => {
  // DB永続化からZustand反映までを一続きに直列化し、並行更新の反映順がDBと逆転しないようにする。
  let dataMutationQueue: Promise<unknown> = Promise.resolve();
  const enqueueDataMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = dataMutationQueue.then(operation, operation);
    dataMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /** 関連テーブルをDBへ原子的に保存してからメモリへ反映し、必要な場合だけ変更通知を出す。 */
  async function commit(changes: Changes, notify = true, target?: SyncDbTarget): Promise<void> {
    const initialState = get();
    const targetDb = target?.db ?? getDb();
    const expectedOwnerId = target?.ownerId ?? initialState.ownerId;
    const expectedScope = target?.scope ?? initialState.scope;
    const isTargetCurrent = () =>
      db === targetDb &&
      get().ready &&
      get().ownerId === expectedOwnerId &&
      get().scope === expectedScope;

    await enqueueDataMutation(async () => {
      const queuedState = get();
      const effectiveChanges = isTargetCurrent()
        ? rebaseChanges(initialState, queuedState, changes)
        : changes;
      // 読み取り後に別操作が先に確定しても、変更項目以外はキュー実行時の最新値を保持する。
      // プロジェクトと配下のカンバン／タスクは全テーブル成功後にだけ画面へ反映する。
      await targetDb.applyChanges(effectiveChanges);
      if (isTargetCurrent()) {
        set((s) => {
          if (s.ownerId !== expectedOwnerId || s.scope !== expectedScope || !s.ready) return s;
          return {
            projects: upsertById(s.projects, effectiveChanges.projects),
            columns: upsertById(s.columns, effectiveChanges.columns),
            tasks: upsertById(s.tasks, effectiveChanges.tasks),
          };
        });
      }
      if (notify && isTargetCurrent()) {
        // 永続化済みの変更を、監視側の例外によって失敗扱いにしない。
        for (const listener of changeListeners) {
          try {
            listener();
          } catch {
            // Listener failures must not make a successfully committed mutation look unsaved.
          }
        }
      }
    });
  }

  const now = () => nowMs();
  const owner = () => get().ownerId;
  // bootstrap / Strict Mode / account transitions may request open or close concurrently.
  let dbLifecycleQueue: Promise<void> = Promise.resolve();
  const enqueueDbLifecycle = (operation: () => Promise<void>): Promise<void> => {
    const result = dbLifecycleQueue.then(operation, operation);
    dbLifecycleQueue = result.catch(() => undefined);
    return result;
  };

  const activeColumns = (projectId: string) => columnsOf(get().columns, projectId);
  const column = (id: string) => get().columns.find((c) => c.id === id);
  const task = (id: string) => get().tasks.find((x) => x.id === id);
  const project = (id: string) => get().projects.find((p) => p.id === id);

  function seedColumns(projectId: string, ts: number): KanbanColumn[] {
    let prev: string | null = null;
    return DEFAULT_COLUMNS.map((def) => {
      const col = buildColumn(
        owner(),
        ts,
        { projectId, title: t(def.titleKey), isDoneColumn: def.isDone, color: def.color },
        keyForIndex(prev ? [{ id: 'p', sortKey: prev }] : [], 1),
      );
      prev = col.sortKey;
      return col;
    });
  }

  /** 既存のチュートリアルへ新しい説明タスクを追加し、未編集サンプルの既定色を更新する。 */
  async function migrateTutorialTasks(notify = false, target?: SyncDbTarget): Promise<void> {
    if (
      target &&
      (db !== target.db ||
        !get().ready ||
        get().ownerId !== target.ownerId ||
        get().scope !== target.scope)
    ) {
      return;
    }
    const state = get();
    const d = target?.db ?? getDb();
    const migrationOwnerId = target?.ownerId ?? state.ownerId;
    let tutorialProjectId = await d.getMeta('tutorialProjectId');
    const hasStoredTutorialId = !!tutorialProjectId;
    // メタデータは端末ローカルなので、別端末で同期された TUTORIAL も識別できるようにする。
    if (!tutorialProjectId) {
      tutorialProjectId =
        state.projects.find(
          (p) =>
            p.title === t(TUTORIAL_PROJECT_TITLE) &&
            p.color === TUTORIAL_PROJECT_COLOR &&
            isActive(p) &&
            p.archivedAt === null,
        )?.id ?? null;
    }
    if (!tutorialProjectId) return;

    const project = state.projects.find((p) => p.id === tutorialProjectId);
    if (!project) return;
    const columns = state.columns
      .filter((column) => column.projectId === tutorialProjectId)
      .sort(compareBySortKey);
    // 別端末では project メタデータがないため、サンプル由来の古いタスクが届くまで確定しない。
    if (
      !hasStoredTutorialId &&
      (columns.length < DEFAULT_COLUMNS.length ||
        !state.tasks.some(
          (task) => task.projectId === tutorialProjectId && task.createdAt <= project.createdAt,
        ))
    ) {
      return;
    }
    // ユーザーが既定カンバンの順番を変更している場合、表示順をテンプレートの列順と誤認しない。
    const columnsWereReordered = columns.some(
      (column) => (column.fieldUpdatedAt.sortKey ?? 0) > project.createdAt,
    );

    const updatedAt = now();
    const updatedTasks: Task[] = [];

    const existingIndexesByColumn = new Map<string, Set<number>>();
    for (const column of columns) {
      const indexes = new Set<number>();
      for (const task of state.tasks) {
        if (
          task.projectId !== tutorialProjectId ||
          task.columnId !== column.id ||
          task.createdAt > project.createdAt ||
          (task.fieldUpdatedAt.columnId ?? 0) > project.createdAt
        ) {
          continue;
        }
        const delta = project.createdAt - task.createdAt;
        const index = delta / 1000;
        if (delta >= 0 && Number.isInteger(index) && index < TUTORIAL_PREVIOUS_TASK_COUNTS[0]) {
          indexes.add(index);
        }
      }
      existingIndexesByColumn.set(column.id, indexes);
    }

    if (columnsWereReordered) {
      // 手動で並び替えた列は表示順だけでは役割を判定できない。
      // 元 TODO サンプルの 3 以降の時刻インデックスを持つ列だけを特定し、
      // 要望対象である TODO の色だけ更新する。DOING などは誤判定を避けて変更しない。
      const todoColumn = columns.find((column) =>
        [...(existingIndexesByColumn.get(column.id) ?? [])].some((index) => index >= 3),
      );
      if (todoColumn) {
        const templates = TUTORIAL_TASKS[0] ?? [];
        for (const task of state.tasks) {
          if (
            task.projectId !== tutorialProjectId ||
            task.columnId !== todoColumn.id ||
            task.createdAt > project.createdAt ||
            (task.fieldUpdatedAt.columnId ?? 0) > project.createdAt
          ) {
            continue;
          }
          const delta = project.createdAt - task.createdAt;
          if (delta < 0 || delta % 1000 !== 0) continue;
          const template = templates[delta / 1000];
          const colorWasCustomized =
            (task.fieldUpdatedAt.color ?? task.createdAt) > project.createdAt;
          if (template && !colorWasCustomized && task.color !== template.color) {
            updatedTasks.push(patchRecord(task, { color: template.color }, updatedAt));
          }
        }
      }
    } else {
      columns.forEach((column, columnIndex) => {
        const templates = TUTORIAL_TASKS[columnIndex] ?? [];
        if (templates.length === 0) return;
        for (const task of state.tasks) {
          if (
            task.projectId !== tutorialProjectId ||
            task.columnId !== column.id ||
            task.createdAt > project.createdAt ||
            (task.fieldUpdatedAt.columnId ?? 0) > project.createdAt
          ) {
            continue;
          }
          // サンプル作成時は列内の順番ごとに createdAt を 1 秒ずつずらしている。
          // タスク名がユーザーに編集されていても、作成済みのチュートリアルタスクを特定できる。
          const delta = project.createdAt - task.createdAt;
          if (delta < 0 || delta % 1000 !== 0) continue;
          const template = templates[delta / 1000];
          // 色をユーザーが変更したサンプルは尊重し、初期値のままのものだけ更新する。
          const colorWasCustomized =
            (task.fieldUpdatedAt.color ?? task.createdAt) > project.createdAt;
          if (template && !colorWasCustomized && task.color !== template.color) {
            updatedTasks.push(patchRecord(task, { color: template.color }, updatedAt));
          }
        }
      });
    }

    const newTasks: Task[] = [];
    const tutorialTaskVersion = await d.getMeta('tutorialTaskSchemaVersion');
    let canMarkTutorialVersion = true;
    if (tutorialTaskVersion !== TUTORIAL_TASKS_VERSION) {
      const previousTodoCount = TUTORIAL_PREVIOUS_TASK_COUNTS[0];
      const todoTemplates = TUTORIAL_TASKS[0] ?? [];
      if (todoTemplates.length > previousTodoCount) {
        // TODO 列は旧サンプルの 0〜9 インデックスを持つことで識別する。
        // カンバンをユーザーが並び替えていても、現在の表示順で別列へ追加しない。
        const candidates = columns.map((column) => {
          const sampleIndexes = new Set<number>();
          const oldSampleIndexes = new Set<number>();
          for (const task of state.tasks) {
            if (
              task.projectId !== tutorialProjectId ||
              task.columnId !== column.id ||
              task.createdAt > project.createdAt ||
              (task.fieldUpdatedAt.columnId ?? 0) > project.createdAt
            ) {
              continue;
            }
            const delta = project.createdAt - task.createdAt;
            const index = delta / 1000;
            if (delta >= 0 && Number.isInteger(index) && index < todoTemplates.length) {
              sampleIndexes.add(index);
              if (index < previousTodoCount) oldSampleIndexes.add(index);
            }
          }
          return { column, sampleIndexes, score: oldSampleIndexes.size };
        });
        // 旧 TODO サンプルの 3 以降を実際に持つ列だけを候補にする。
        // 削除済みタスクが多く候補スコアが低くても、DOING/DONE を誤って選ばない。
        const todoCandidate = candidates
          .filter((candidate) => [...candidate.sampleIndexes].some((index) => index >= 3))
          .sort((a, b) => b.score - a.score)[0];
        // 高いインデックスを見つけられなければ、列の正体を推測せず移行を次回に延期する。
        if (todoCandidate) {
          const { column, sampleIndexes } = todoCandidate;
          let ordered = state.tasks
            .filter((task) => task.columnId === column.id)
            .sort(compareBySortKey);
          for (let index = previousTodoCount; index < todoTemplates.length; index += 1) {
            if (sampleIndexes.has(index)) continue;
            // 旧テンプレートの消去済みタスクは復活させず、新規追加分だけを作成する。
            const template = todoTemplates[index]!;
            const createdAt = project.createdAt - index * 1000;
            const sample = buildTask(
              migrationOwnerId,
              createdAt,
              {
                projectId: tutorialProjectId,
                columnId: column.id,
                title: t(template.title),
                description: t(template.description),
                color: template.color,
              },
              keyAtEnd(ordered),
              column.isDoneColumn,
            );
            newTasks.push(sample);
            ordered = [...ordered, sample].sort(compareBySortKey);
            sampleIndexes.add(index);
          }
        } else {
          canMarkTutorialVersion = false;
        }
      }
    }

    // 起動途中に旧ユーザーの同期リスナーへ通知しない。dirty レコードは、認証確定後の同期で送信される。
    if (updatedTasks.length > 0 || newTasks.length > 0) {
      await commit({ tasks: [...updatedTasks, ...newTasks] }, notify, target);
    }
    // 保存は commit 成功後に行い、書き込み失敗時は次回起動で再試行できるようにする。
    if (tutorialTaskVersion !== TUTORIAL_TASKS_VERSION && canMarkTutorialVersion) {
      await d.setMeta('tutorialTaskSchemaVersion', TUTORIAL_TASKS_VERSION);
    }
    if (!(await d.getMeta('tutorialProjectId'))) {
      await d.setMeta('tutorialProjectId', tutorialProjectId);
    }
  }

  return {
    ...emptySnapshot(),
    scope: null,
    ownerId: '',
    ready: false,

    async open(scope, ownerId) {
      await enqueueDbLifecycle(async () => {
        if (db && get().ready && get().scope === scope && get().ownerId === ownerId) {
          return;
        }
        const previousState = get();
        if (db && previousState.scope && previousState.ownerId) {
          freezeSyncContexts(previousState.ownerId, previousState.scope);
        }
        set({ ready: false });
        if (db) {
          const previous = db;
          db = null;
          await closeDbWhenUnused(previous);
        }
        // 同じアカウントへ短時間で戻った場合、旧同期のDB lease／サインアウト後の削除が終わるまで待つ。
        await waitForScopeLeases(scope);
        const { db: opened, snapshot } = await openAndLoadDb(scope);
        try {
          db = opened;
          dbLogicalScopes.set(opened, scope);
          set({ ...snapshot, scope, ownerId, ready: true });
          // 見本タスクの色補完は起動を妨げる必須処理ではないため、失敗しても起動は継続する。
          try {
            await migrateTutorialTasks();
          } catch {
            // 次回の起動で再試行する。
          }
        } catch (error) {
          // close() も同じ DB キューに並ぶので、ここでは完了を待たずに起動処理を解放する。
          void opened.close().catch(() => undefined);
          db = null;
          set({ ready: false });
          throw error;
        }
      });
    },

    async close() {
      await enqueueDbLifecycle(async () => {
        const previousState = get();
        if (db && previousState.scope && previousState.ownerId) {
          freezeSyncContexts(previousState.ownerId, previousState.scope);
        }
        let closeError: unknown = null;
        if (db) {
          const previous = db;
          db = null;
          try {
            await closeDbWhenUnused(previous);
          } catch (error) {
            closeError = error;
          }
        }
        set({ ...emptySnapshot(), scope: null, ownerId: '', ready: false });
        if (closeError) throw closeError;
      });
    },

    async reload() {
      const targetDb = getDb();
      const initialState = get();
      await enqueueDataMutation(async () => {
        const snap = await targetDb.loadAll();
        if (
          db === targetDb &&
          get().ready &&
          get().ownerId === initialState.ownerId &&
          get().scope === initialState.scope
        ) {
          set({ ...snap });
        }
      });
    },

    snapshot: () => ({ projects: get().projects, columns: get().columns, tasks: get().tasks }),

    async applyRemote(changes, removed = []) {
      const d = getDb();
      const initialState = get();
      const expectedOwnerId = initialState.ownerId;
      const expectedScope = initialState.scope;
      const isTargetCurrent = () =>
        db === d &&
        get().ready &&
        get().ownerId === expectedOwnerId &&
        get().scope === expectedScope;

      await enqueueDataMutation(async () => {
        await d.applyChanges(changes, removed);
        if (isTargetCurrent()) {
          set((s) => {
            if (s.ownerId !== expectedOwnerId || s.scope !== expectedScope || !s.ready) return s;
            const drop = (table: TableName) =>
              new Set(removed.filter((r) => r.table === table).flatMap((r) => r.ids));
            const dp = drop('projects');
            const dc = drop('kanban_columns');
            const dt = drop('tasks');
            return {
              projects: upsertById(
                s.projects.filter((x) => !dp.has(x.id)),
                changes.projects,
              ),
              columns: upsertById(
                s.columns.filter((x) => !dc.has(x.id)),
                changes.columns,
              ),
              tasks: upsertById(
                s.tasks.filter((x) => !dt.has(x.id)),
                changes.tasks,
              ),
            };
          });
        }
      });
      // 別端末から取得した TUTORIAL にも未設定色を適用する。更新行は次の同期で送信する。
      if (isTargetCurrent()) {
        try {
          await migrateTutorialTasks(true);
        } catch {
          // 色補完に失敗しても同期データの適用は完了済み。次回の起動／同期で再試行する。
        }
      }
    },

    async applyRemoteForSync(target, changes, removed = []) {
      const targetDb = target.db;
      const isTargetCurrent = () =>
        db === targetDb &&
        get().ready &&
        get().ownerId === target.ownerId &&
        get().scope === target.scope;

      await enqueueDataMutation(async () => {
        const currentState = get();
        const effectiveChanges = isTargetCurrent()
          ? mergeIncomingChanges(currentState, changes)
          : {
              projects: changes.projects as Project[] | undefined,
              columns: changes.kanban_columns as KanbanColumn[] | undefined,
              tasks: changes.tasks as Task[] | undefined,
            };
        await targetDb.applyChanges(
          {
            projects: effectiveChanges.projects,
            columns: effectiveChanges.columns,
            tasks: effectiveChanges.tasks,
          },
          removed,
        );
        if (isTargetCurrent()) {
          set((s) => {
            if (s.ownerId !== target.ownerId || s.scope !== target.scope || !s.ready) return s;
            const drop = (table: TableName) =>
              new Set(removed.filter((r) => r.table === table).flatMap((r) => r.ids));
            const dp = drop('projects');
            const dc = drop('kanban_columns');
            const dt = drop('tasks');
            return {
              projects: upsertById(
                s.projects.filter((x) => !dp.has(x.id)),
                effectiveChanges.projects,
              ),
              columns: upsertById(
                s.columns.filter((x) => !dc.has(x.id)),
                effectiveChanges.columns,
              ),
              tasks: upsertById(
                s.tasks.filter((x) => !dt.has(x.id)),
                effectiveChanges.tasks,
              ),
            };
          });
        }
      });
    },

    async completeRemoteSync(target) {
      if (
        db !== target.db ||
        !get().ready ||
        get().ownerId !== target.ownerId ||
        get().scope !== target.scope
      ) {
        return;
      }
      try {
        await migrateTutorialTasks(true, target);
      } catch {
        // 色補完の失敗は同期データの保存失敗として扱わず、次回の起動／同期で再試行する。
      }
    },

    // ---- プロジェクト ----
    async createProject(input) {
      const ts = now();
      const allKeys = get().projects.slice().sort(compareBySortKey);
      const p = buildProject(owner(), ts, input, keyAtEnd(allKeys));
      await commit({ projects: [p], columns: seedColumns(p.id, ts) });
      return p;
    },

    async updateProject(id, patch) {
      const p = project(id);
      if (!p) return;
      await commit({ projects: [patchRecord(p, patch, now())] });
    },

    async setProjectArchived(id, archived) {
      const p = project(id);
      if (!p) return;
      await commit({ projects: [patchRecord(p, { archivedAt: archived ? now() : null }, now())] });
    },

    async moveArchivedProjectsToTrash(ids) {
      if (ids.length === 0) return 0;
      const wanted = new Set(ids);
      const state = get();
      const archived = state.projects.filter(
        (item) => wanted.has(item.id) && isActive(item) && item.archivedAt !== null,
      );
      if (archived.length === 0) return 0;

      const projectIds = new Set(archived.map((item) => item.id));
      const ts = now();
      const columns = state.columns.filter(
        (item) => projectIds.has(item.projectId) && isActive(item),
      );
      const tasks = state.tasks.filter((item) => projectIds.has(item.projectId) && isActive(item));
      // プロジェクトと子レコードを同じコミットで削除状態にする。
      // archivedAt は保持するため、プロジェクトを復元した場合はアーカイブ一覧へ戻る。
      await commit({
        projects: archived.map((item) => patchRecord(item, { deletedAt: ts }, ts)),
        columns: columns.map((item) => patchRecord(item, { deletedAt: ts }, ts)),
        tasks: tasks.map((item) => patchRecord(item, { deletedAt: ts }, ts)),
      });
      return archived.length;
    },

    async deleteProject(id) {
      const ts = now();
      const p = project(id);
      if (!p) return;
      const cols = get().columns.filter((c) => c.projectId === id && isActive(c));
      const tks = get().tasks.filter((x) => x.projectId === id && isActive(x));
      await commit({
        projects: [patchRecord(p, { deletedAt: ts }, ts)],
        columns: cols.map((c) => patchRecord(c, { deletedAt: ts }, ts)),
        tasks: tks.map((x) => patchRecord(x, { deletedAt: ts }, ts)),
      });
    },

    async duplicateProject(id) {
      const src = project(id);
      if (!src) return null;
      const copyTitle = src.title + t('project.copySuffix');
      if (copyTitle.length > LIMITS.projectTitleMax) {
        throw new UserActionError(
          t('operation.duplicateTitleTooLong', {
            item: t('common.project'),
            max: LIMITS.projectTitleMax,
          }),
        );
      }
      const ts = now();
      const allKeys = get().projects.slice().sort(compareBySortKey);
      const copy = buildProject(
        owner(),
        ts,
        {
          title: copyTitle,
          description: src.description,
          color: src.color,
        },
        keyAtEnd(allKeys),
      );
      const colMap = new Map<string, KanbanColumn>();
      const cols = activeColumns(id).map((c) => {
        const nc = {
          ...buildColumn(
            owner(),
            ts,
            { projectId: copy.id, title: c.title, color: c.color, isDoneColumn: c.isDoneColumn },
            c.sortKey,
          ),
          sortMode: c.sortMode,
        };
        colMap.set(c.id, nc);
        return nc;
      });
      const tks: Task[] = [];
      for (const c of activeColumns(id)) {
        const target = colMap.get(c.id)!;
        for (const x of get().tasks.filter(
          (k) => k.columnId === c.id && isActive(k) && k.archivedAt === null,
        )) {
          tks.push({
            ...buildTask(
              owner(),
              ts,
              {
                projectId: copy.id,
                columnId: target.id,
                title: x.title,
                description: x.description,
                color: x.color,
                dueAt: x.dueAt,
                dueHasTime: x.dueHasTime,
                isFavorite: x.isFavorite,
              },
              x.sortKey,
              x.completedAt !== null,
            ),
            completedAt: x.completedAt,
          });
        }
      }
      await commit({ projects: [copy], columns: cols, tasks: tks });
      return copy;
    },

    async moveProject(id, toIndex) {
      const p = project(id);
      if (!p || !isActive(p) || p.archivedAt !== null) return;
      // ピン留め領域と通常領域は独立した並び順を持つ。移動先の sortKey は
      // 同じ領域内のプロジェクトだけを使って計算し、領域の境界を越えない。
      const sorted = get()
        .projects.filter(
          (x) => isActive(x) && x.archivedAt === null && x.isFavorite === p.isFavorite,
        )
        .sort(compareBySortKey);
      if (sorted.length < 2) return;
      const targetIndex = Math.max(0, Math.min(toIndex, sorted.length - 1));
      const sortKey = keyForIndex(sorted, targetIndex, id);
      if (sortKey === p.sortKey) return;
      await commit({ projects: [patchRecord(p, { sortKey }, now())] });
    },

    // ---- カンバン ----
    async createColumn(input) {
      const cols = activeColumns(input.projectId);
      if (cols.length >= LIMITS.maxColumnsPerProject) return null;
      const col = buildColumn(owner(), now(), input, keyAtEnd(cols));
      await commit({ columns: [col] });
      return col;
    },

    async updateColumn(id, patch) {
      const c = column(id);
      if (!c) return;
      const ts = now();
      const changes: Changes = { columns: [patchRecord(c, patch, ts)] };
      // 完了列は1プロジェクトに複数あってもよいが、手動並びへの切替時はタスクにキーを振る
      if (patch.sortMode === 'manual' && c.sortMode !== 'manual') {
        const list = tasksOf(get().tasks, id, c.sortMode);
        let prev: string | null = null;
        changes.tasks = list.map((x) => {
          const key = keyForIndex(prev ? [{ id: 'p', sortKey: prev }] : [], 1);
          prev = key;
          return patchRecord(x, { sortKey: key }, ts);
        });
      }
      // DONEモードを切り替えたら、すでにあるタスクの完了日時も合わせる
      if (patch.isDoneColumn !== undefined && patch.isDoneColumn !== c.isDoneColumn) {
        const kids = get().tasks.filter((x) => x.columnId === id && isActive(x));
        changes.tasks = [
          ...(changes.tasks ?? []),
          ...kids.map((x) =>
            patchRecord(x, { completedAt: patch.isDoneColumn ? (x.completedAt ?? ts) : null }, ts),
          ),
        ];
      }
      await commit(changes);
    },

    async restoreColumnEdit(id, patch, taskStates) {
      const c = column(id);
      if (!c) return;
      const ts = now();
      const savedById = new Map(taskStates.map((item) => [item.id, item]));
      const taskChanges = get().tasks.flatMap((item) => {
        if (item.columnId !== id) return [];
        const saved = savedById.get(item.id);
        if (!saved) return [];
        const taskPatch: Partial<Pick<Task, 'sortKey' | 'completedAt'>> = {};
        if (saved.sortKey !== undefined) taskPatch.sortKey = saved.sortKey;
        if ('completedAt' in saved) taskPatch.completedAt = saved.completedAt;
        if (Object.keys(taskPatch).length === 0) return [];
        return [patchRecord(item, taskPatch, ts)];
      });
      await commit({
        columns: [patchRecord(c, patch, ts)],
        ...(taskChanges.length > 0 ? { tasks: taskChanges } : {}),
      });
    },

    async deleteColumn(id) {
      const c = column(id);
      if (!c) return;
      const ts = now();
      // カンバン内の未削除タスクは、アーカイブ状態にかかわらず一緒にごみ箱へ移す。
      const tks = get().tasks.filter((x) => x.columnId === id && isActive(x));
      const changed = tks.map((x) => patchRecord(x, { deletedAt: ts }, ts));
      await commit({ columns: [patchRecord(c, { deletedAt: ts }, ts)], tasks: changed });
    },

    async duplicateColumn(id) {
      const c = column(id);
      if (!c) return null;
      const copyTitle = c.title + t('project.copySuffix');
      if (copyTitle.length > LIMITS.columnTitleMax) {
        throw new UserActionError(
          t('operation.duplicateTitleTooLong', {
            item: t('common.column'),
            max: LIMITS.columnTitleMax,
          }),
        );
      }
      const cols = activeColumns(c.projectId);
      if (cols.length >= LIMITS.maxColumnsPerProject) {
        throw new UserActionError(
          t('operation.duplicateColumnLimit', { max: LIMITS.maxColumnsPerProject }),
        );
      }
      const ts = now();
      const idx = cols.findIndex((x) => x.id === id);
      const copy = {
        ...buildColumn(
          owner(),
          ts,
          {
            projectId: c.projectId,
            title: copyTitle,
            color: c.color,
            isDoneColumn: c.isDoneColumn,
          },
          keyForIndex(cols, idx + 1),
        ),
        sortMode: c.sortMode,
      };
      const tks = get()
        .tasks.filter((x) => x.columnId === id && isActive(x) && x.archivedAt === null)
        .map((x) => ({
          ...buildTask(
            owner(),
            ts,
            {
              projectId: c.projectId,
              columnId: copy.id,
              title: x.title,
              description: x.description,
              color: x.color,
              dueAt: x.dueAt,
              dueHasTime: x.dueHasTime,
              isFavorite: x.isFavorite,
            },
            x.sortKey,
            x.completedAt !== null,
          ),
          completedAt: x.completedAt,
        }));
      await commit({ columns: [copy], tasks: tks });
      return copy;
    },

    async moveColumn(id, toIndex) {
      const c = column(id);
      if (!c) return;
      const cols = activeColumns(c.projectId);
      await commit({
        columns: [patchRecord(c, { sortKey: keyForIndex(cols, toIndex, id) }, now())],
      });
    },

    // ---- タスク ----
    async createTask(input) {
      const col = column(input.columnId);
      if (!col) return null;
      const list = tasksOf(get().tasks, col.id, col.sortMode);
      const tk = buildTask(
        owner(),
        now(),
        input,
        keyAtStart(list.slice().sort(compareBySortKey)),
        col.isDoneColumn,
      );
      await commit({ tasks: [tk] });
      return tk;
    },

    async updateTask(id, patch) {
      const x = task(id);
      if (!x) return;
      await commit({ tasks: [patchRecord(x, patch, now())] });
    },

    async moveTask(id, toColumnId) {
      const x = task(id);
      const target = column(toColumnId);
      if (!x || !target || x.columnId === toColumnId) return;
      const ts = now();
      const sibs = get()
        .tasks.filter((k) => k.columnId === toColumnId && isActive(k))
        .sort(compareBySortKey);
      await commit({ tasks: [patchRecord(x, moveTaskPatch(target, ts, keyAtStart(sibs)), ts)] });
    },

    async reorderTask(id, toIndex) {
      const x = task(id);
      const col = x ? column(x.columnId) : undefined;
      if (!x || !col || col.sortMode !== 'manual') return;
      const list = tasksOf(get().tasks, col.id, 'manual');
      await commit({ tasks: [patchRecord(x, { sortKey: keyForIndex(list, toIndex, id) }, now())] });
    },

    async deleteTask(id) {
      const x = task(id);
      if (!x) return;
      const ts = now();
      await commit({ tasks: [patchRecord(x, { deletedAt: ts }, ts)] });
    },

    async duplicateTask(id) {
      const x = task(id);
      if (!x) return null;
      const copyTitle = x.title + t('project.copySuffix');
      if (copyTitle.length > LIMITS.taskTitleMax) {
        throw new UserActionError(
          t('operation.duplicateTitleTooLong', {
            item: t('common.task'),
            max: LIMITS.taskTitleMax,
          }),
        );
      }
      const col = column(x.columnId);
      const ts = now();
      const copy = {
        ...buildTask(
          owner(),
          ts,
          {
            projectId: x.projectId,
            columnId: x.columnId,
            title: copyTitle,
            description: x.description,
            color: x.color,
            dueAt: x.dueAt,
            dueHasTime: x.dueHasTime,
            isFavorite: x.isFavorite,
          },
          x.sortKey,
          !!col?.isDoneColumn,
        ),
      };
      await commit({ tasks: [copy] });
      return copy;
    },

    async archiveTask(id, archived) {
      const x = task(id);
      if (!x) return;
      const ts = now();
      await commit({ tasks: [patchRecord(x, { archivedAt: archived ? ts : null }, ts)] });
    },

    async archiveDoneTasks(projectId) {
      const doneColumns = new Set(
        activeColumns(projectId)
          .filter((c) => c.isDoneColumn)
          .map((c) => c.id),
      );
      const ts = now();
      const targets = get().tasks.filter(
        (x) =>
          x.projectId === projectId &&
          isActive(x) &&
          x.archivedAt === null &&
          doneColumns.has(x.columnId),
      );
      if (targets.length === 0) return 0;
      await commit({ tasks: targets.map((x) => patchRecord(x, { archivedAt: ts }, ts)) });
      return targets.length;
    },

    async moveArchivedTasksToTrash(ids, at) {
      if (ids.length === 0) return 0;
      const wanted = new Set(ids);
      const changed = get()
        .tasks.filter((x) => wanted.has(x.id) && isActive(x) && x.archivedAt !== null)
        .map((x) => patchRecord(x, { archivedAt: null, deletedAt: at }, at));
      if (changed.length === 0) return 0;
      await commit({ tasks: changed });
      return changed.length;
    },

    // ---- ごみ箱 ----
    async restoreItem(kind, id) {
      const ts = now();
      const s = get();
      if (kind === 'task') {
        const x = task(id);
        if (x) await commit({ tasks: [patchRecord(x, { deletedAt: null }, ts)] });
      } else if (kind === 'column') {
        const c = column(id);
        if (!c) return;
        const deletedAt = c.deletedAt;
        const kids = s.tasks.filter((x) => x.columnId === id && x.deletedAt === deletedAt);
        await commit({
          columns: [patchRecord(c, { deletedAt: null }, ts)],
          tasks: kids.map((x) => patchRecord(x, { deletedAt: null }, ts)),
        });
      } else {
        const p = project(id);
        if (!p) return;
        const deletedAt = p.deletedAt;
        const cols = s.columns.filter((c) => c.projectId === id && c.deletedAt === deletedAt);
        const tks = s.tasks.filter((x) => x.projectId === id && x.deletedAt === deletedAt);
        await commit({
          projects: [patchRecord(p, { deletedAt: null }, ts)],
          columns: cols.map((c) => patchRecord(c, { deletedAt: null }, ts)),
          tasks: tks.map((x) => patchRecord(x, { deletedAt: null }, ts)),
        });
      }
    },

    async purgeLocal(ids) {
      const removed = [
        { table: 'projects' as const, ids: ids.projects },
        { table: 'kanban_columns' as const, ids: ids.columns },
        { table: 'tasks' as const, ids: ids.tasks },
      ];
      await get().applyRemote({}, removed);
    },

    async seedTutorial() {
      const d = getDb();
      const findTutorialId = () =>
        get().projects.find(
          (p) =>
            p.title === t(TUTORIAL_PROJECT_TITLE) &&
            p.color === TUTORIAL_PROJECT_COLOR &&
            isActive(p) &&
            p.archivedAt === null,
        )?.id ?? null;

      if (await d.getMeta('tutorialSeeded')) {
        await migrateTutorialTasks(true);
        return (await d.getMeta('tutorialProjectId')) ?? findTutorialId();
      }
      if (get().projects.length > 0) {
        await d.setMeta('tutorialSeeded', '1');
        return findTutorialId();
      }

      const ts = now();
      const project = buildProject(
        owner(),
        ts,
        { title: t(TUTORIAL_PROJECT_TITLE), color: TUTORIAL_PROJECT_COLOR },
        keyAtEnd([]),
      );
      const columns = seedColumns(project.id, ts);
      const tasks: Task[] = [];
      columns.forEach((column, ci) => {
        let key: string | null = null;
        (TUTORIAL_TASKS[ci] ?? []).forEach((item, i) => {
          key = keyForIndex(key ? [{ id: 'x', sortKey: key }] : [], 1);
          // 上から順に並ぶよう、更新日を少しずつずらす
          tasks.push(
            buildTask(
              owner(),
              ts - i * 1000,
              {
                projectId: project.id,
                columnId: column.id,
                title: t(item.title),
                description: t(item.description),
                color: item.color,
              },
              key,
              column.isDoneColumn,
            ),
          );
        });
      });
      await commit({ projects: [project], columns, tasks });
      await d.setMeta('tutorialSeeded', '1');
      await d.setMeta('tutorialProjectId', project.id);
      await d.setMeta('tutorialTaskSchemaVersion', TUTORIAL_TASKS_VERSION);
      return project.id;
    },

    async importBoards(boards) {
      // 呼び出し元にかかわらず、上限超過を含むデータを一部だけ保存することはしない。
      validateImportedBoards(boards);
      const ts = now();
      const projects: Project[] = [];
      const columns: KanbanColumn[] = [];
      const tasks: Task[] = [];
      let projectKey = keyAtEnd(get().projects.slice().sort(compareBySortKey));
      for (const b of boards) {
        const p = buildProject(
          owner(),
          ts,
          { title: b.title || '-', description: b.description, color: b.color },
          projectKey,
        );
        projectKey = keyForIndex([{ id: 'x', sortKey: projectKey }], 1);
        const pArchived = b.archived ? patchRecord(p, { archivedAt: ts }, ts) : p;
        projects.push(pArchived);
        let colKey: string | null = null;
        for (const bc of b.columns) {
          colKey = keyForIndex(colKey ? [{ id: 'x', sortKey: colKey }] : [], 1);
          const col = buildColumn(
            owner(),
            ts,
            { projectId: p.id, title: bc.title, isDoneColumn: bc.isDone },
            colKey,
          );
          columns.push(col);
          let taskKey: string | null = null;
          for (const bt of bc.tasks) {
            taskKey = keyForIndex(taskKey ? [{ id: 'x', sortKey: taskKey }] : [], 1);
            const tk = buildTask(
              owner(),
              ts,
              {
                projectId: p.id,
                columnId: col.id,
                title: bt.title,
                description: bt.description,
                color: bt.color,
                dueAt: bt.dueAt,
                dueHasTime: false,
                isFavorite: bt.isFavorite,
              },
              taskKey,
              bt.completed || bc.isDone,
            );
            tasks.push(bt.archived ? patchRecord(tk, { archivedAt: ts }, ts) : tk);
          }
        }
      }
      await commit({ projects, columns, tasks });
      return projects.length;
    },
  };
});

export { purgeTargets };
export type { AnyRecord, ColumnSortMode, TaskColorKey };

export interface SyncLocalContext {
  snapshot: () => Snapshot;
  apply: (
    changes: Partial<Record<TableName, AnyRecord[]>>,
    removed: { table: TableName; ids: string[] }[],
  ) => Promise<void>;
  getMeta: (key: string) => Promise<string | null>;
  setMeta: (key: string, value: string) => Promise<void>;
  /** 同期の全ページが完了した後に一度だけ実行する処理。 */
  afterSync: () => Promise<void>;
  release: () => Promise<void>;
}

/**
 * 同期開始時のアカウント／DBを固定する。画面のアカウントが切り替わっても、
 * 実行中の同期は開始時のDBだけを書き換え、新しいアカウントのZustand状態には触れない。
 */
export function captureSyncLocalContext(expectedOwnerId: string): SyncLocalContext {
  const initialState = useDataStore.getState();
  if (!initialState.ready || initialState.ownerId !== expectedOwnerId || !initialState.scope) {
    throw new Error('Sync local database does not match the active account');
  }
  const target: SyncDbTarget = {
    ownerId: initialState.ownerId,
    scope: initialState.scope,
    db: getDb(),
  };
  dbLeaseCounts.set(target.db, (dbLeaseCounts.get(target.db) ?? 0) + 1);
  let frozenSnapshot: Snapshot = initialState.snapshot();
  let released = false;
  const isCurrent = () => {
    const state = useDataStore.getState();
    return (
      db === target.db &&
      state.ready &&
      state.ownerId === target.ownerId &&
      state.scope === target.scope
    );
  };
  const freeze = () => {
    if (isCurrent()) frozenSnapshot = useDataStore.getState().snapshot();
  };
  const registration: SyncContextRegistration = {
    ownerId: target.ownerId,
    scope: target.scope,
    db: target.db,
    freeze,
  };
  syncContextRegistrations.add(registration);

  const updateFrozenSnapshot = (
    changes: Partial<Record<TableName, AnyRecord[]>>,
    removed: { table: TableName; ids: string[] }[],
  ) => {
    const removedByTable = (table: TableName) =>
      new Set(removed.filter((item) => item.table === table).flatMap((item) => item.ids));
    frozenSnapshot = {
      projects: upsertById(
        frozenSnapshot.projects.filter((item) => !removedByTable('projects').has(item.id)),
        changes.projects as Project[] | undefined,
      ),
      columns: upsertById(
        frozenSnapshot.columns.filter((item) => !removedByTable('kanban_columns').has(item.id)),
        changes.kanban_columns as KanbanColumn[] | undefined,
      ),
      tasks: upsertById(
        frozenSnapshot.tasks.filter((item) => !removedByTable('tasks').has(item.id)),
        changes.tasks as Task[] | undefined,
      ),
    };
  };

  return {
    snapshot: () => {
      if (isCurrent()) frozenSnapshot = useDataStore.getState().snapshot();
      return frozenSnapshot;
    },
    apply: async (changes, removed) => {
      await useDataStore.getState().applyRemoteForSync(target, changes, removed);
      if (isCurrent()) frozenSnapshot = useDataStore.getState().snapshot();
      else updateFrozenSnapshot(changes, removed);
    },
    getMeta: (key) => target.db.getMeta(key),
    setMeta: (key, value) => target.db.setMeta(key, value),
    afterSync: async () => {
      await useDataStore.getState().completeRemoteSync(target);
      if (isCurrent()) frozenSnapshot = useDataStore.getState().snapshot();
    },
    release: async () => {
      if (released) return;
      released = true;
      syncContextRegistrations.delete(registration);
      await releaseDbLease(target.db);
    },
  };
}

/** サインアウト後のローカルDB削除。同期がそのDBを使用中なら、完了後に削除する。 */
export function destroyLocalDbWhenUnused(scope: string): Promise<void> {
  const existing = pendingDbDestroyScopes.get(scope);
  if (existing) return existing.promise;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 同期中かどうかにかかわらず削除要求を登録し、同じアカウントの再ログインと競合させない。
  pendingDbDestroyScopes.set(scope, { promise, resolve, reject });
  void flushPendingDbDestruction();
  return promise;
}
