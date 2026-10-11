import { Platform } from 'react-native';
import { create } from 'zustand';
import { defaultSettings, type AppSettings } from '@/config/defaults';
import { TRASH } from '@/config/limits';
import { kv } from '@/lib/kv';

const STORAGE_KEY = 'patto:settings';
const isWeb = Platform.OS === 'web';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
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
    set({ settings: { ...defaultSettings(isWeb, TRASH.retentionDays), ...stored }, loaded: true });
  },
  update(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    void kv.set(STORAGE_KEY, JSON.stringify(next));
  },
}));
