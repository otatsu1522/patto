/** カレンダー表示用の純粋関数（日曜始まり）。 */

export interface CalendarCell {
  /** 日付（月の外の空きマスは null） */
  day: number | null;
}

/** month は 1〜12。週ごとの配列（空きマスを含む）を返す。 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < first; i++) cells.push({ day: null });
  for (let d = 1; d <= days; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 月を前後に動かす（年またぎに対応）。 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
