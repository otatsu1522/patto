import { create } from 'zustand';
import { DEFAULT_COLUMNS } from '@/config/defaults';
import { TUTORIAL_PROJECT_COLOR, TUTORIAL_PROJECT_TITLE, TUTORIAL_TASKS } from '@/config/tutorial';
import { LIMITS } from '@/config/limits';
import { openLocalDb } from '@/db/sqliteDb';
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
import type { ImportedBoard } from '@/domain/trello';
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

type Listener = () => void;
const changeListeners = new Set<Listener>();
/** ローカルのデータが変わったときに呼ばれる（自動同期のきっかけに使う）。 */
export const onLocalChange = (fn: Listener): (() => void) => {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
};

let db: LocalDb | null = null;
/** 同期層などから DB に直接アクセスするための入口 */
export const getDb = (): LocalDb => {
  if (!db) throw new Error('DB が開かれていません');
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

interface DataState extends Snapshot {
  scope: string | null;
  ownerId: string;
  ready: boolean;

  open: (scope: string, ownerId: string) => Promise<void>;
  close: () => Promise<void>;
  /** 同期層からの書き込み（変更通知は発火しない） */
  applyRemote: (changes: Changes, removed?: { table: TableName; ids: string[] }[]) => Promise<void>;
  reload: () => Promise<void>;
  snapshot: () => Snapshot;

  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (
    id: string,
    patch: Partial<Pick<Project, 'title' | 'description' | 'color' | 'isFavorite'>>,
  ) => Promise<void>;
  setProjectArchived: (id: string, archived: boolean) => Promise<void>;
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
  deleteColumn: (id: string, moveTasksToColumnId: string | null) => Promise<void>;
  duplicateColumn: (id: string) => Promise<void>;
  moveColumn: (id: string, toIndex: number) => Promise<void>;

  createTask: (input: TaskInput) => Promise<Task | null>;
  updateTask: (
    id: string,
    patch: Partial<
      Pick<Task, 'title' | 'description' | 'color' | 'dueAt' | 'dueHasTime' | 'isFavorite'>
    >,
  ) => Promise<void>;
  moveTask: (id: string, toColumnId: string) => Promise<void>;
  reorderTask: (id: string, toIndex: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  duplicateTask: (id: string) => Promise<void>;
  archiveTask: (id: string, archived: boolean) => Promise<void>;
  archiveDoneTasks: (projectId: string) => Promise<number>;

  restoreItem: (kind: 'project' | 'column' | 'task', id: string) => Promise<void>;
  /** 指定IDを端末から完全に削除する（サーバー側の削除は呼び出し側で先に行う） */
  purgeLocal: (ids: { projects: string[]; columns: string[]; tasks: string[] }) => Promise<void>;
  importBoards: (boards: ImportedBoard[]) => Promise<number>;
  /** 初回だけ、サンプルプロジェクト（TUTORIAL）を作り、そのIDを返す */
  seedTutorial: () => Promise<string | null>;
}

export const useDataStore = create<DataState>((set, get) => {
  /** 変更をメモリに反映し、DBへ保存して、変更通知を出す。 */
  async function commit(changes: Changes, notify = true): Promise<void> {
    set((s) => ({
      projects: upsertById(s.projects, changes.projects),
      columns: upsertById(s.columns, changes.columns),
      tasks: upsertById(s.tasks, changes.tasks),
    }));
    const d = getDb();
    await d.upsert('projects', changes.projects ?? []);
    await d.upsert('kanban_columns', changes.columns ?? []);
    await d.upsert('tasks', changes.tasks ?? []);
    if (notify) changeListeners.forEach((fn) => fn());
  }

  const now = () => nowMs();
  const owner = () => get().ownerId;

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

  return {
    ...emptySnapshot(),
    scope: null,
    ownerId: '',
    ready: false,

    async open(scope, ownerId) {
      if (db) await db.close();
      db = await openLocalDb(scope);
      const snap = await db.loadAll();
      set({ ...snap, scope, ownerId, ready: true });
    },

    async close() {
      if (db) await db.close();
      db = null;
      set({ ...emptySnapshot(), scope: null, ownerId: '', ready: false });
    },

    async reload() {
      const snap = await getDb().loadAll();
      set({ ...snap });
    },

    snapshot: () => ({ projects: get().projects, columns: get().columns, tasks: get().tasks }),

    async applyRemote(changes, removed = []) {
      const d = getDb();
      for (const r of removed) await d.remove(r.table, r.ids);
      set((s) => {
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
      await d.upsert('projects', changes.projects ?? []);
      await d.upsert('kanban_columns', changes.columns ?? []);
      await d.upsert('tasks', changes.tasks ?? []);
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
      const ts = now();
      const allKeys = get().projects.slice().sort(compareBySortKey);
      const copy = buildProject(
        owner(),
        ts,
        {
          title: src.title + t('project.copySuffix'),
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
      if (!p) return;
      const sorted = get()
        .projects.filter((x) => isActive(x) && x.archivedAt === null)
        .sort(compareBySortKey);
      await commit({
        projects: [patchRecord(p, { sortKey: keyForIndex(sorted, toIndex, id) }, now())],
      });
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

    async deleteColumn(id, moveTo) {
      const c = column(id);
      if (!c) return;
      const ts = now();
      const target = moveTo ? column(moveTo) : undefined;
      const tks = get().tasks.filter((x) => x.columnId === id && isActive(x));
      const changed = tks.map((x) =>
        target
          ? patchRecord(x, moveTaskPatch(target, ts), ts)
          : patchRecord(x, { deletedAt: ts }, ts),
      );
      await commit({ columns: [patchRecord(c, { deletedAt: ts }, ts)], tasks: changed });
    },

    async duplicateColumn(id) {
      const c = column(id);
      if (!c) return;
      const cols = activeColumns(c.projectId);
      if (cols.length >= LIMITS.maxColumnsPerProject) return;
      const ts = now();
      const idx = cols.findIndex((x) => x.id === id);
      const copy = {
        ...buildColumn(
          owner(),
          ts,
          {
            projectId: c.projectId,
            title: c.title + t('project.copySuffix'),
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
      if (!x) return;
      const col = column(x.columnId);
      const ts = now();
      const copy = {
        ...buildTask(
          owner(),
          ts,
          {
            projectId: x.projectId,
            columnId: x.columnId,
            title: x.title + t('project.copySuffix'),
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
      return project.id;
    },

    async importBoards(boards) {
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
