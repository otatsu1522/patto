/** キーボード操作で選択中のタスク位置。タスクがない場合は taskIndex が -1 になる。 */
export interface Cursor {
  columnIndex: number;
  taskIndex: number;
  grabbed: boolean;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const initialCursor = (): Cursor => ({ columnIndex: 0, taskIndex: -1, grabbed: false });

/** counts[i] = i 番目のカンバンのタスク数。タスクがある限り、見出しではなくカードを選択する。 */
export function clampCursor(c: Cursor, counts: number[]): Cursor {
  if (counts.length === 0) return { columnIndex: 0, taskIndex: -1, grabbed: false };
  let columnIndex = Math.max(0, Math.min(c.columnIndex, counts.length - 1));
  if (counts.some((count) => count > 0)) {
    if ((counts[columnIndex] ?? 0) <= 0 || c.taskIndex < 0) {
      // 現在列が空になった場合は、最も近いタスクのある列へ移る。
      let nearest = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      counts.forEach((count, index) => {
        if (count <= 0) return;
        const distance = Math.abs(index - columnIndex);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      if (nearest >= 0) columnIndex = nearest;
    }
  }
  const count = counts[columnIndex] ?? 0;
  const taskIndex = count > 0 ? Math.max(0, Math.min(c.taskIndex, count - 1)) : -1;
  return { ...c, columnIndex, taskIndex };
}

/** 上下左右（h/j/k/l）でタスクカード間を移動する。カンバン見出しは選択しない。 */
export function moveCursor(c: Cursor, dir: Direction, counts: number[]): Cursor {
  if (counts.length === 0 || counts.every((count) => count <= 0)) return c;

  if (dir === 'left' || dir === 'right') {
    const step = dir === 'left' ? -1 : 1;
    let columnIndex = c.columnIndex + step;
    // タスクがないカンバンはカーソル移動先にせず、同じ方向の次のタスク列を探す。
    while (columnIndex >= 0 && columnIndex < counts.length && (counts[columnIndex] ?? 0) <= 0) {
      columnIndex += step;
    }
    if (columnIndex < 0 || columnIndex >= counts.length) return c;
    return {
      ...c,
      columnIndex,
      taskIndex: Math.max(0, Math.min(c.taskIndex, (counts[columnIndex] ?? 1) - 1)),
    };
  }

  const count = counts[c.columnIndex] ?? 0;
  if (count <= 0) return c;
  const step = dir === 'up' ? -1 : 1;
  return { ...c, taskIndex: Math.max(0, Math.min(c.taskIndex + step, count - 1)) };
}
