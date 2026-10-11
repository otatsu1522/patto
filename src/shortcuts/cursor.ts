/** キーボード操作で選択中の位置。taskIndex が -1 のときはカンバンのヘッダー。 */
export interface Cursor {
  columnIndex: number;
  taskIndex: number;
  grabbed: boolean;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const initialCursor = (): Cursor => ({ columnIndex: 0, taskIndex: -1, grabbed: false });

/** counts[i] = i 番目のカンバンのタスク数。範囲外にならないよう補正する。 */
export function clampCursor(c: Cursor, counts: number[]): Cursor {
  if (counts.length === 0) return { columnIndex: 0, taskIndex: -1, grabbed: false };
  const columnIndex = Math.max(0, Math.min(c.columnIndex, counts.length - 1));
  const taskIndex = Math.max(-1, Math.min(c.taskIndex, counts[columnIndex]! - 1));
  return { ...c, columnIndex, taskIndex };
}

/** 上下左右（h/j/k/l）でカーソルを動かす。 */
export function moveCursor(c: Cursor, dir: Direction, counts: number[]): Cursor {
  if (counts.length === 0) return c;
  if (dir === 'left' || dir === 'right') {
    const columnIndex = Math.max(0, Math.min(c.columnIndex + (dir === 'left' ? -1 : 1), counts.length - 1));
    return clampCursor({ ...c, columnIndex }, counts);
  }
  const taskIndex = c.taskIndex + (dir === 'up' ? -1 : 1);
  return clampCursor({ ...c, taskIndex }, counts);
}
