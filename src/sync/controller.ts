import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { acquireAccountWork } from '@/auth/accountWork';
import { createSyncSupabaseClient, getFreshSession, getSupabase } from '@/auth/supabase';
import { isAuthRequiredError, isNetworkError } from '@/auth/errors';
import { mergeRecords } from '@/domain/merge';
import { fromRemoteRow } from '@/domain/schema';
import type { AnyRecord, TableName } from '@/domain/types';
import { SYNC } from '@/config/limits';
import { ERROR_CODES } from '@/config/errorCodes';
import { nowMs, setClockOffset } from '@/lib/clock';
import { captureSyncLocalContext, onLocalChange } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runSync } from './engine';
import { createSupabaseRemote } from './remoteSupabase';
import { useSyncStore } from './status';

interface SyncConfig {
  /** リモートアカウントを利用できる状態か（ローカル専用ではなく Supabase 設定済み） */
  isAccountAvailable: () => boolean;
  /** 現在開いているローカルDBと対応するリモートユーザーID */
  getAccountId: () => string | null;
  onAuthRequired: (ownerId: string) => void;
}

type SyncSource = 'manual' | 'automatic';
type SyncOptions = { throwOnError?: boolean; force?: boolean; source?: SyncSource };
type SyncOutcome = { success: boolean; error?: unknown };
type PendingWaiter = {
  options: SyncOptions;
  resolve: (result: boolean) => void;
  reject: (error: unknown) => void;
};
type PendingSync = {
  ownerId: string;
  source: SyncSource;
  options: SyncOptions;
  waiters: PendingWaiter[];
  /** ログアウト開始前に受理した未開始要求の作業リース。 */
  releaseWork: (() => void) | null;
};

let config: SyncConfig = {
  isAccountAvailable: () => false,
  getAccountId: () => null,
  onAuthRequired: () => {},
};
let running = false;
let runningPromise: Promise<SyncOutcome> | null = null;
let syncAdmissionClosed = false;
let syncMutationBarrier = false;
let syncMutationLockTail: Promise<void> = Promise.resolve();
let pendingSync: PendingSync | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let autoSyncForeground = true;
let pendingSyncLifecycleAttached = false;

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

/** 同期要求の発生元・アカウント・前景状態から、新しい同期を開始できるか判断する。 */
function canStartSync(opts: SyncOptions, ownerId: string): boolean {
  if (!isAppForeground() || config.getAccountId() !== ownerId) return false;
  // force はログイン直後の一回だけ同期モードを迂回する。アカウント一致と前景条件は必須。
  if (opts.force) return true;
  if (!config.isAccountAvailable()) return false;
  const mode = useSettingsStore.getState().settings.syncMode;
  if (opts.source === 'automatic') return mode === 'auto' && autoSyncForeground;
  return mode !== 'off';
}

function resultForCaller(outcome: SyncOutcome, options: SyncOptions): boolean {
  if (!outcome.success && options.throwOnError && outcome.error) throw outcome.error;
  return outcome.success;
}

function resolvePending(pending: PendingSync, outcome: SyncOutcome): void {
  for (const waiter of pending.waiters) {
    try {
      waiter.resolve(resultForCaller(outcome, waiter.options));
    } catch (error) {
      waiter.reject(error);
    }
  }
}

function attachPendingSyncLifecycle(): void {
  if (pendingSyncLifecycleAttached) return;
  pendingSyncLifecycleAttached = true;
  const resume = () => {
    if (isAppForeground()) drainPendingSync();
  };
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', resume);
  } else {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') drainPendingSync();
    });
  }
}

function discardPendingSync(pending: PendingSync): void {
  if (pendingSync === pending) pendingSync = null;
  resolvePending(pending, { success: false });
  pending.releaseWork?.();
  pending.releaseWork = null;
}

