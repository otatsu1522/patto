import { t } from '@/i18n';

/** Supabase などのエラーを、画面に出す文言へ変換する（生のエラー文は出さない）。 */
export function mapAuthError(error: unknown): string {
  const e = error as { message?: string; status?: number; code?: string } | null;
  const msg = (e?.message ?? '').toLowerCase();
  const code = (e?.code ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return t('auth.error.invalidCredentials');
  if (code === 'anonymous_provider_disabled' || msg.includes('anonymous sign-ins are disabled')) return t('auth.error.guestDisabled');
  if (code === 'user_already_exists' || msg.includes('already registered')) return t('auth.error.userExists');
  if (e?.status === 429 || code.includes('rate_limit') || msg.includes('rate limit')) return t('auth.error.rateLimit');
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to')) return t('auth.error.network');
  return t('auth.error.unknown');
}

export const isNetworkError = (error: unknown): boolean => {
  const msg = ((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return msg.includes('network') || msg.includes('fetch') || msg.includes('failed to');
};

/** 同期中に「ログインし直しが必要」と判断するエラーか */
export const isAuthRequiredError = (error: unknown): boolean => {
  const e = error as { status?: number; code?: string; message?: string } | null;
  const code = (e?.code ?? '').toLowerCase();
  const msg = (e?.message ?? '').toLowerCase();
  return (
    e?.status === 401 ||
    code === 'pgrst301' ||
    code.includes('refresh_token') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid refresh token') ||
    msg.includes('auth session missing') ||
    msg === 'auth-required'
  );
};
