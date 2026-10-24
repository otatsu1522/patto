import { formatDate } from '@/lib/dates';

/** 期限は年月日のみ（時刻なし）。dueHasTime は互換のため残してあり、常に false。 */
export interface Due {
  dueAt: number;
  dueHasTime: boolean;
}

/** YYYY-MM-DD、YYYY-M-D、YYYYMMDD を解析する。空文字は null、不正は 'invalid'。 */
export function parseDue(input: string): Due | null | 'invalid' {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  let parts: [number, number, number];
  const separated = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (separated) {
    parts = [Number(separated[1]), Number(separated[2]), Number(separated[3])];
  } else {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length !== 8) return 'invalid';
    parts = [Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8))];
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return valid ? { dueAt: date.getTime(), dueHasTime: false } : 'invalid';
}

/** 入力欄に入れる形式（YYYY-MM-DD） */
export const formatDueInput = (ts: number): string => formatDate(ts);

/** 数字入力中は YYYY-MM-DD に区切りを補い、区切り付きの入力はそのまま整える。 */
export function formatDueTyping(input: string): string {
  const trimmed = input.trim();
  if (/[-/.]/.test(trimmed)) {
    const parts = trimmed
      .split(/[-/.]/)
      .slice(0, 3)
      .map((part) => part.replace(/\D/g, ''));
    const year = (parts[0] ?? '').slice(0, 4);
    const month = parts[1] ?? '';
    const day = parts[2] ?? '';
    if (parts.length === 1) return year;
    // 数字キーボードで自動挿入された区切りの後に3桁目が入ったら、日付側へ送る。
    if (parts.length === 2 && month.length > 2) {
      return `${year}-${month.slice(0, 2)}-${month.slice(2, 4)}`.slice(0, 10);
    }
    return parts.length > 2
      ? `${year}-${month.slice(0, 2)}-${day.slice(0, 2)}`.slice(0, 10)
      : `${year}-${month.slice(0, 2)}`.slice(0, 10);
  }
  const digits = trimmed.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** 入力終了時に、区切り付きの日付の月・日を2桁にそろえる。 */
export function normalizeDueInput(input: string): string {
  const match = input.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return formatDueTyping(input);
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export const formatDue = (due: Due): string => formatDate(due.dueAt);

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'upcoming';

export function dueState(due: Due, now: number, todayDate: string = formatDate(now)): DueState {
  // 期限は時刻ではなく暦日で比較する。固定の24時間加算は夏時間の切り替わり日に
  // 1日を正確に表せないため、YYYY-MM-DD のローカル日付を比較する。
  const dueDate = formatDate(due.dueAt);
  if (dueDate < todayDate) return 'overdue';
  if (dueDate === todayDate) return 'today';

  const [year, month, day] = todayDate.split('-').map(Number);
  const tomorrow = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dueDate === formatDate(tomorrow.getTime())) return 'tomorrow';
  return 'upcoming';
}
