import { newId } from '@/lib/ids';
import type { TaskColorKey } from '@/theme/taskColors';
import { mergeableFields } from './schema';
import type { BaseRecord, KanbanColumn, Project, TableName, Task } from './types';

/**
 * 変更した項目だけ fieldUpdatedAt を更新して返す。変更がなければ元のレコードをそのまま返す。
 * すべての更新はこの関数を通すことで、同期時の項目単位マージが正しく働く。
 */
export function patchRecord<T extends BaseRecord>(
  rec: T,
  patch: Partial<NoInfer<T>>,
  now: number,
): T {
  const src = rec as unknown as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  const stamps: Record<string, number> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(src[key] ?? null) !== JSON.stringify(value ?? null)) {
      changes[key] = value ?? null;
      stamps[key] = now;
    }
  }
  if (Object.keys(changes).length === 0) return rec;
  return {
    ...rec,
    ...changes,
    updatedAt: now,
    fieldUpdatedAt: { ...rec.fieldUpdatedAt, ...stamps },
    dirty: true,
  } as T;
}

function base(table: TableName, ownerId: string, now: number): BaseRecord {
  const stamps: Record<string, number> = {};
  for (const f of mergeableFields(table)) stamps[f] = now;
  return {
    id: newId(),
    ownerId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    fieldUpdatedAt: stamps,
    dirty: true,
  };
}

export interface ProjectInput {
  title: string;
  description?: string;
  color?: TaskColorKey | null;
}

export const buildProject = (
  ownerId: string,
  now: number,
  input: ProjectInput,
  sortKey: string,
): Project => ({
  ...base('projects', ownerId, now),
  title: input.title.trim(),
  description: input.description ?? '',
  color: input.color ?? null,
  isFavorite: false,
  sortKey,
  archivedAt: null,
});

export interface ColumnInput {
  projectId: string;
  title: string;
  color?: TaskColorKey | null;
  isDoneColumn?: boolean;
}

export const buildColumn = (
  ownerId: string,
  now: number,
  input: ColumnInput,
  sortKey: string,
): KanbanColumn => ({
  ...base('kanban_columns', ownerId, now),
  projectId: input.projectId,
  title: input.title.trim(),
  color: input.color ?? null,
  sortKey,
  sortMode: 'updated',
  isDoneColumn: input.isDoneColumn ?? false,
});

export interface TaskInput {
  projectId: string;
  columnId: string;
  title: string;
  description?: string;
  color?: TaskColorKey | null;
  dueAt?: number | null;
  dueHasTime?: boolean;
  isFavorite?: boolean;
}

export const buildTask = (
  ownerId: string,
  now: number,
  input: TaskInput,
  sortKey: string,
  inDoneColumn: boolean,
): Task => ({
  ...base('tasks', ownerId, now),
  projectId: input.projectId,
  columnId: input.columnId,
  title: input.title.trim(),
  description: input.description ?? '',
  color: input.color ?? null,
  dueAt: input.dueAt ?? null,
  dueHasTime: input.dueHasTime ?? false,
  isFavorite: input.isFavorite ?? false,
  sortKey,
  completedAt: inDoneColumn ? now : null,
  archivedAt: null,
});

/** タスクを別のカンバンへ移すときの変更内容（完了列なら完了日時を記録する）。 */
export const moveTaskPatch = (
  target: KanbanColumn,
  now: number,
  sortKey?: string,
): Partial<Task> => ({
  columnId: target.id,
  completedAt: target.isDoneColumn ? now : null,
  ...(sortKey ? { sortKey } : {}),
});
