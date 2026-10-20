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
let autoSyncForeground = true;

function isAppForeground(): boolean {
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

  running = true;
  const status = useSyncStore.getState().set;
  try {
    const online = await isOnline();
    if (!online) {
      status({ status: 'offline' });
      if (opts.throwOnError) throw new Error(ERROR_CODES.offline);
      return false;
    }

    status({ status: 'syncing', error: null });
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
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
  retryTimer = null;
  if (
    useSettingsStore.getState().settings.syncMode !== 'auto' ||
    !config.isEnabled() ||
    !autoSyncForeground ||
    !isAppForeground()
  ) {
    return;
  }
  const wait = Math.min(SYNC.retryBaseMs * 2 ** retryCount, SYNC.retryMaxMs);
  retryCount += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (autoSyncForeground && isAppForeground() && !running) void syncNow();
  }, wait);
}

/** 自動同期の仕掛けを開始する。戻り値で停止する。 */
export function startAutoSync(ownerId: string): () => void {
  const cleanups: (() => void)[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let foreground = isAppForeground();
  autoSyncForeground = foreground;

  const clearDebounce = () => {
    if (debounce) clearTimeout(debounce);
    debounce = null;
  };

  const clearIntervalTimer = () => {
    if (interval) clearTimeout(interval);
    interval = null;
  };

  const stopAutomaticTimers = () => {
    clearDebounce();
    clearIntervalTimer();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  void getDb()
    .getMeta('lastSyncedAt')
    .then((value) => {
      if (value) useSyncStore.getState().set({ lastSyncedAt: Number(value) });
    })
    .catch(() => {});

  if (useSettingsStore.getState().settings.syncMode !== 'auto') return () => {};

  const canRunAutomaticWork = () => {
    if (disposed || !foreground) return false;
    if (
      Platform.OS === 'web' &&
      typeof document !== 'undefined' &&
      document.visibilityState !== 'visible'
    ) {
      foreground = false;
      autoSyncForeground = false;
      stopAutomaticTimers();
      return false;
    }
    return true;
  };

  const kick = () => {
    if (!canRunAutomaticWork()) return;
    clearDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      if (canRunAutomaticWork()) void syncNow();
    }, SYNC.debounceMs);
  };

  const scheduleInterval = () => {
    clearIntervalTimer();
    if (!canRunAutomaticWork()) return;
    interval = setTimeout(() => {
      interval = null;
      if (!canRunAutomaticWork()) return;
      if (!running) void syncNow();
      scheduleInterval();
    }, useSettingsStore.getState().settings.autoSyncIntervalSeconds * 1000);
  };

  const updateForeground = (nextForeground: boolean) => {
    if (disposed) return;
    const wasForeground = foreground;
    foreground = nextForeground;
    autoSyncForeground = nextForeground;
    if (!nextForeground) {
      stopAutomaticTimers();
      return;
    }
    if (!wasForeground || interval === null) scheduleInterval();
    kick();
  };

  if (foreground) void syncNow();
  cleanups.push(onLocalChange(kick));
  scheduleInterval();
  cleanups.push(
    useSettingsStore.subscribe((state, previousState) => {
      if (
        state.settings.autoSyncIntervalSeconds !== previousState.settings.autoSyncIntervalSeconds
      ) {
        scheduleInterval();
      }
    }),
  );

  const net = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) kick();
  });
  cleanups.push(net);

  const app = AppState.addEventListener('change', (state) => {
    updateForeground(Platform.OS === 'web' ? isAppForeground() : state === 'active');
  });
  cleanups.push(() => app.remove());

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const handleVisibilityChange = () => {
      updateForeground(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    cleanups.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
  }

  // Web はサーバー側の変更をリアルタイムに受け取る。
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
    disposed = true;
    stopAutomaticTimers();
    autoSyncForeground = false;
    cleanups.forEach((cleanup) => cleanup());
  };
}
