import { generateKeyBetween } from 'fractional-indexing';
import { TASK_COLOR_PICKER_KEYS } from '@/theme/taskColors';
import type { ColumnSortBaseMode, ColumnSortMode, Task } from './types';

export type SortDirection = 'asc' | 'desc';

type AutomaticSortMode = Exclude<ColumnSortBaseMode, 'manual'>;

/** 旧形式を含む保存値から、方向を除いた並び順を取得する。 */
export function sortBaseMode(mode: ColumnSortMode): ColumnSortBaseMode {
  if (mode === 'manual') return 'manual';
  return mode.split(':', 1)[0] as AutomaticSortMode;
}

/** 各並び順の従来の向きを既定値にし、既定値以外のみ保存値に含める。 */
export function sortDirection(mode: ColumnSortMode): SortDirection {
  const base = sortBaseMode(mode);
  if (base === 'manual') return 'asc';
  const saved = mode.includes(':') ? mode.split(':')[1] : undefined;
  if (saved === 'asc' || saved === 'desc') return saved;
  return base === 'updated' || base === 'created' ? 'desc' : 'asc';
}

export function withSortDirection(
  mode: AutomaticSortMode,
  direction: SortDirection,
): ColumnSortMode {
  const defaultDirection: SortDirection = mode === 'updated' || mode === 'created' ? 'desc' : 'asc';
  return direction === defaultDirection ? mode : `${mode}:${direction}`;
}

/** タスクの表示順: お気に入りが上 → 更新日順 / 作成日順 / 期限順 / 色順 / 手動 */
export function compareTasks(mode: ColumnSortMode) {
  const baseMode = sortBaseMode(mode);
  const direction = sortDirection(mode);
  const defaultDirection: SortDirection =
    baseMode === 'updated' || baseMode === 'created' ? 'desc' : 'asc';
  return (a: Task, b: Task): number => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    let diff = 0;
    if (baseMode === 'manual') {
      diff = a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    } else if (baseMode === 'created') {
      diff = b.createdAt - a.createdAt;
      if (diff === 0) diff = b.updatedAt - a.updatedAt;
    } else if (baseMode === 'due') {
      // 期限が設定されたタスクを期限順にし、期限未設定同士は更新日順にする。
      const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
      const bd = b.dueAt ?? Number.POSITIVE_INFINITY;
      diff = ad === bd ? 0 : ad < bd ? -1 : 1;
      if (diff === 0) diff = b.updatedAt - a.updatedAt;
    } else if (baseMode === 'color') {
      // 色設定画面の並びと同じ順序。「色なし」は先頭。同じ色は最終更新順。
      const colorOrder = (color: Task['color']) => {
        if (color === null) return 0;
        const index = TASK_COLOR_PICKER_KEYS.indexOf(
          color as (typeof TASK_COLOR_PICKER_KEYS)[number],
        );
        return index < 0 ? TASK_COLOR_PICKER_KEYS.length + 1 : index + 1;
      };
      diff = colorOrder(a.color) - colorOrder(b.color);
      if (diff === 0) diff = b.updatedAt - a.updatedAt;
    } else {
      diff = b.updatedAt - a.updatedAt;
    }
    // お気に入りは常に上、IDは同値時の安定順を維持し、指定方向は主な比較結果に適用する。
    if (diff !== 0) return direction === defaultDirection ? diff : -diff;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
}

export const compareBySortKey = <T extends { sortKey: string; id: string }>(a: T, b: T): number => {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

/** 2つのキーの間に入るキーを返す（衝突時は末尾扱いにフォールバック）。 */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    return generateKeyBetween(before, null);
  }
}

export const keyAtEnd = (sorted: { sortKey: string }[]): string =>
  keyBetween(sorted.length ? sorted[sorted.length - 1]!.sortKey : null, null);

export const keyAtStart = (sorted: { sortKey: string }[]): string =>
  keyBetween(null, sorted.length ? sorted[0]!.sortKey : null);

/**
 * sorted（並び順に整列済み）の中で、index の位置に挿入するためのキー。
 * moving を渡すと、その要素自身は除外して計算する（並び替え用）。
 */
export function keyForIndex<T extends { id: string; sortKey: string }>(
  sorted: T[],
  index: number,
  movingId?: string,
): string {
  const list = movingId ? sorted.filter((x) => x.id !== movingId) : sorted;
  const i = Math.max(0, Math.min(index, list.length));
  const before = i > 0 ? list[i - 1]!.sortKey : null;
  const after = i < list.length ? list[i]!.sortKey : null;
  if (before !== null && after !== null && before >= after) return keyBetween(before, null);
  return keyBetween(before, after);
}
