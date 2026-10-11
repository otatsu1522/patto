/** 入力・件数などの上限値と既定値。 */
export const LIMITS = {
  projectTitleMax: 100,
  projectDescriptionMax: 1000,
  columnTitleMax: 50,
  taskTitleMax: 200,
  taskDescriptionMax: 5000,
  displayNameMax: 50,
  maxColumnsPerProject: 20,
  passwordMin: 8,
  passwordMax: 72,
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
} as const;

export const SEARCH = {
  minLength: 1,
  maxResults: 100,
} as const;
