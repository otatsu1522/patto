import { Platform } from 'react-native';
import { create } from 'zustand';
import {
  defaultSettings,
  AUTO_SYNC_INTERVAL_SECONDS,
  TOAST_CATEGORIES,
  TOAST_DURATION_SECONDS,
  TRASH_RETENTION_DAYS,
  type TrashRetentionDays,
  type AppSettings,
  type ToastCategory,
} from '@/config/defaults';
import { TRASH } from '@/config/limits';
import { isTaskColorKey } from '@/theme/taskColors';
import { kv } from '@/lib/kv';

type StorageErrorKey = 'settings.storageReadFailed' | 'settings.storageWriteFailed';
type SettingsPatch = Partial<AppSettings> | ((current: AppSettings) => Partial<AppSettings>);
const STORAGE_KEY = 'patto:settings';
const isWeb = Platform.OS === 'web';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  /** 永続ストレージへのアクセス失敗を UI が一度ずつ通知するための連番。 */
  storageErrorVersion: number;
  storageErrorKey: StorageErrorKey | null;
  load: () => Promise<void>;
  /** 保存が完了した場合のみ状態を更新する。失敗はストア内に記録し false を返す。 */
  update: (patch: SettingsPatch) => Promise<boolean>;
  /** 保存が完了した場合のみ状態を更新する。失敗時は false を返し、呼び出し元で通知する。 */
  reset: (options?: { preserveSyncMode?: boolean }) => Promise<boolean>;
}

// 同時に発生した設定変更を順番に保存する。各更新は直前の保存済み状態へマージする。
let storageWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageWriteQueue.then(operation, operation);
  storageWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 端末ごとの設定（テーマ・文字サイズ・同期モードなど）。この端末のストレージに保存する。 */
export const useSettingsStore = create<SettingsState>((set, get) => {
  let loadPromise: Promise<void> | null = null;

  const reportStorageError = (key: StorageErrorKey) => {
    set((state) => ({
      storageErrorVersion: state.storageErrorVersion + 1,
      storageErrorKey: key,
    }));
  };

  return {
    settings: defaultSettings(isWeb, TRASH.retentionDays),
    loaded: false,
    storageErrorVersion: 0,
    storageErrorKey: null,
    async load() {
      if (get().loaded) return;
      if (loadPromise) return loadPromise;

      loadPromise = enqueueStorageWrite(async () => {
        let raw: string | null;
        try {
          raw = await kv.getRequired(STORAGE_KEY);
        } catch {
          set((state) => ({
            settings: defaultSettings(isWeb, TRASH.retentionDays),
            loaded: true,
            storageErrorVersion: state.storageErrorVersion + 1,
            storageErrorKey: 'settings.storageReadFailed',
          }));
          return;
        }

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
            if (
              legacy.some((item) => item === 'editing' || item === 'creation' || item === 'other')
            ) {
              migrated.push('editing');
            }
            if (legacy.some((item) => item === 'system' || item === 'other')) {
              migrated.push('system');
            }
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
        if (!TRASH_RETENTION_DAYS.includes(settings.trashRetentionDays as TrashRetentionDays)) {
          settings.trashRetentionDays = TRASH.retentionDays;
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

        let writeFailed = false;
        if (normalized) {
          try {
            await kv.setRequired(STORAGE_KEY, JSON.stringify(settings));
          } catch {
            writeFailed = true;
          }
        }
        set((state) => ({
          settings,
          loaded: true,
          ...(writeFailed
            ? {
                storageErrorVersion: state.storageErrorVersion + 1,
                storageErrorKey: 'settings.storageWriteFailed' as const,
              }
            : {}),
        }));
      });

      try {
        await loadPromise;
      } finally {
        loadPromise = null;
      }
    },
    async update(patch) {
      try {
        if (!get().loaded) await get().load();
        await enqueueStorageWrite(async () => {
          const current = get().settings;
          const values = typeof patch === 'function' ? patch(current) : patch;
          const next = { ...current, ...values };
          await kv.setRequired(STORAGE_KEY, JSON.stringify(next));
          set({ settings: next });
        });
        return true;
      } catch {
        reportStorageError('settings.storageWriteFailed');
        return false;
      }
    },
    async reset(options) {
      try {
        if (!get().loaded) await get().load();
        await enqueueStorageWrite(async () => {
          const next = defaultSettings(isWeb, TRASH.retentionDays);
          // データ初期化の操作だけで同期モードを変え、意図しない通信を開始しない。
          if (options?.preserveSyncMode) next.syncMode = get().settings.syncMode;
          await kv.setRequired(STORAGE_KEY, JSON.stringify(next));
          set({ settings: next });
        });
        return true;
      } catch {
        return false;
      }
    },
  };
});
