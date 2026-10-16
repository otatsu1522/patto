/**
 * タスク・カンバン・プロジェクトの色パレット（15色）。
 * ライトテーマは濃いめ、ダークテーマは明るめにして、どちらの背景でも見えるようにしている。
 * キーの一部は Trello のラベル色名と同じ（インポート/エクスポート用）。
 */
export const TASK_COLORS = {
  red: '#D93025',
  orange: '#E8710A',
  amber: '#F29900',
  yellow: '#E6B800',
  lime: '#7CB305',
  green: '#188038',
  teal: '#00897B',
  sky: '#129EAF',
  blue: '#1A73E8',
  indigo: '#4F46E5',
  purple: '#9334E6',
  pink: '#D01884',
  rose: '#E11D48',
  brown: '#8D6E63',
  slate: '#37474F',
} as const;

export const TASK_COLOR_FALLBACK = '#888888';

/** 期限状態の色（ライト／ダークテーマ）。 */
export const TASK_DUE_STATUS_COLORS = {
  light: { today: '#B54708', tomorrow: '#9A6700' },
  dark: { today: '#FFB86B', tomorrow: '#FDD663' },
} as const;

export type TaskColorKey = keyof typeof TASK_COLORS;

export const TASK_COLORS_DARK: Record<TaskColorKey, string> = {
  red: '#F28B82',
  orange: '#FCAD70',
  amber: '#FDC269',
  yellow: '#FDD663',
  lime: '#C0DD6C',
  green: '#81C995',
  teal: '#6FD3C6',
  sky: '#78D9EC',
  blue: '#8AB4F8',
  indigo: '#A5A0FF',
  purple: '#C58AF9',
  pink: '#FF8BCB',
  rose: '#FF8FA8',
  brown: '#BCAAA4',
  slate: '#CFD8DC',
};

export const TASK_COLOR_KEYS = Object.keys(TASK_COLORS) as TaskColorKey[];

export const isTaskColorKey = (v: unknown): v is TaskColorKey =>
  typeof v === 'string' && v in TASK_COLORS;
