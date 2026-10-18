import type { TaskColorKey } from '@/theme/taskColors';

export type TableName = 'projects' | 'kanban_columns' | 'tasks';
export type ColumnSortBaseMode = 'updated' | 'created' | 'due' | 'color' | 'manual';
/**
 * sortMode は既存の値を維持しつつ、必要な場合だけ :asc / :desc を付けて方向を保存する。
 * 既存データの 'updated' などは従来どおりの方向として扱う。
 */
export type ColumnSortMode =
  ColumnSortBaseMode | `${Exclude<ColumnSortBaseMode, 'manual'>}:${'asc' | 'desc'}`;

/** すべての同期対象レコードに共通の項目。 */
export interface BaseRecord {
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  /** ごみ箱に入れた日時（null なら有効） */
  deletedAt: number | null;
  /** 項目ごとの最終更新時刻。競合のマージに使う */
  fieldUpdatedAt: Record<string, number>;
  /** 端末のみ: 未送信の変更があるか */
  dirty: boolean;
}

export interface Project extends BaseRecord {
  title: string;
  description: string;
  color: TaskColorKey | null;
  isFavorite: boolean;
  sortKey: string;
  archivedAt: number | null;
}

export interface KanbanColumn extends BaseRecord {
  projectId: string;
  title: string;
  color: TaskColorKey | null;
  sortKey: string;
  sortMode: ColumnSortMode;
  isDoneColumn: boolean;
}

export interface Task extends BaseRecord {
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  color: TaskColorKey | null;
  dueAt: number | null;
  dueHasTime: boolean;
  isFavorite: boolean;
  sortKey: string;
  completedAt: number | null;
  archivedAt: number | null;
}

export type AnyRecord = Project | KanbanColumn | Task;

export interface Snapshot {
  projects: Project[];
  columns: KanbanColumn[];
  tasks: Task[];
}

export const emptySnapshot = (): Snapshot => ({ projects: [], columns: [], tasks: [] });