function drainPendingSync(allowMutationBarrier = false): boolean {
  if (syncMutationBarrier && !allowMutationBarrier) return false;
  const pending = pendingSync;
  if (!pending) return false;

  // Logout 開始後は、自動要求を新たに開始しない。
  // すでに受理済みの明示的な手動要求は、前景で実行条件を満たせば先に完了させる。
  if (
    syncAdmissionClosed &&
    (pending.source !== 'manual' || !pending.releaseWork || !isAppForeground())
  ) {
    discardPendingSync(pending);
    return false;
  }
  if (running) return false;

  if (config.getAccountId() !== pending.ownerId) {
    discardPendingSync(pending);
    return false;
  }

  if (!isAppForeground()) {
    if (pending.source === 'automatic' || syncAdmissionClosed) discardPendingSync(pending);
    return false;
  }

  if (!canStartSync({ ...pending.options, source: pending.source }, pending.ownerId)) {
    discardPendingSync(pending);
    return false;
  }

  pendingSync = null;
  const reservedRelease = pending.releaseWork;
  pending.releaseWork = null;
  void startSync(
    pending.ownerId,
    { ...pending.options, source: pending.source },
    reservedRelease,
  ).then((outcome) => resolvePending(pending, outcome));
  return true;
}

async function executeSync(ownerId: string, opts: SyncOptions): Promise<SyncOutcome> {
  const status = useSyncStore.getState().set;
  const belongsToCurrentAccount = () => config.getAccountId() === ownerId;
  let localContext: ReturnType<typeof captureSyncLocalContext> | null = null;
  try {
    let syncClockOffsetMs = 0;
    const online = await isOnline();
    // アカウント切り替え中に準備が終わった場合、新しいユーザーの状態には何も反映しない。
    if (!belongsToCurrentAccount()) return { success: false };
    if (!online) {
      status({ status: 'offline', activeSource: null });
      scheduleRetry();
      return { success: false, error: new Error(ERROR_CODES.offline) };
    }

    const client = getSupabase();
    if (!client) return { success: false };
    // 同期ボタン／自動同期／ログイン直後の同期として処理が開始された場合だけ、
    // 期限切れ間近のセッションを必要に応じて更新する。手動／オフ中の定期更新は行わない。
    const session = await getFreshSession(client, ownerId);
    if (!belongsToCurrentAccount()) return { success: false };
    if (!session) throw new Error(ERROR_CODES.authRequired);

    // DB と認証トークンを同期開始時点に固定する。アカウント切り替え後も、
    // リモート要求は開始時のユーザー、ローカル書き込みは開始時のDBだけを対象にする。
    localContext = captureSyncLocalContext(ownerId);
    if (!belongsToCurrentAccount()) return { success: false };
    status({ status: 'syncing', activeSource: opts.source ?? 'manual', error: null });
    const settings = useSettingsStore.getState().settings;
    const syncClient = createSyncSupabaseClient(session.access_token);
    await runSync(createSupabaseRemote(syncClient), localContext, {
      ownerId,
      trashRetentionDays: settings.trashAutoDelete ? settings.trashRetentionDays : null,
      // この同期専用の時計補正を使う。古いアカウントの応答で新しいアカウントの時計を変えない。
      now: () => Date.now() + syncClockOffsetMs,
      onServerTime: (serverNow) => {
        syncClockOffsetMs = serverNow - Date.now();
        if (belongsToCurrentAccount()) setClockOffset(syncClockOffsetMs);
      },
    });
    if (belongsToCurrentAccount()) {
      status({ status: 'idle', activeSource: null, lastSyncedAt: nowMs(), error: null });
      retryCount = 0;
    }
    return { success: true };
  } catch (error) {
    // 古いアカウントの同期エラーを新しいアカウントの状態や再認証フラグへ反映しない。
    if (!belongsToCurrentAccount()) return { success: false };
    if (isAuthRequiredError(error)) config.onAuthRequired(ownerId);
    status({
      status: isNetworkError(error) ? 'offline' : 'error',
      activeSource: null,
      error: (error as { message?: string })?.message ?? String(error),
    });
    scheduleRetry();
    return { success: false, error };
  } finally {
    if (localContext) {
      try {
        await localContext.release();
      } catch {
        // DB の後片付けエラーで、同期結果や他アカウントの状態を上書きしない。
      }
    }
  }
}

function startSync(
  ownerId: string,
  options: SyncOptions,
  reservedReleaseWork: (() => void) | null = null,
): Promise<SyncOutcome> {
  if ((syncAdmissionClosed || syncMutationBarrier) && !reservedReleaseWork) {
    return Promise.resolve({ success: false });
  }
  const releaseWork = reservedReleaseWork ?? acquireAccountWork(ownerId);
  if (!releaseWork) return Promise.resolve({ success: false });

  running = true;
  const task = executeSync(ownerId, options);
  runningPromise = task;
  const settle = () => {
    if (runningPromise === task) {
      running = false;
      runningPromise = null;
      // 呼び出し元が同期結果を受け取れるよう、後続同期は次のタスクへ送る。
      setTimeout(drainPendingSync, 0);
    }
    releaseWork();
  };
  void task.then(settle, settle);
  return task;
}

