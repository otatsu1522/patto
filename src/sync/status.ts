import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  /** 実行中同期の発生元。自動同期は通常の同期ボタン表示を変化させない。 */
  activeSource: 'manual' | 'automatic' | null;
  /** 明示操作で要求された同期数。自動同期中に手動同期を要求した場合も視覚フィードバックを出す。 */
  manualRequestCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

/** 同期の状態表示用ストア（ヘッダーのアイコンなどが参照する）。 */
export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  activeSource: null,
  manualRequestCount: 0,
  lastSyncedAt: null,
  error: null,
  set: (patch) => set(patch),
}));
