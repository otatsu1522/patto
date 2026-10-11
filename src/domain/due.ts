import { DAY_MS, formatDate, startOfDay } from '@/lib/dates';

/** 期限は年月日のみ（時刻なし）。dueHasTime は互換のため残してあり、常に false。 */
export interface Due {
  dueAt: number;
  dueHasTime: boolean;
}

/** "2026-12-31"（区切りは - か /）を解析する。空文字は null、不正は 'invalid'。 */
export function parseDue(input: string): Due | null | 'invalid' {
  const s = input.trim();
  if (s === '') return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return 'invalid';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return valid ? { dueAt: date.getTime(), dueHasTime: false } : 'invalid';
}

export const formatDue = (due: Due): string => formatDate(due.dueAt);

export type DueState = 'overdue' | 'today' | 'upcoming';

export function dueState(due: Due, now: number): DueState {
  const today = startOfDay(now);
  if (due.dueAt < today) return 'overdue';
  return due.dueAt < today + DAY_MS ? 'today' : 'upcoming';
}
