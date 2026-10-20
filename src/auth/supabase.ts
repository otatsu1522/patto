import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV, isSupabaseConfigured } from '@/config/env';
import { sessionStorage } from './sessionStorage';

let client: SupabaseClient | null = null;
let authAppStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let authRefreshLifecycle: Promise<void> = Promise.resolve();

/**
 * Supabase クライアント。.env.local が未設定のときは null。
 * 使うのは Publishable Key のみ（公開前提）。データは RLS で保護される。
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    const createdClient = createClient(ENV.supabaseUrl, ENV.supabasePublishableKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    client = createdClient;

    // Supabase Auth はネイティブ環境では自動更新タイマーがバックグラウンドでも動き続ける。
    // アプリ状態に合わせて停止／再開し、Web の可視状態管理は Supabase 標準動作に任せる。
    if (Platform.OS !== 'web' && authAppStateSubscription === null) {
      const updateAutoRefresh = (state: string | null) => {
        authRefreshLifecycle = authRefreshLifecycle
          .then(() =>
            state === 'active'
              ? createdClient.auth.startAutoRefresh()
              : createdClient.auth.stopAutoRefresh(),
          )
          .catch(() => {
            // 認証更新の停止／再開が一時的に失敗しても、後続の状態変化で再試行する。
          });
      };
      authAppStateSubscription = AppState.addEventListener('change', updateAutoRefresh);
      updateAutoRefresh(AppState.currentState);
    }
  }
  return client;
}
