import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { ENV, isSupabaseConfigured } from '@/config/env';
import { useSettingsStore } from '@/store/settingsStore';
import { sessionStorage } from './sessionStorage';

let client: SupabaseClient | null = null;
let authAppStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let authSettingsUnsubscribe: (() => void) | null = null;
let authVisibilityHandler: (() => void) | null = null;
let authRefreshLifecycle: Promise<void> = Promise.resolve();
let authRefreshRunning = false;

function shouldRunAuthAutoRefresh(): boolean {
  const settings = useSettingsStore.getState();
  if (!settings.loaded || settings.settings.syncMode !== 'auto') return false;
  if (Platform.OS === 'web') {
    return typeof document !== 'undefined' && document.visibilityState === 'visible';
  }
  return AppState.currentState === 'active';
}

/** トークン自動更新はデータ同期モード「自動」の前景中だけ有効にする。 */
function reconcileAuthAutoRefresh(authClient: SupabaseClient): void {
  authRefreshLifecycle = authRefreshLifecycle
    .then(async () => {
      // キューに入れた時点ではなく、実行直前の設定・前景状態を使う。
      const shouldRun = shouldRunAuthAutoRefresh();
      if (shouldRun === authRefreshRunning) return;
      if (shouldRun) {
        await authClient.auth.startAutoRefresh();
        authRefreshRunning = true;
      } else {
        await authClient.auth.stopAutoRefresh();
        authRefreshRunning = false;
      }
    })
    .catch(() => {
      // 停止／再開が一時的に失敗した場合は、次の設定・状態変化で再試行する。
    });
}

function attachAuthRefreshLifecycle(authClient: SupabaseClient): void {
  if (authSettingsUnsubscribe === null) {
    authSettingsUnsubscribe = useSettingsStore.subscribe((state, previousState) => {
      if (
        state.loaded !== previousState.loaded ||
        state.settings.syncMode !== previousState.settings.syncMode
      ) {
        reconcileAuthAutoRefresh(authClient);
      }
    });
  }

  if (Platform.OS === 'web') {
    if (authVisibilityHandler === null && typeof document !== 'undefined') {
      authVisibilityHandler = () => reconcileAuthAutoRefresh(authClient);
      document.addEventListener('visibilitychange', authVisibilityHandler);
    }
  } else if (authAppStateSubscription === null) {
    authAppStateSubscription = AppState.addEventListener('change', () =>
      reconcileAuthAutoRefresh(authClient),
    );
  }

  reconcileAuthAutoRefresh(authClient);
}

/**
 * Supabase クライアント。.env.local が未設定のときは null。
 * 使うのは Publishable Key のみ（公開前提）。データは RLS で保護される。
 * トークンの自動更新は「自動」モードの前景中だけ行い、手動／オフでは明示的な操作中に必要な場合だけ更新する。
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(ENV.supabaseUrl, ENV.supabasePublishableKey, {
      auth: {
        storage: sessionStorage,
        // startAutoRefresh は同期モード「自動」かつ前景のときだけ明示的に開始する。
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  attachAuthRefreshLifecycle(client);
  return client;
}

/**
 * ユーザーが明示的に開始した同期／認証操作用に、期限切れ間近のセッションだけ更新する。
 * getSession() 自体はローカルのセッション参照として使い、更新が必要なときだけ通信する。
 */
export async function getFreshSession(
  authClient: SupabaseClient,
  expectedUserId?: string,
): Promise<Session | null> {
  const { data, error } = await authClient.auth.getSession();
  if (error) throw error;
  let session = data.session;
  if (!session || (expectedUserId && session.user.id !== expectedUserId)) return null;

  const refreshThresholdSeconds = 30;
  if (
    typeof session.expires_at === 'number' &&
    session.expires_at <= Math.floor(Date.now() / 1000) + refreshThresholdSeconds
  ) {
    const refreshed = await authClient.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    session = refreshed.data.session;
  }

  if (!session || (expectedUserId && session.user.id !== expectedUserId)) return null;
  return session;
}

/**
 * 同期1回分の Supabase クライアント。
 * 認証セッションを切り替えた後も、この同期は開始時の access token でだけ通信する。
 * 自動更新・セッション保存は持たず、メインクライアントのユーザー変更に追従しない。
 */
export function createSyncSupabaseClient(accessToken: string): SupabaseClient {
  return createClient(ENV.supabaseUrl, ENV.supabasePublishableKey, {
    accessToken: async () => accessToken,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
