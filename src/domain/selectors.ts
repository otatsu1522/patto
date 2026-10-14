import { SEARCH } from '@/config/limits';
import { compareBySortKey, compareTasks } from './ordering';
import type { ColumnSortMode, KanbanColumn, Project, Task } from './types';

export const isActive = (r: { deletedAt: number | null }): boolean => r.deletedAt === null;

/** プロジェクト一覧（お気に入りが上、その後は並び順）。アーカイブ・削除済みは除く。 */
export function visibleProjects(projects: Project[]): Project[] {
  return projects
    .filter((p) => isActive(p) && p.archivedAt === null)
    .sort((a, b) =>
      a.isFavorite !== b.isFavorite ? (a.isFavorite ? -1 : 1) : compareBySortKey(a, b),
    );
}

export const archivedProjects = (projects: Project[]): Project[] =>
  projects.filter((p) => isActive(p) && p.archivedAt !== null).sort(compareBySortKey);

export const columnsOf = (columns: KanbanColumn[], projectId: string): KanbanColumn[] =>
  columns.filter((c) => c.projectId === projectId && isActive(c)).sort(compareBySortKey);

/** カンバン内のタスク（アーカイブ・削除済みを除く）をカンバンの並び順で返す。 */
export function tasksOf(tasks: Task[], columnId: string, mode: ColumnSortMode): Task[] {
  return tasks
    .filter((t) => t.columnId === columnId && isActive(t) && t.archivedAt === null)
    .sort(compareTasks(mode));
}

const matches = (task: Task, q: string): boolean =>
  task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q);

/**
 * タスク検索。projectId を渡すとそのプロジェクト内のみ、省略すると全プロジェクトが対象。
 * 有効なプロジェクト・カンバンに属する、削除・アーカイブされていないタスクだけを返す。
 */
export function searchTasks(
  data: { projects: Project[]; columns: KanbanColumn[]; tasks: Task[] },
  query: string,
  projectId?: string,
): Task[] {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH.minLength) return [];
  const liveProjects = new Set(visibleProjects(data.projects).map((p) => p.id));
  const liveColumns = new Set(data.columns.filter(isActive).map((c) => c.id));
  return data.tasks
    .filter(
      (t) =>
        isActive(t) &&
        t.archivedAt === null &&
        liveProjects.has(t.projectId) &&
        liveColumns.has(t.columnId) &&
        (projectId === undefined || t.projectId === projectId) &&
        matches(t, q),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SEARCH.maxResults);
}

export const archivedTasks = (tasks: Task[], projectId?: string): Task[] =>
  tasks
    .filter(
      (t) =>
        isActive(t) &&
        t.archivedAt !== null &&
        (projectId === undefined || t.projectId === projectId),
    )
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

export type TrashItem =
  | { kind: 'project'; record: Project }
  | { kind: 'column'; record: KanbanColumn }
  | { kind: 'task'; record: Task };

/**
 * ごみ箱の一覧。親ごと削除されたものは親だけを並べる（復元すると子も一緒に戻る）。
 * projectId を渡すと、そのプロジェクト内のカンバン・タスクのみ（プロジェクト自体は含めない）。
 */
export function trashItems(
  data: { projects: Project[]; columns: KanbanColumn[]; tasks: Task[] },
  projectId?: string,
): TrashItem[] {
  const deletedProjects = new Set(data.projects.filter((p) => !isActive(p)).map((p) => p.id));
  const deletedColumns = new Set(data.columns.filter((c) => !isActive(c)).map((c) => c.id));
  const items: TrashItem[] = [];
  if (projectId === undefined) {
    for (const p of data.projects) if (!isActive(p)) items.push({ kind: 'project', record: p });
  }
  for (const c of data.columns) {
    if (isActive(c) || deletedProjects.has(c.projectId)) continue;
    if (projectId === undefined || c.projectId === projectId)
      items.push({ kind: 'column', record: c });
  }
  for (const t of data.tasks) {
    if (isActive(t) || deletedProjects.has(t.projectId) || deletedColumns.has(t.columnId)) continue;
    if (projectId === undefined || t.projectId === projectId)
      items.push({ kind: 'task', record: t });
  }
  return items.sort((a, b) => (b.record.deletedAt ?? 0) - (a.record.deletedAt ?? 0));
}

/** 完全削除の対象（ごみ箱に入っている全行）。projectId 指定でそのプロジェクトのみ。 */
export function purgeTargets(
  data: { projects: Project[]; columns: KanbanColumn[]; tasks: Task[] },
  kind: 'trash' | 'archive',
  projectId?: string,
): { projects: string[]; columns: string[]; tasks: string[] } {
  const inScope = (pid: string) => projectId === undefined || pid === projectId;
  if (kind === 'archive') {
    return {
      projects: [],
      columns: [],
      tasks: data.tasks
        .filter((t) => isActive(t) && t.archivedAt !== null && inScope(t.projectId))
        .map((t) => t.id),
    };
  }
  return {
    projects:
      projectId === undefined ? data.projects.filter((p) => !isActive(p)).map((p) => p.id) : [],
    columns: data.columns.filter((c) => !isActive(c) && inScope(c.projectId)).map((c) => c.id),
    tasks: data.tasks.filter((t) => !isActive(t) && inScope(t.projectId)).map((t) => t.id),
  };
}

export const countTargets = (t: {
  projects: string[];
  columns: string[];
  tasks: string[];
}): number => t.projects.length + t.columns.length + t.tasks.length;
