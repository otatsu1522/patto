// 認証済みユーザー本人の現在のパスワードを検証してから、新しいパスワードへ変更する。
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
        message: 'パスワード変更機能のサーバー設定が不足しています。',
      },
      500,
    );

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: callerData, error: callerError } = await caller.auth.getUser();
  const user = callerData.user;
  if (callerError || !user)
    return json({ code: 'unauthorized', message: 'ログインし直してからお試しください。' }, 401);
  if (user.is_anonymous || !user.email)
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

  const body = payload as { currentPassword?: unknown; newPassword?: unknown } | null;
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (typeof currentPassword !== 'string' || currentPassword.length === 0)
    return json(
      { code: 'current_password_required', message: '現在のパスワードを入力してください。' },
      400,
    );
  if (
    typeof newPassword !== 'string' ||
    newPassword.length < 8 ||
    newPassword.length > 72 ||
    !/[A-Za-z]/.test(newPassword) ||
    !/\d/.test(newPassword)
  )
    return json(
      {
        code: 'invalid_new_password',
        message: '新しいパスワードは8〜72文字で、英字と数字を含めてください。',
      },
      400,
    );

  // 現在のパスワードは別クライアントで検証し、アプリの既存セッションを上書きしない。
  const verifier = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError || verified.user?.id !== user.id)
    return json(
      { code: 'invalid_current_password', message: '現在のパスワードが正しくありません。' },
      400,
    );

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateError) {
    const message = updateError.message.toLowerCase();
    if (message.includes('same password') || message.includes('different from the old password'))
      return json(
        {
          code: 'same_password',
          message: '新しいパスワードは現在のパスワードと異なるものを指定してください。',
        },
        400,
      );
    return json(
      {
        code: 'password_update_failed',
        message: 'パスワードを変更できませんでした。時間をおいて再試行してください。',
      },
      400,
    );
  }

  return json({ ok: true });
});
