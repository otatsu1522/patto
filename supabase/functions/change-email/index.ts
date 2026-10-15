// 認証済みユーザー本人のメールアドレスを、確認メールなしで直接変更する。
// service_role は Edge Function の中だけで使用し、アプリへは絶対に含めない。
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')
    return json({ code: 'method_not_allowed', message: 'POST を使用してください。' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return json({ code: 'unauthorized', message: 'ログインし直してからお試しください。' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey)
    return json(
      {
        code: 'server_configuration',
        message: 'メールアドレス変更機能のサーバー設定が不足しています。',
      },
      500,
    );

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: callerData, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerData.user)
    return json({ code: 'unauthorized', message: 'ログインし直してからお試しください。' }, 401);
  if (callerData.user.is_anonymous)
    return json(
      { code: 'account_required', message: '通常アカウントでログインしてください。' },
      403,
    );

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ code: 'invalid_body', message: '入力内容を確認してください。' }, 400);
  }
  const emailValue = (payload as { email?: unknown } | null)?.email;
  if (typeof emailValue !== 'string')
    return json(
      { code: 'invalid_email', message: 'メールアドレスの形式が正しくありません。' },
      400,
    );
  const email = emailValue.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json(
      { code: 'invalid_email', message: 'メールアドレスの形式が正しくありません。' },
      400,
    );

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
    if (message.includes('already') || message.includes('registered') || message.includes('unique'))
      return json(
        { code: 'email_in_use', message: 'このメールアドレスはすでに使用されています。' },
        409,
      );
    return json(
      {
        code: 'email_update_failed',
        message: 'メールアドレスを変更できませんでした。時間をおいて再試行してください。',
      },
      400,
    );
  }
  if (!data.user)
    return json(
      { code: 'email_update_failed', message: 'メールアドレスを変更できませんでした。' },
      500,
    );

  return json({ email: data.user.email ?? email });
});