function queueWhileRunning(ownerId: string, options: SyncOptions): Promise<boolean> {
  attachPendingSyncLifecycle();
  const source = options.source ?? 'manual';
  if (pendingSync && pendingSync.ownerId !== ownerId) {
    // 新しい現在アカウントの要求を優先し、旧アカウント由来の予約は実行しない。
    if (config.getAccountId() !== ownerId) return Promise.resolve(false);
    discardPendingSync(pendingSync);
  }

  let pending = pendingSync;
  if (!pending) {
    const releaseWork = acquireAccountWork(ownerId);
    if (!releaseWork) return Promise.resolve(false);
    pending = { ownerId, source, options: { ...options, source }, waiters: [], releaseWork };
    pendingSync = pending;
  } else if (source === 'manual' && pending.source === 'automatic') {
    pending.source = 'manual';
    pending.options = { ...pending.options, ...options, source: 'manual' };
  } else if (source === pending.source && options.force && !pending.options.force) {
    pending.options = { ...pending.options, ...options, source: pending.source };
  }

  return new Promise<boolean>((resolve, reject) => {
    pending!.waiters.push({ options, resolve, reject });
  });
}

/**
 * 今すぐ同期する。実行中なら要求を1件にまとめ、完了後に必要な同期を1回実行する。
 * 手動要求も破棄せず、同じアカウントの複数要求は一つの後続同期にまとめる。
 */
export function syncNow(opts: SyncOptions = {}): Promise<boolean> {
  if (syncAdmissionClosed || syncMutationBarrier) return Promise.resolve(false);
  const source = opts.source ?? 'manual';
  const options = { ...opts, source };
  const ownerId = config.getAccountId();
  if (!ownerId || !canStartSync(options, ownerId)) return Promise.resolve(false);

  if (running && runningPromise) {
    // 切り替え後のアカウントの要求を、古いアカウントの実行結果として成功扱いしない。
    return queueWhileRunning(ownerId, options);
  }
  return startSync(ownerId, options).then((outcome) => resultForCaller(outcome, options));
}

/**
 * Logout の開始時に新しい同期の受付を閉じ、未開始のキューを解放する。
 * すでに実行中の同期はキャンセルせず、通常どおり終了するまで待つ。
 */
export async function waitForSyncBeforeAccountExit(): Promise<void> {
  syncAdmissionClosed = true;
  if (pendingSync?.source === 'automatic') discardPendingSync(pendingSync);

  while (runningPromise || pendingSync) {
    if (runningPromise) {
      const active = runningPromise;
      try {
        await active;
      } catch {
        // executeSync は通常結果を返すが、予期しない reject でも終了待ちは続ける。
      }
      continue;
    }

    const pending = pendingSync;
    if (!pending) break;
    // キューに入る前に受理した手動要求は、前景にいる場合はログアウト前に完了させる。
    if (pending.source === 'manual' && isAppForeground() && drainPendingSync(true)) continue;

    // オフへの切替、背景状態、アカウント変更などで開始条件を満たせない要求は
    // まだ開始していないため、結果を false として解放する。実行中の同期は停止しない。
    if (pendingSync === pending) discardPendingSync(pending);
  }
}

/** アカウント退出または削除が完了した後、新しいセッションの同期を許可する。 */
export function resumeSyncAfterAccountExit(): void {
  syncAdmissionClosed = false;
}

/**
 * データの破壊的変更を同期と並行させない。
 * 新しい同期の受付を閉じ、実行中／事前受理済みの同期が完了してから解除関数を返す。
 * 保護中の新しい同期要求は予約せず false を返す。実行中の同期はキャンセルしない。
 * 解除後は必要な場合に限り、自動モードの追いつき同期を要求する。
 */
