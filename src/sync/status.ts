import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

/** 同期の状態表示用ストア（ヘッダーのアイコンなどが参照する）。 */
export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  error: null,
  set: (patch) => set(patch),
}));
