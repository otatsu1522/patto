import { isTaskColorKey, TASK_COLORS, type TaskColorKey } from '@/theme/taskColors';
import { compareBySortKey } from './ordering';
import { isActive } from './selectors';
import type { KanbanColumn, Project, Task } from './types';

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

export function exportBoards(data: { projects: Project[]; columns: KanbanColumn[]; tasks: Task[] }, projectIds: string[]): string {
  const boards = data.projects
    .filter((p) => isActive(p) && projectIds.includes(p.id))
    .sort(compareBySortKey)
    .map((p) => {
      const columns = data.columns.filter((c) => c.projectId === p.id && isActive(c)).sort(compareBySortKey);
      const tasks = data.tasks.filter((t) => t.projectId === p.id && isActive(t));
      const usedColors = Array.from(new Set(tasks.map((t) => t.color).filter((c): c is TaskColorKey => !!c)));
      return {
        id: p.id,
        name: p.title,
        desc: p.description,
        closed: p.archivedAt !== null,
        prefs: { background: p.color ?? 'blue' },
        labels: usedColors.map((c) => ({ id: c, idBoard: p.id, name: '', color: c })),
        lists: columns.map((c, i) => ({ id: c.id, name: c.title, closed: false, idBoard: p.id, pos: (i + 1) * 65536 })),
        cards: tasks
          .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
          .map((t, i) => ({
            id: t.id,
            name: t.title,
            desc: t.description,
            closed: t.archivedAt !== null,
            idBoard: p.id,
            idList: t.columnId,
            idLabels: t.color ? [t.color] : [],
            labels: t.color ? [{ id: t.color, idBoard: p.id, name: '', color: t.color }] : [],
            due: t.dueAt !== null ? iso(t.dueAt) : null,
            dueComplete: t.completedAt !== null,
            pos: (i + 1) * 65536,
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

const COLOR_ALIASES: Record<string, TaskColorKey | null> = {
  black: 'slate',
  grey: 'gray',
};

const toColor = (v: unknown): TaskColorKey | null => {
  if (typeof v !== 'string') return null;
  const key = v.replace(/_(light|dark)$/, '');
  if (isTaskColorKey(key)) return key;
  return COLOR_ALIASES[key] ?? null;
};

const DONE_PATTERN = /^(done|完了|終了|済)/i;

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
    if (typeof b.name !== 'string' || lists.length === 0 && !Array.isArray(b.cards)) {
      throw new Error('not a trello board');
    }
    const cards = asArr(b.cards);
    const columns: ImportedColumn[] = lists
      .filter((l) => l.closed !== true)
      .sort((x, y) => Number(x.pos ?? 0) - Number(y.pos ?? 0))
      .map((l) => ({
        title: str(l.name) || '-',
        isDone: DONE_PATTERN.test(str(l.name).trim()),
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
      title: str(b.name),
      description: str(b.desc),
      color: toColor(bg) ?? (typeof bg === 'string' && bg in TASK_COLORS ? (bg as TaskColorKey) : null),
      archived: b.closed === true,
      columns,
    };
  });
  return result;
}
