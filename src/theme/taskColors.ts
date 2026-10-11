/**
 * タスク・カンバン・プロジェクトの色パレット。キーはTrelloのラベル色名に合わせてある（インポート/エクスポート用）。
 * ライトテーマは濃いめ、ダークテーマは明るめにして、どちらの背景でも見えるようにしている。
 */
export const TASK_COLORS = {
  red: '#D93025',
  orange: '#E8710A',
  yellow: '#F2B600',
  green: '#188038',
  sky: '#129EAF',
  blue: '#1A73E8',
  purple: '#9334E6',
  pink: '#D01884',
} as const;

export type TaskColorKey = keyof typeof TASK_COLORS;

export const TASK_COLORS_DARK: Record<TaskColorKey, string> = {
  red: '#F28B82',
  orange: '#FCAD70',
  yellow: '#FDD663',
  green: '#81C995',
  sky: '#78D9EC',
  blue: '#8AB4F8',
  purple: '#C58AF9',
  pink: '#FF8BCB',
};

export const TASK_COLOR_KEYS = Object.keys(TASK_COLORS) as TaskColorKey[];

export const isTaskColorKey = (v: unknown): v is TaskColorKey =>
  typeof v === 'string' && v in TASK_COLORS;
