import { generateKeyBetween } from 'fractional-indexing';
import type { ColumnSortMode, Task } from './types';

/** タスクの表示順: お気に入りが上 → 更新日順 / 作成日順 / 期限順 / 手動 */
export function compareTasks(mode: ColumnSortMode) {
  return (a: Task, b: Task): number => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    let diff = 0;
    if (mode === 'manual') {
      diff = a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    } else if (mode === 'created') {
      diff = b.createdAt - a.createdAt;
      if (diff === 0) diff = b.updatedAt - a.updatedAt;
    } else if (mode === 'due') {
      // 期限が設定されたタスクを期限順にし、期限未設定同士は更新日順にする。
      const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
      const bd = b.dueAt ?? Number.POSITIVE_INFINITY;
      diff = ad === bd ? 0 : ad < bd ? -1 : 1;
      if (diff === 0) diff = b.updatedAt - a.updatedAt;
    } else {
      diff = b.updatedAt - a.updatedAt;
    }
    return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
  };
}

export const compareBySortKey = <T extends { sortKey: string; id: string }>(a: T, b: T): number =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

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
