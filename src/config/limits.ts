/** 入力・件数などの上限値と既定値。 */
export const LIMITS = {
  projectTitleMax: 100,
  columnTitleMax: 50,
  taskTitleMax: 300,
  taskDescriptionMax: 5000,
  /** 期限日を入力する欄の最大文字数（YYYY-MM-DD） */
  dueDateInputMax: 10,
  displayNameMax: 50,
  maxColumnsPerProject: 20,
  passwordMin: 8,
  passwordMax: 72,
  /** Trelloインポートの表示名プレビューの最大文字数 */
  importPreviewNameMax: 40,
  /** 画面を開いている間だけ保持するUndo項目数 */
  undoStackMaxEntries: 20,
} as const;

export const TRASH = {
  /** ごみ箱の自動削除までの日数（設定でON/OFF可能） */
  retentionDays: 30,
} as const;

export const SYNC = {
  /** 1回の取得件数 */
  pageSize: 500,
  /** 変更後に自動同期を始めるまでの待ち時間(ms) */
  debounceMs: 2000,
  /** 自動同期モードの定期同期間隔(ms) */
  intervalMs: 60_000,
  /** 再試行の間隔（指数バックオフ）(ms) */
  retryBaseMs: 5_000,
  retryMaxMs: 300_000,
  /** 端末時計が進んでいる場合の許容上限(ms) */
  maxClockSkewMs: 5 * 60_000,
  /** IDを1回のIN/削除クエリへ渡す最大件数 */
  maxIdsPerQuery: 100,
  /** 非表示IDのページング取得件数 */
  hiddenIdsPageSize: 1000,
  /** 変更がある行をローカルから取得する単位 */
  dirtyBatchSize: 100,
  /** 変更をサーバーへ送信する単位 */
  pushBatchSize: 200,
} as const;

export const SEARCH = {
  minLength: 1,
  maxResults: 100,
} as const;
