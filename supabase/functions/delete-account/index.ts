// アカウント（ゲストを含む）の削除。呼び出したユーザー本人のみ削除できる。
// 管理者権限（service_role）はこの関数の中だけで使い、アプリには含めない。
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は Supabase が関数に自動で渡す。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DELETE_ACCOUNT_RESPONSES } from './responses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(DELETE_ACCOUNT_RESPONSES.preflightBody, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(DELETE_ACCOUNT_RESPONSES.methodNotAllowed.body, {
      status: DELETE_ACCOUNT_RESPONSES.methodNotAllowed.status,
      headers: corsHeaders,
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader)
    return new Response(DELETE_ACCOUNT_RESPONSES.unauthorized.body, {
      status: DELETE_ACCOUNT_RESPONSES.unauthorized.status,
      headers: corsHeaders,
    });

  const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data.user)
    return new Response(DELETE_ACCOUNT_RESPONSES.unauthorized.body, {
      status: DELETE_ACCOUNT_RESPONSES.unauthorized.status,
      headers: corsHeaders,
    });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // owner_id は auth.users への外部キー（on delete cascade）なので、ユーザーを消せばデータも消える
  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
  if (deleteError)
    return new Response(deleteError.message, {
      status: DELETE_ACCOUNT_RESPONSES.internalError.status,
      headers: corsHeaders,
    });

  return new Response(JSON.stringify({ ok: true }), {
    status: DELETE_ACCOUNT_RESPONSES.success.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
