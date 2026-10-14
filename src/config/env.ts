/** 環境変数（.env.local）の読み取り。EXPO_PUBLIC_ 付きの値のみアプリから参照できる。 */
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
} as const;

/** .env.example のサンプル値のままのときは「未設定」として扱う。 */
const SAMPLE_MARKERS = ['abcdefghijklmnop', 'xxxxxxxx'];

export const isSupabaseConfigured: boolean =
  ENV.supabaseUrl.length > 0 &&
  ENV.supabasePublishableKey.length > 0 &&
  !SAMPLE_MARKERS.some(
    (m) => ENV.supabaseUrl.includes(m) || ENV.supabasePublishableKey.includes(m),
  );