export async function acquireSyncMutationLock(
  options: { scheduleAutomaticSync?: boolean } = {},
): Promise<() => void> {
  const previousLock = syncMutationLockTail;
  let unlock!: () => void;
  syncMutationLockTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previousLock;

  syncMutationBarrier = true;
  try {
    const pendingAtEntry = pendingSync;
    while (runningPromise || (pendingAtEntry !== null && pendingSync === pendingAtEntry)) {
      if (runningPromise) {
        const active = runningPromise;
        try {
          await active;
        } catch {
          // The active sync reports its own failure; maintenance can proceed after it settles.
        }
        continue;
      }

      const pending = pendingSync;
      if (!pending) break;
      if (isAppForeground() && drainPendingSync(true)) continue;
      if (pendingSync === pending) discardPendingSync(pending);
    }
  } catch (error) {
    syncMutationBarrier = false;
    unlock();
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    syncMutationBarrier = false;
    unlock();
    // Schedule only after the guarded mutation has finished. Manual/off modes never auto-sync.
    setTimeout(() => {
      drainPendingSync();
      if (
        options.scheduleAutomaticSync !== false &&
        !syncAdmissionClosed &&
        config.isAccountAvailable() &&
        useSettingsStore.getState().settings.syncMode === 'auto' &&
        autoSyncForeground &&
        isAppForeground()
      ) {
        void syncNow({ source: 'automatic' });
      }
    }, 0);
  };
}

/** 自動同期のときだけ、指数バックオフで再試行する。 */
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
    if (autoSyncForeground && isAppForeground()) void syncNow({ source: 'automatic' });
  }, wait);
}

