/** 開発時に異常なコンポーネント構成を検出した際の診断メッセージ。 */
export const DIAGNOSTIC_MESSAGES = {
  databaseNotOpen: 'DB が開かれていません',
  themeProviderMissing: 'ThemeProvider が見つかりません',
  feedbackProviderMissing: 'FeedbackProvider が見つかりません',
  menuProviderMissing: 'MenuProvider が見つかりません',
  invalidTrelloBoard: 'not a trello board',
} as const;
