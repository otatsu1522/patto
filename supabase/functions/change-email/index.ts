// 認証済みユーザー本人のメールアドレスを、確認メールなしで直接変更する。
// service_role は Edge Function の中だけで使用し、アプリへは絶対に含めない。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CHANGE_EMAIL_RESPONSES, CHANGE_EMAIL_RULES } from './responses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const respondWithError = (
  response: (typeof CHANGE_EMAIL_RESPONSES)[keyof typeof CHANGE_EMAIL_RESPONSES],
) => json({ code: response.code, message: response.message }, response.status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(CHANGE_EMAIL_RESPONSES.preflightBody, { headers: corsHeaders });
  if (req.method !== 'POST') return respondWithError(CHANGE_EMAIL_RESPONSES.methodNotAllowed);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return respondWithError(CHANGE_EMAIL_RESPONSES.unauthorized);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey)
    return respondWithError(CHANGE_EMAIL_RESPONSES.serverConfiguration);

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: callerData, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerData.user) return respondWithError(CHANGE_EMAIL_RESPONSES.unauthorized);
  if (callerData.user.is_anonymous) return respondWithError(CHANGE_EMAIL_RESPONSES.accountRequired);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return respondWithError(CHANGE_EMAIL_RESPONSES.invalidBody);
  }
  const emailValue = (payload as { email?: unknown } | null)?.email;
  if (typeof emailValue !== 'string') return respondWithError(CHANGE_EMAIL_RESPONSES.invalidEmail);
  const email = emailValue.trim().toLowerCase();
  if (
    email.length > CHANGE_EMAIL_RULES.maxEmailLength ||
    !CHANGE_EMAIL_RULES.emailPattern.test(email)
  )
    return respondWithError(CHANGE_EMAIL_RESPONSES.invalidEmail);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.updateUserById(callerData.user.id, {
    email,
    // Admin API で認証済みとして反映するため、確認メールは送らない。
    email_confirm: true,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (CHANGE_EMAIL_RULES.emailInUseErrorFragments.some((fragment) => message.includes(fragment)))
      return respondWithError(CHANGE_EMAIL_RESPONSES.emailInUse);
    return respondWithError(CHANGE_EMAIL_RESPONSES.emailUpdateFailedRetry);
  }
  if (!data.user) return respondWithError(CHANGE_EMAIL_RESPONSES.emailUpdateFailed);

  return json({ email: data.user.email ?? email }, CHANGE_EMAIL_RESPONSES.successStatus);
});