/** 自動同期の仕掛けを開始する。戻り値で停止する。 */
export function startAutoSync(ownerId: string): () => void {
  // モード確認を先に行い、手動／オフ時は DB 読み出しやイベント登録も行わない。
  if (
    useSettingsStore.getState().settings.syncMode !== 'auto' ||
    !config.isAccountAvailable() ||
    config.getAccountId() !== ownerId
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

  const canRunAutomaticWork = () => {
    if (
      disposed ||
      !foreground ||
      !config.isAccountAvailable() ||
      config.getAccountId() !== ownerId ||
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
    if (Platform.OS !== 'web' || !client || !canRunAutomaticWork() || realtimeChannel !== null) {
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
    // 実行中に予約された手動要求があれば、前景復帰後に先に処理する。
    const pendingSyncStarted = drainPendingSync();
    // 手動要求が開始できた場合は、その同期で復帰中の変更も取得するため重複予約しない。
    if (!wasForeground && !pendingSyncStarted) kick();
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

/**
 * 自動モードでプロジェクトのアーカイブ／ごみ箱を開いたときだけ、サーバー上の非表示項目を取得する。
 * 通常同期はローカルに存在しない非表示タスクの本文を取得しない。
 * 取得中は同期入口を一時的に閉じるが、実行中の同期は停止せず完了を待つ。
 */
export async function refreshProjectHiddenRecords(
  projectId: string,
  kind: 'archive' | 'trash',
): Promise<void> {
  const ownerId = config.getAccountId();
  if (
    !projectId ||
    !ownerId ||
    !config.isAccountAvailable() ||
    useSettingsStore.getState().settings.syncMode !== 'auto' ||
    !isAppForeground()
  ) {
    return;
  }

  const releaseWork = acquireAccountWork(ownerId);
  if (!releaseWork) return;
  let releaseMutation: (() => void) | null = null;
  let localContext: ReturnType<typeof captureSyncLocalContext> | null = null;
  try {
    releaseMutation = await acquireSyncMutationLock({ scheduleAutomaticSync: false });
    // 待機中にログアウト／モード変更が完了した場合は、新しい通信を始めない。
    if (
      config.getAccountId() !== ownerId ||
      !config.isAccountAvailable() ||
      useSettingsStore.getState().settings.syncMode !== 'auto' ||
      !isAppForeground()
    ) {
      return;
    }

    const client = getSupabase();
    if (!client) return;
    const session = await getFreshSession(client, ownerId);
    if (!session?.access_token) {
      config.onAuthRequired(ownerId);
      throw new Error(ERROR_CODES.authRequired);
    }
    if (config.getAccountId() !== ownerId) return;

    // アカウントとローカルDBを固定し、遅れて返った結果が別アカウントへ書き込まれないようにする。
    localContext = captureSyncLocalContext(ownerId);
    const snapshot = localContext.snapshot();
    const knownTaskIds =
      kind === 'archive'
        ? snapshot.tasks
            .filter(
              (task) =>
                task.projectId === projectId && task.deletedAt === null && task.archivedAt !== null,
            )
            .map((task) => task.id)
        : snapshot.tasks
            .filter((task) => task.projectId === projectId && task.deletedAt !== null)
            .map((task) => task.id);
    const knownColumnIds =
      kind === 'trash'
        ? snapshot.columns
            .filter((column) => column.projectId === projectId && column.deletedAt !== null)
            .map((column) => column.id)
        : [];

    const remote = createSupabaseRemote(createSyncSupabaseClient(session.access_token));
    const listed = await remote.fetchHiddenForProject(projectId, kind);
    // 一覧取得済みの非表示行をもう一度取得しない。ローカルにはあるが一覧にないIDだけ確認し、
    // 別端末で復元された行やサーバーから完全削除された行を判別する。
    const listedTaskIds = new Set(listed.tasks.map((row) => String(row.id)));
    const listedColumnIds = new Set(listed.columns.map((row) => String(row.id)));
    const [knownTasks, knownColumns] = await Promise.all([
      remote.fetchByIds(
        'tasks',
        knownTaskIds.filter((id) => !listedTaskIds.has(id)),
      ),
      remote.fetchByIds(
        'kanban_columns',
        knownColumnIds.filter((id) => !listedColumnIds.has(id)),
      ),
    ]);
    if (
      listed.tasks.some((row) => row.owner_id !== ownerId) ||
      knownTasks.some((row) => row.owner_id !== ownerId)
    ) {
      throw new Error(ERROR_CODES.authRequired);
    }

    const uniqueRows = (rows: Record<string, unknown>[]) => {
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        if (row.owner_id === ownerId) byId.set(String(row.id), row);
      }
      return [...byId.values()];
    };
    const remoteTasks = uniqueRows([...listed.tasks, ...knownTasks]);
    const remoteColumns = uniqueRows([...listed.columns, ...knownColumns]);
    if (
      listed.columns.some((row) => row.owner_id !== ownerId) ||
      knownColumns.some((row) => row.owner_id !== ownerId)
    ) {
      throw new Error(ERROR_CODES.authRequired);
    }

    const mergeRows = (
      table: TableName,
      rows: Record<string, unknown>[],
      localRows: AnyRecord[],
    ): AnyRecord[] => {
      const localById = new Map(localRows.map((row) => [row.id, row]));
      return rows.map((row) => {
        const theirs = fromRemoteRow<AnyRecord>(table, row);
        const mine = localById.get(theirs.id);
        if (!mine) return theirs;
        const { merged, differsFromRemote } = mergeRecords(table, mine, theirs);
        return { ...merged, dirty: differsFromRemote };
      });
    };

    const localHiddenTasks =
      kind === 'archive'
        ? snapshot.tasks.filter(
            (task) =>
              task.projectId === projectId && task.deletedAt === null && task.archivedAt !== null,
          )
        : snapshot.tasks.filter((task) => task.projectId === projectId && task.deletedAt !== null);
    const localHiddenColumns =
      kind === 'trash'
        ? snapshot.columns.filter(
            (column) => column.projectId === projectId && column.deletedAt !== null,
          )
        : [];
    const taskIdsOnServer = new Set(remoteTasks.map((row) => String(row.id)));
    const columnIdsOnServer = new Set(remoteColumns.map((row) => String(row.id)));
    const removed: { table: TableName; ids: string[] }[] = [];
    const missingTasks = localHiddenTasks
      .filter((task) => !task.dirty && !taskIdsOnServer.has(task.id))
      .map((task) => task.id);
    const missingColumns = localHiddenColumns
      .filter((column) => !column.dirty && !columnIdsOnServer.has(column.id))
      .map((column) => column.id);
    if (missingColumns.length > 0) removed.push({ table: 'kanban_columns', ids: missingColumns });
    if (missingTasks.length > 0) removed.push({ table: 'tasks', ids: missingTasks });

    await localContext.apply(
      {
        ...(remoteColumns.length > 0
          ? { kanban_columns: mergeRows('kanban_columns', remoteColumns, snapshot.columns) }
          : {}),
        ...(remoteTasks.length > 0
          ? { tasks: mergeRows('tasks', remoteTasks, snapshot.tasks) }
          : {}),
      },
      removed,
    );
  } catch (error) {
    if (isAuthRequiredError(error) && config.getAccountId() === ownerId) {
      config.onAuthRequired(ownerId);
    }
    throw error;
  } finally {
    if (localContext) {
      try {
        await localContext.release();
      } catch {
        // A refresh result must not override a successful UI transition if the old DB has closed.
      }
    }
    releaseMutation?.();
    releaseWork();
  }
}
