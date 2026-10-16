/** delete-account Edge Function の API 応答定義。 */
export const DELETE_ACCOUNT_RESPONSES = {
  methodNotAllowed: { status: 405, body: 'method not allowed' },
  unauthorized: { status: 401, body: 'unauthorized' },
  internalError: { status: 500 },
  success: { status: 200 },
  preflightBody: 'ok',
} as const;
