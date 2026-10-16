/** change-email Edge Function が返す API エラー応答。文言・コード・HTTP ステータスを実装から分離する。 */
export const CHANGE_EMAIL_RULES = {
  maxEmailLength: 254,
  emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  emailInUseErrorFragments: ['already', 'registered', 'unique'],
} as const;

export const CHANGE_EMAIL_RESPONSES = {
  successStatus: 200,
  preflightBody: 'ok',
  methodNotAllowed: {
    status: 405,
    code: 'method_not_allowed',
    message: 'POST を使用してください。',
  },
  unauthorized: {
    status: 401,
    code: 'unauthorized',
    message: 'ログインし直してからお試しください。',
  },
  serverConfiguration: {
    status: 500,
    code: 'server_configuration',
    message: 'メールアドレス変更機能のサーバー設定が不足しています。',
  },
  accountRequired: {
    status: 403,
    code: 'account_required',
    message: '通常アカウントでログインしてください。',
  },
  invalidBody: {
    status: 400,
    code: 'invalid_body',
    message: '入力内容を確認してください。',
  },
  invalidEmail: {
    status: 400,
    code: 'invalid_email',
    message: 'メールアドレスの形式が正しくありません。',
  },
  emailInUse: {
    status: 409,
    code: 'email_in_use',
    message: 'このメールアドレスはすでに使用されています。',
  },
  emailUpdateFailedRetry: {
    status: 400,
    code: 'email_update_failed',
    message: 'メールアドレスを変更できませんでした。時間をおいて再試行してください。',
  },
  emailUpdateFailed: {
    status: 500,
    code: 'email_update_failed',
    message: 'メールアドレスを変更できませんでした。',
  },
} as const;
