import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { getSupabase } from '@/auth/supabase';
import { isAuthRequiredError, isNetworkError } from '@/auth/errors';
import { SYNC } from '@/config/limits';
import { ERROR_CODES } from '@/config/errorCodes';
import type { Project, KanbanColumn, Task } from '@/domain/types';
import { nowMs } from '@/lib/clock';
import { getDb, onLocalChange, useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runSync, type LocalPort } from './engine';
import { createSupabaseRemote } from './remoteSupabase';
import { useSyncStore } from './status';

interface SyncConfig {
  /** 同期が使える状態か（アカウントでログイン中かつ Supabase 設定済み） */
  isEnabled: () => boolean;
  onAuthRequired: () => void;
}

let config: SyncConfig = { isEnabled: () => false, onAuthRequired: () => {} };
let running = false;
let queued = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

function isForeground(): boolean {
  if (Platform.OS === 'web') {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  }
  return AppState.currentState === 'active';
}

export const configureSync = (c: SyncConfig) => {
  config = c;
};

async function isOnline(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}

function localPort(): LocalPort {
  const store = useDataStore.getState();
  const db = getDb();
  return {
    snapshot: () => useDataStore.getState().snapshot(),
    apply: (changes, removed) =>
      store.applyRemote(
        {
          projects: changes.projects as Project[] | undefined,
          columns: changes.kanban_columns as KanbanColumn[] | undefined,
          tasks: changes.tasks as Task[] | undefined,
        },
        removed,
      ),
    getMeta: (k) => db.getMeta(k),
    setMeta: (k, v) => db.setMeta(k, v),
  };
}

/**
 * 今すぐ同期する。手動同期（画面を引く・ボタン）と自動同期の両方がここを通る。
 * throwOnError=true のときは失敗を呼び出し元に投げる（完全削除の前処理など）。
 */
export async function syncNow(
  opts: { throwOnError?: boolean; force?: boolean } = {},
): Promise<boolean> {
  // 明示的なログイン時は、同期設定が「オフ」でも既存アカウントのデータを一度取得する。
  // force はこの一回だけ同期可否判定を迂回し、通常の自動同期設定自体は変更しない。
  if (!opts.force && !config.isEnabled()) return false;
  const client = getSupabase();
  if (!client) return false;
  if (running) {
    queued = true;
    return false;
  }
  const status = useSyncStore.getState().set;
  if (!(await isOnline())) {
    status({ status: 'offline' });
    if (opts.throwOnError) throw new Error(ERROR_CODES.offline);
    return false;
  }

  running = true;
  status({ status: 'syncing', error: null });
  try {
    const { data } = await client.auth.getSession();
    if (!data.session) throw new Error(ERROR_CODES.authRequired);
    const settings = useSettingsStore.getState().settings;
    await runSync(createSupabaseRemote(client), localPort(), {
      trashRetentionDays: settings.trashAutoDelete ? settings.trashRetentionDays : null,
      now: nowMs,
    });
    status({ status: 'idle', lastSyncedAt: nowMs(), error: null });
    retryCount = 0;
    return true;
  } catch (e) {
    if (isAuthRequiredError(e)) config.onAuthRequired();
    status({
      status: isNetworkError(e) ? 'offline' : 'error',
      error: (e as { message?: string })?.message ?? String(e),
    });
    scheduleRetry();
    if (opts.throwOnError) throw e;
    return false;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void syncNow();
    }
  }
}

/** 自動同期モードのときだけ、指数バックオフで再試行する。 */
function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  if (useSettingsStore.getState().settings.syncMode !== 'auto' || !config.isEnabled()) return;
  const wait = Math.min(SYNC.retryBaseMs * 2 ** retryCount, SYNC.retryMaxMs);
  retryCount += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (isForeground() && !running) void syncNow();
  }, wait);
}

/**
 * 自動同期の仕掛けを開始する。戻り値で停止する。
 * 手動モードのときは何も開始しない（画面を引いたとき・ボタンのみ同期）。
 */
export function startAutoSync(ownerId: string): () => void {
  const cleanups: (() => void)[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const kick = () => {
    if (!isForeground()) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (isForeground()) void syncNow();
    }, SYNC.debounceMs);
  };

  void getDb()
    .getMeta('lastSyncedAt')
    .then((v) => {
      if (v) useSyncStore.getState().set({ lastSyncedAt: Number(v) });
    });

  if (useSettingsStore.getState().settings.syncMode !== 'auto') return () => {};

  if (isForeground()) void syncNow();
  cleanups.push(onLocalChange(kick));

  const interval = setInterval(() => {
    if (isForeground() && !running) void syncNow();
  }, SYNC.intervalMs);
  cleanups.push(() => clearInterval(interval));

  const net = NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) kick();
  });
  cleanups.push(net);

  const app = AppState.addEventListener('change', (st) => {
    if (st === 'active') kick();
  });
  cleanups.push(() => app.remove());

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') kick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  }

  // Web はサーバー側の変更をリアルタイムに受け取る
  const client = getSupabase();
  if (Platform.OS === 'web' && client) {
    const channel = client.channel(`patto-${ownerId}`);
    for (const table of ['projects', 'kanban_columns', 'tasks']) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `owner_id=eq.${ownerId}` },
        kick,
      );
    }
    channel.subscribe();
    cleanups.push(() => void client.removeChannel(channel));
  }

  return () => {
    if (debounce) clearTimeout(debounce);
    if (retryTimer) clearTimeout(retryTimer);
    cleanups.forEach((fn) => fn());
  };
}
