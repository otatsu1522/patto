import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
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
  /** リモートアカウントを利用できる状態か（ローカル専用ではなく Supabase 設定済み） */
  isAccountAvailable: () => boolean;
  onAuthRequired: () => void;
}

type SyncSource = 'manual' | 'automatic';
type SyncOptions = { throwOnError?: boolean; force?: boolean; source?: SyncSource };

let config: SyncConfig = { isAccountAvailable: () => false, onAuthRequired: () => {} };
let running = false;
let queuedSource: SyncSource | null = null;
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

/** 同期要求の発生元と現在の設定・アプリ状態から、同期を開始できるか判断する。 */
function canStartSync(opts: SyncOptions): boolean {
  // バックグラウンドでは新しい同期を開始しない。force は前景条件を満たした後、通常の判定を迂回する。
  if (!isAppForeground()) return false;
  if (opts.force) return true;
  if (!config.isAccountAvailable()) return false;
  const mode = useSettingsStore.getState().settings.syncMode;
  if (opts.source === 'automatic') {
    return mode === 'auto' && autoSyncForeground && isAppForeground();
  }
  // 手動要求も前景でのみ開始する。背景へ移った後にキューが排出されても通信を始めない。
  return mode !== 'off';
}

function queueSync(source: SyncSource): void {
  // 手動要求は自動要求より優先する。自動要求だけが残った場合は実行直前にモードを再確認する。
  if (queuedSource === null || source === 'manual') queuedSource = source;
}

/**
 * 今すぐ同期する。手動同期（画面を引く・ボタン）と自動同期の両方がここを通る。
 * throwOnError=true のときは失敗を呼び出し元に投げる（完全削除の前処理など）。
 */
export async function syncNow(opts: SyncOptions = {}): Promise<boolean> {
  // force は初回ログイン時などの一回だけモード判定を迂回し、設定自体は変更しない。
  const source = opts.source ?? 'manual';
  if (!canStartSync({ ...opts, source })) return false;
  const client = getSupabase();
  if (!client) return false;
  if (running) {
    queueSync(source);
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

    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session) throw new Error(ERROR_CODES.authRequired);
    status({ status: 'syncing', error: null });
    const settings = useSettingsStore.getState().settings;
    await runSync(createSupabaseRemote(client), localPort(), {
      trashRetentionDays: settings.trashAutoDelete ? settings.trashRetentionDays : null,
      now: nowMs,
      // 一度開始した同期は、途中でモードやアプリ状態が変わっても最後まで実行する。
      // 背景中の新しい同期開始は canStartSync で抑止する。
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
    const nextSource = queuedSource;
    queuedSource = null;
    if (nextSource !== null) {
      // モード変更後の自動要求は syncNow 側の最終判定で破棄される。
      void syncNow({ source: nextSource });
    }
  }
}

/** 自動同期モードのときだけ、指数バックオフで再試行する。 */
function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (
    useSettingsStore.getState().settings.syncMode !== 'auto' ||
    !config.isAccountAvailable() ||
    !autoSyncForeground ||
    !isAppForeground()
  ) {
    return;
  }
  const wait = Math.min(SYNC.retryBaseMs * 2 ** retryCount, SYNC.retryMaxMs);
  retryCount += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (autoSyncForeground && isAppForeground() && !running)
      void syncNow({ source: 'automatic' });
  }, wait);
}

