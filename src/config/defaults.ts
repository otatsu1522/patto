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
export type CardDensity = 'normal' | 'compact';

export interface AppSettings {
  themeMode: ThemeMode;
  fontScale: FontScaleKey;
  cardDensity: CardDensity;
  /** この端末の同期モード。off=同期しない / manual=画面を引いた時・ボタンのみ / auto=自動 */
  syncMode: SyncMode;
  /** 操作結果のトースト（画面下の短い通知）を出すか */
  toastEnabled: boolean;
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
  syncMode: isWeb ? 'auto' : 'manual',
  toastEnabled: true,
  trashAutoDelete: true,
  trashRetentionDays: retentionDays,
  shortcutsEnabled: true,
  shortcutOverrides: {},
  lastProjectId: null,
});
