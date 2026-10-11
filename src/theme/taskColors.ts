/** タスク・プロジェクトの色パレット。キーはTrelloのラベル色名に合わせてある（インポート/エクスポート用）。 */
export const TASK_COLORS = {
  red: '#E5484D',
  orange: '#F08A24',
  yellow: '#F5C518',
  green: '#30A46C',
  sky: '#29B6D4',
  blue: '#3E63DD',
  purple: '#8E4EC6',
  pink: '#D6409F',
} as const;

export type TaskColorKey = keyof typeof TASK_COLORS;
export const TASK_COLOR_KEYS = Object.keys(TASK_COLORS) as TaskColorKey[];

export const isTaskColorKey = (v: unknown): v is TaskColorKey =>
  typeof v === 'string' && v in TASK_COLORS;