/** 自動同期の仕掛けを開始する。戻り値で停止する。 */
export function startAutoSync(ownerId: string): () => void {
  // モード確認を先に行い、手動／オフ時は DB 読み出しやイベント登録も行わない。
  if (
    useSettingsStore.getState().settings.syncMode !== 'auto' ||
    !config.isAccountAvailable()
  ) {
    autoSyncForeground = false;
    return () => {};
  }

  const cleanups: (() => void)[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let foreground = isAppForeground();
  let realtimeChannel: RealtimeChannel | null = null;
  const client = getSupabase();
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

  const canRunAutomaticWork = () => {
    if (
      disposed ||
      !foreground ||
      !config.isAccountAvailable() ||
      useSettingsStore.getState().settings.syncMode !== 'auto'
    ) {
      return false;
    }
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
      if (canRunAutomaticWork()) void syncNow({ source: 'automatic' });
    }, SYNC.debounceMs);
  };

  const scheduleInterval = () => {
    clearIntervalTimer();
    if (!canRunAutomaticWork()) return;
    interval = setTimeout(() => {
      interval = null;
      if (!canRunAutomaticWork()) return;
      if (!running) void syncNow({ source: 'automatic' });
      scheduleInterval();
    }, useSettingsStore.getState().settings.autoSyncIntervalSeconds * 1000);
  };

  const stopRealtimeSubscription = () => {
    const channel = realtimeChannel;
    if (!client || !channel) return;
    realtimeChannel = null;
    // アカウント変更・監視の破棄時にのみ解除する。背景移行では解除しない。
    void client.removeChannel(channel).catch(() => {});
  };

  const startRealtimeSubscription = () => {
    if (
      Platform.OS !== 'web' ||
      !client ||
      !canRunAutomaticWork() ||
      realtimeChannel !== null
    ) {
      return;
    }

    const channel = client.channel(`patto-${ownerId}`);
    for (const table of ['projects', 'kanban_columns', 'tasks']) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `owner_id=eq.${ownerId}` },
        kick,
      );
    }
    realtimeChannel = channel;
    let needsCatchUp = false;
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const shouldCatchUp = needsCatchUp;
        needsCatchUp = false;
        // 接続断で通知を受け取れなかった可能性があるため、再接続後に差分同期する。
        // NetInfo の復帰通知からの kick と重なっても debounce でまとめられる。
        if (shouldCatchUp) kick();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // 初回 join の失敗も対象にし、最初の SUBSCRIBED 時点で差分同期する。
        needsCatchUp = true;
      }
    });
  };

  const updateForeground = (nextForeground: boolean) => {
    if (disposed) return;
    const wasForeground = foreground;
    foreground = nextForeground;
    autoSyncForeground = nextForeground;
    if (!nextForeground) {
      // 既存の同期・リアルタイム購読は中断しない。今後の自動処理だけを予約しない。
      stopAutomaticTimers();
      return;
    }
    if (!wasForeground || interval === null) scheduleInterval();
    startRealtimeSubscription();
    // 非表示中の変更は、復帰後の同期で現在のサーバー状態に追いつく。
    if (!wasForeground) kick();
  };

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

  // NetInfo は登録直後にも現在の状態を通知する。初回通知自体は復帰扱いにしないが、
  // 初回同期がオフライン失敗した直後にオンライン通知が来た場合は再同期を予約する。
  let previousOnline: boolean | null = null;
  let initialOnlineState: boolean | null = null;
  let initialSyncComplete = !foreground;
  let initialSyncResult: boolean | null = null;
  const net = NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    if (previousOnline === null) {
      previousOnline = online;
      initialOnlineState = online;
      if (
        online &&
        initialSyncComplete &&
        initialSyncResult === false &&
        useSyncStore.getState().status === 'offline'
      ) {
        kick();
      }
      return;
    }
    const recovered = !previousOnline && online;
    previousOnline = online;
    if (recovered) kick();
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

  // 監視を登録してから初回同期を始め、起動と同時に来る NetInfo 通知を正しく扱う。
  if (foreground) {
    void syncNow({ source: 'automatic' }).then((succeeded) => {
      initialSyncComplete = true;
      initialSyncResult = succeeded;
      if (
        !succeeded &&
        initialOnlineState === true &&
        useSyncStore.getState().status === 'offline' &&
        canRunAutomaticWork()
      ) {
        kick();
      }
    });
  }

  // Web のリアルタイム購読は前景で開始し、背景移行だけでは解除しない。
  if (foreground) startRealtimeSubscription();

  return () => {
    disposed = true;
    stopAutomaticTimers();
    stopRealtimeSubscription();
    autoSyncForeground = false;
    cleanups.forEach((cleanup) => cleanup());
  };
}
