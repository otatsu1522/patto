import { Platform } from 'react-native';
import { create } from 'zustand';
import {
  defaultSettings,
  AUTO_SYNC_INTERVAL_SECONDS,
  TOAST_CATEGORIES,
  TOAST_DURATION_SECONDS,
  type AppSettings,
  type ToastCategory,
} from '@/config/defaults';
import { TRASH } from '@/config/limits';
import { isTaskColorKey } from '@/theme/taskColors';
import { kv } from '@/lib/kv';

const STORAGE_KEY = 'patto:settings';
const isWeb = Platform.OS === 'web';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
  reset: (options?: { preserveSyncMode?: boolean }) => void;
}

/** 端末ごとの設定（テーマ・文字サイズ・同期モードなど）。この端末のストレージに保存する。 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(isWeb, TRASH.retentionDays),
  loaded: false,
  async load() {
    const raw = await kv.get(STORAGE_KEY);
    let stored: Partial<AppSettings> = {};
    try {
      stored = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    } catch {
      stored = {};
    }
    const settings = { ...defaultSettings(isWeb, TRASH.retentionDays), ...stored };
    let normalized = false;

    // 旧分類（creation / other）を新しい移動・編集・システム分類へ移行する。
    const rawToastCategories = (stored as { toastCategories?: unknown }).toastCategories;
    if (rawToastCategories !== undefined) {
      const migrated: ToastCategory[] = [];
      if (Array.isArray(rawToastCategories)) {
        const legacy = rawToastCategories as unknown[];
        if (legacy.includes('movement')) migrated.push('movement');
        if (legacy.some((item) => item === 'editing' || item === 'creation' || item === 'other')) {
          migrated.push('editing');
        }
        if (legacy.some((item) => item === 'system' || item === 'other')) migrated.push('system');
        if (migrated.length === 0 && legacy.length > 0) migrated.push(...TOAST_CATEGORIES);
      } else {
        migrated.push(...TOAST_CATEGORIES);
      }
      if (JSON.stringify(settings.toastCategories) !== JSON.stringify(migrated)) {
        settings.toastCategories = migrated;
        normalized = true;
      }
    }
    if (!AUTO_SYNC_INTERVAL_SECONDS.includes(settings.autoSyncIntervalSeconds)) {
      settings.autoSyncIntervalSeconds = 60;
      normalized = true;
    }
    if (!TOAST_DURATION_SECONDS.some((seconds) => seconds === settings.toastDurationSeconds)) {
      settings.toastDurationSeconds = Number.isFinite(settings.toastDurationSeconds)
        ? Math.min(3, Math.max(1, Math.round(settings.toastDurationSeconds)))
        : 2;
      normalized = true;
    }
    if (![1, 2, 3].includes(settings.controlBorderWidth)) {
      settings.controlBorderWidth = 1;
      normalized = true;
    }
    if (settings.borderColor !== null && !isTaskColorKey(settings.borderColor)) {
      settings.borderColor = null;
      normalized = true;
    }
    if (settings.controlBorderColor !== null && !isTaskColorKey(settings.controlBorderColor)) {
      settings.controlBorderColor = null;
      normalized = true;
    }
    if (normalized) void kv.set(STORAGE_KEY, JSON.stringify(settings));
    set({ settings, loaded: true });
  },
  update(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    void kv.set(STORAGE_KEY, JSON.stringify(next));
  },
  reset(options) {
    const next = defaultSettings(isWeb, TRASH.retentionDays);
    // データ初期化の操作だけで同期モードを変え、意図しない通信を開始しない。
    if (options?.preserveSyncMode) next.syncMode = get().settings.syncMode;
    set({ settings: next });
    void kv.set(STORAGE_KEY, JSON.stringify(next));
  },
}));
