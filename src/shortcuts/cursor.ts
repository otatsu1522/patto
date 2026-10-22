/** キーボードの選択位置。taskIndex=-1 はカンバン見出し、0以上はタスクカードを表す。 */
export interface Cursor {
  columnIndex: number;
  taskIndex: number;
  grabbed: boolean;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const initialCursor = (): Cursor => ({ columnIndex: 0, taskIndex: -1, grabbed: false });

/** counts[i] = i 番目のカンバンのタスク数。見出し選択中の状態は、タスクの有無にかかわらず維持する。 */
export function clampCursor(c: Cursor, counts: number[]): Cursor {
  if (counts.length === 0) return { columnIndex: 0, taskIndex: -1, grabbed: false };
  let columnIndex = Math.max(0, Math.min(c.columnIndex, counts.length - 1));

  // タスクを選択中に現在列が空になった場合だけ、最も近いタスク列へ移す。
  // taskIndex=-1 は意図的なカンバン見出しの選択なので、別の列へ移さない。
  if (c.taskIndex >= 0 && counts.some((count) => count > 0) && (counts[columnIndex] ?? 0) <= 0) {
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

  const count = counts[columnIndex] ?? 0;
  const taskIndex =
    count > 0 && c.taskIndex >= 0 ? Math.max(0, Math.min(c.taskIndex, count - 1)) : -1;
  const grabbed = c.taskIndex >= 0 && taskIndex < 0 ? false : c.grabbed;
  return { ...c, columnIndex, taskIndex, grabbed };
}

/** h/j/k/l で選択位置を移動する。列の左右端と、列内の上下端は循環する。 */
export function moveCursor(c: Cursor, dir: Direction, counts: number[]): Cursor {
  if (counts.length === 0) return c;

  const columnCount = counts.length;
  const count = counts[c.columnIndex] ?? 0;

  if (dir === 'left' || dir === 'right') {
    const step = dir === 'left' ? -1 : 1;
    const columnIndex = (c.columnIndex + step + columnCount) % columnCount;
    const targetCount = counts[columnIndex] ?? 0;

    // 移動先にタスクがなければ、そのカンバン見出しを選択する。
    if (targetCount <= 0) {
      return { ...c, columnIndex, taskIndex: -1, grabbed: false };
    }

    // 見出し選択中は見出しのまま移動し、タスク選択中は近い行を選択する。
    const taskIndex = c.taskIndex < 0 ? -1 : Math.min(c.taskIndex, targetCount - 1);
    return { ...c, columnIndex, taskIndex, grabbed: false };
  }

  // 各列の縦方向は「見出し -> タスク -> ... -> 最後のタスク -> 見出し」で循環する。
  // 空の列は見出しだけを選択対象とする。
  if (count <= 0) {
    return { ...c, taskIndex: -1, grabbed: false };
  }

  if (dir === 'down') {
    const taskIndex = c.taskIndex < 0 ? 0 : c.taskIndex >= count - 1 ? -1 : c.taskIndex + 1;
    return { ...c, taskIndex, grabbed: false };
  }

  const taskIndex = c.taskIndex < 0 ? count - 1 : c.taskIndex === 0 ? -1 : c.taskIndex - 1;
  return { ...c, taskIndex, grabbed: false };
}
