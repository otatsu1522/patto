import { DAY_MS, formatDate, startOfDay } from '@/lib/dates';

/** 期限は年月日のみ（時刻なし）。dueHasTime は互換のため残してあり、常に false。 */
export interface Due {
  dueAt: number;
  dueHasTime: boolean;
}

/** "20261231"（8桁。数字以外の区切りが混ざっていても数字だけを使う）を解析する。空文字は null、不正は 'invalid'。 */
export function parseDue(input: string): Due | null | 'invalid' {
  const digits = input.replace(/\D/g, '');
  if (input.trim() === '') return null;
  if (digits.length !== 8) return 'invalid';
  const [y, mo, d] = [
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)),
    Number(digits.slice(6, 8)),
  ];
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return valid ? { dueAt: date.getTime(), dueHasTime: false } : 'invalid';
}

/** 入力欄に入れる形式（YYYYMMDD） */
export const formatDueInput = (ts: number): string => formatDate(ts).replace(/-/g, '');

export const formatDue = (due: Due): string => formatDate(due.dueAt);

export type DueState = 'overdue' | 'today' | 'upcoming';

export function dueState(due: Due, now: number): DueState {
  const today = startOfDay(now);
  if (due.dueAt < today) return 'overdue';
  return due.dueAt < today + DAY_MS ? 'today' : 'upcoming';
}
