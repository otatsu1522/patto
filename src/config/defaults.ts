import type { TaskColorKey } from '@/theme/taskColors';
import type { FontScaleKey } from './layout';

/** 新規プロジェクト作成時に自動で作るカンバン（タイトルは i18n のキー）。 */
export const DEFAULT_COLUMNS = [
  { titleKey: 'defaults.column.todo', isDone: false, color: 'blue' },
  { titleKey: 'defaults.column.doing', isDone: false, color: 'orange' },
  { titleKey: 'defaults.column.done', isDone: true, color: 'green' },
] as const satisfies readonly { titleKey: string; isDone: boolean; color: TaskColorKey }[];

export type ThemeMode = 'system' | 'light' | 'dark';
export type SyncMode = 'off' | 'manual' | 'auto';
export type CardDensity = 'compact' | 'normal' | 'detailed';
export const TOAST_CATEGORIES = ['movement', 'editing', 'system'] as const;
export type ToastCategory = (typeof TOAST_CATEGORIES)[number];
export const TOAST_DURATION_SECONDS = [1, 2, 3] as const;

export interface AppSettings {
  themeMode: ThemeMode;
  fontScale: FontScaleKey;
  cardDensity: CardDensity;
  showTaskDescription: boolean;
  showTaskDueDate: boolean;
  showTaskUpdatedAt: boolean;
  /** この端末の同期モード。off=同期しない / manual=画面を引いた時・ボタンのみ / auto=自動 */
  syncMode: SyncMode;
  /** 操作結果のトースト（画面下の短い通知）を出すか */
  toastEnabled: boolean;
  /** トースト表示時間（秒） */
  toastDurationSeconds: number;
  /** 画面の通常枠線の太さ（px） */
  borderWidth: 1 | 2 | 3;
  /** フォーム・ボタンなど、操作部品の枠線の太さ（px） */
  controlBorderWidth: 1 | 2 | 3;
  /** 画面の通常枠線色（null はテーマ既定色） */
  borderColor: TaskColorKey | null;
  /** フォーム・ボタンなど、操作部品の枠線色（null はテーマ既定色） */
  controlBorderColor: TaskColorKey | null;
  /** トースト表示がONのときに表示する操作分類 */
  toastCategories: ToastCategory[];
  trashAutoDelete: boolean;
  trashRetentionDays: number;
  shortcutsEnabled: boolean;
  /** 既定値から変更したショートカット（アクションID → キー配列） */
  shortcutOverrides: Record<string, string[]>;
  lastProjectId: string | null;
}

/** 同期モードの既定値はプラットフォームで変える（Webは自動、スマホは手動）。 */
export const defaultSettings = (isWeb: boolean, retentionDays: number): AppSettings => ({
  themeMode: 'system',
  fontScale: 'normal',
  cardDensity: 'normal',
  showTaskDescription: true,
  showTaskDueDate: true,
  showTaskUpdatedAt: false,
  syncMode: isWeb ? 'auto' : 'manual',
  toastEnabled: true,
  toastDurationSeconds: 2,
  borderWidth: 1,
  controlBorderWidth: 1,
  borderColor: null,
  controlBorderColor: null,
  toastCategories: [...TOAST_CATEGORIES],
  trashAutoDelete: true,
  trashRetentionDays: retentionDays,
  shortcutsEnabled: true,
  shortcutOverrides: {},
  lastProjectId: null,
});
