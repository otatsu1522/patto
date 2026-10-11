import { DAY_MS, formatDate, formatDateTime, startOfDay } from '@/lib/dates';

export interface Due {
  dueAt: number;
  dueHasTime: boolean;
}

/** "2026-12-31" または "2026-12-31 18:00" を解析する。空文字は null、不正は 'invalid'。 */
export function parseDue(input: string): Due | null | 'invalid' {
  const s = input.trim();
  if (s === '') return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (!m) return 'invalid';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const h = hasTime ? Number(m[4]) : 0;
  const mi = hasTime ? Number(m[5]) : 0;
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  const valid =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60;
  return valid ? { dueAt: date.getTime(), dueHasTime: hasTime } : 'invalid';
}

export const formatDue = (due: Due): string =>
  due.dueHasTime ? formatDateTime(due.dueAt) : formatDate(due.dueAt);

export type DueState = 'overdue' | 'today' | 'upcoming';

export function dueState(due: Due, now: number): DueState {
  const today = startOfDay(now);
  if (due.dueHasTime) {
    if (due.dueAt < now) return 'overdue';
    return due.dueAt < today + DAY_MS ? 'today' : 'upcoming';
  }
  if (due.dueAt < today) return 'overdue';
  return due.dueAt < today + DAY_MS ? 'today' : 'upcoming';
}
