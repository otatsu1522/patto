import { LIMITS } from '@/config/limits';
import { UserActionError } from '@/domain/operationError';
import { t } from '@/i18n';
import { isTaskColorKey, TASK_COLORS, type TaskColorKey } from '@/theme/taskColors';
import { compareBySortKey } from './ordering';
import { isActive } from './selectors';
import type { KanbanColumn, Project, Task } from './types';
import { DIAGNOSTIC_MESSAGES } from '@/config/diagnostics';
import { TRELLO_FORMAT } from '@/config/trello';

/** Trello のボードJSONと相互変換する（アプリ移行用）。純粋関数のみ。 */

export interface ImportedTask {
  title: string;
  description: string;
  color: TaskColorKey | null;
  dueAt: number | null;
  completed: boolean;
  archived: boolean;
  isFavorite: boolean;
}
export interface ImportedColumn {
  title: string;
  isDone: boolean;
  tasks: ImportedTask[];
}
export interface ImportedBoard {
  title: string;
  description: string;
  color: TaskColorKey | null;
  archived: boolean;
  columns: ImportedColumn[];
}

const iso = (ts: number) => new Date(ts).toISOString();

export function exportBoards(
  data: { projects: Project[]; columns: KanbanColumn[]; tasks: Task[] },
  projectIds: string[],
): string {
  const boards = data.projects
    .filter((p) => isActive(p) && projectIds.includes(p.id))
    .sort(compareBySortKey)
    .map((p) => {
      const columns = data.columns
        .filter((c) => c.projectId === p.id && isActive(c))
        .sort(compareBySortKey);
      const tasks = data.tasks.filter((t) => t.projectId === p.id && isActive(t));
      const usedColors = Array.from(
        new Set(tasks.map((t) => t.color).filter((c): c is TaskColorKey => !!c)),
      );
      return {
        id: p.id,
        name: p.title,
        desc: p.description,
        closed: p.archivedAt !== null,
        prefs: { background: p.color ?? TRELLO_FORMAT.defaultBoardColor },
        labels: usedColors.map((c) => ({
          id: c,
          idBoard: p.id,
          name: TRELLO_FORMAT.emptyLabelName,
          color: c,
        })),
        lists: columns.map((c, i) => ({
          id: c.id,
          name: c.title,
          closed: false,
          idBoard: p.id,
          pos: (i + 1) * TRELLO_FORMAT.positionStep,
        })),
        cards: tasks.sort(compareBySortKey).map((t, i) => ({
          id: t.id,
          name: t.title,
          desc: t.description,
          closed: t.archivedAt !== null,
          idBoard: p.id,
          idList: t.columnId,
          idLabels: t.color ? [t.color] : [],
          labels: t.color
            ? [{ id: t.color, idBoard: p.id, name: TRELLO_FORMAT.emptyLabelName, color: t.color }]
            : [],
          due: t.dueAt !== null ? iso(t.dueAt) : null,
          dueComplete: t.completedAt !== null,
          pos: (i + 1) * TRELLO_FORMAT.positionStep,
          dateLastActivity: iso(t.updatedAt),
          pattoFavorite: t.isFavorite,
        })),
        actions: [],
        checklists: [],
        members: [],
      };
    });
  return JSON.stringify(boards.length === 1 ? boards[0] : boards, null, 2);
}

const toColor = (v: unknown): TaskColorKey | null => {
  if (typeof v !== 'string') return null;
  const key = v.replace(/_(light|dark)$/, '');
  if (isTaskColorKey(key)) return key;
  return TRELLO_FORMAT.colorAliases[key] ?? null;
};

const displayName = (value: string): string =>
  value.length > LIMITS.importPreviewNameMax
    ? `${value.slice(0, LIMITS.importPreviewNameMax)}…`
    : value;

function validateImportedTitle(title: string, max: number, boardTitle: string, item: string): void {
  if (title.length <= max) return;
  throw new UserActionError(
    t('operation.importTitleTooLong', {
      board: displayName(boardTitle || '-'),
      item,
      title: displayName(title || '-'),
      length: title.length,
      max,
    }),
  );
}

function validateImportedDescription(
  description: string,
  boardTitle: string,
  taskTitle: string,
): void {
  if (description.length <= LIMITS.taskDescriptionMax) return;
  throw new UserActionError(
    t('operation.importDescriptionTooLong', {
      board: displayName(boardTitle || '-'),
      title: displayName(taskTitle || '-'),
      length: description.length,
      max: LIMITS.taskDescriptionMax,
    }),
  );
}

export function validateImportedBoards(boards: ImportedBoard[]): void {
  for (const board of boards) {
    const boardTitle = board.title || '-';
    validateImportedTitle(boardTitle, LIMITS.projectTitleMax, boardTitle, t('common.project'));
    if (board.columns.length > LIMITS.maxColumnsPerProject) {
      throw new UserActionError(
        t('operation.importColumnLimit', {
          board: displayName(boardTitle),
          count: board.columns.length,
          max: LIMITS.maxColumnsPerProject,
        }),
      );
    }
    for (const column of board.columns) {
      validateImportedTitle(column.title, LIMITS.columnTitleMax, boardTitle, t('common.column'));
      for (const task of column.tasks) {
        validateImportedTitle(task.title, LIMITS.taskTitleMax, boardTitle, t('common.task'));
        validateImportedDescription(task.description, boardTitle, task.title);
      }
    }
  }
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const asArr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(asObj) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Trello の JSON 文字列を解析する。形式が違う場合は例外を投げる。 */
export function parseTrello(text: string): ImportedBoard[] {
  const json: unknown = JSON.parse(text);
  const boards = Array.isArray(json) ? json : [json];
  const result = boards.map((raw) => {
    const b = asObj(raw);
    const lists = asArr(b.lists);
    if (typeof b.name !== 'string' || (lists.length === 0 && !Array.isArray(b.cards))) {
      throw new Error(DIAGNOSTIC_MESSAGES.invalidTrelloBoard);
    }
    const cards = asArr(b.cards);
    const boardTitle = str(b.name);
    const activeLists = lists.filter((l) => l.closed !== true);
    const columns: ImportedColumn[] = activeLists
      .sort((x, y) => Number(x.pos ?? 0) - Number(y.pos ?? 0))
      .map((l) => ({
        title: str(l.name) || '-',
        isDone: TRELLO_FORMAT.doneColumnPattern.test(str(l.name).trim()),
        tasks: cards
          .filter((c) => c.idList === l.id)
          .sort((x, y) => Number(x.pos ?? 0) - Number(y.pos ?? 0))
          .map((c): ImportedTask => {
            const due = typeof c.due === 'string' ? Date.parse(c.due) : NaN;
            const label = asArr(c.labels)[0];
            return {
              title: str(c.name) || '-',
              description: str(c.desc),
              color: toColor(label?.color),
              dueAt: Number.isNaN(due) ? null : due,
              completed: c.dueComplete === true,
              archived: c.closed === true,
              isFavorite: c.pattoFavorite === true,
            };
          }),
      }));
    const bg = asObj(b.prefs).background;
    return {
      title: boardTitle,
      description: str(b.desc),
      color:
        toColor(bg) ?? (typeof bg === 'string' && bg in TASK_COLORS ? (bg as TaskColorKey) : null),
      archived: b.closed === true,
      columns,
    };
  });
  validateImportedBoards(result);
  return result;
}
