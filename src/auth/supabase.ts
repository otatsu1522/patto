import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV, isSupabaseConfigured } from '@/config/env';
import { sessionStorage } from './sessionStorage';

let client: SupabaseClient | null = null;

/**
 * Supabase クライアント。.env.local が未設定のときは null。
 * 使うのは Publishable Key のみ（公開前提）。データは RLS で保護される。
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(ENV.supabaseUrl, ENV.supabasePublishableKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
