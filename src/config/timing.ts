/** UI・操作・起動処理の時間設定（ms）。既存の挙動を維持し、調整値を一元管理する。 */
export const TIMING = {
  /** ボード以外の画面でメニューを開閉するアニメーション */
  drawerAnimationMs: 200,
  /** 通知（トースト）の表示時間 */
  toastDurationMs: 1000,
  /** アプリ起動処理のタイムアウト */
  startupTimeoutMs: 25_000,
  /** 認証情報の初期化タイムアウト */
  authBootstrapTimeoutMs: 20_000,
  /** ローカルDBのオープン／読み込みタイムアウト */
  dbOpenTimeoutMs: 15_000,
  /** アカウント情報を再確認する間隔 */
  identityRefreshIntervalMs: 60_000,
  /** Androidで戻るキーを2回押して終了するまでの間隔 */
  androidBackExitWindowMs: 2000,
  /** スクロールイベント通知間隔 */
  scrollEventThrottleMs: 16,
  /** ドラッグ終了直後にカードのクリックを無視する間隔 */
  taskClickAfterDragGuardMs: 300,
  /** スマホWebでドラッグ開始時に振動させる時間 */
  webDragVibrationMs: 15,
} as const;
