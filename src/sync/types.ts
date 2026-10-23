import type { TableName } from '@/domain/types';

export type RemoteRow = Record<string, unknown>;

export interface DeleteProjectsOwnedResult {
  /** サーバー上で削除された、または既に存在しなかったプロジェクトID。 */
  deletedProjectIds: string[];
  /** 別端末で復元済みのため、クリア対象から保護されたプロジェクトID。 */
  preservedProjectIds: string[];
}

/** サーバーとのやり取りの抽象。Supabase 実装は remoteSupabase.ts。テストではモックに差し替える。 */
export interface RemoteApi {
  /** 所有アカウントの全データ初期化世代。行がない場合は 0。 */
  getAccountResetGeneration(ownerId: string): Promise<number>;
  /** サーバー時刻（epoch ms） */
  serverTime(): Promise<number>;
  /** 指定テーブルで現在見えている最大の server_seq。差分取得の上限を固定する。 */
  latestServerSeq(table: TableName): Promise<number>;
  /**
   * server_seq が cursor より大きく upperBound 以下の行を昇順で取得する。
   * tasks では表示中IDの非表示化も検出する。
   */
  fetchSince(
    table: TableName,
    cursor: number,
    limit: number,
    includeVisibleIds?: string[],
    upperBound?: number,
  ): Promise<RemoteRow[]>;
  fetchByIds(table: TableName, ids: string[]): Promise<RemoteRow[]>;
  /** 指定プロジェクトのアーカイブ／ごみ箱を開いたときだけ取得する非表示レコード。 */
  fetchHiddenForProject(
    projectId: string,
    kind: 'archive' | 'trash',
  ): Promise<{ columns: RemoteRow[]; tasks: RemoteRow[] }>;
  upsert(table: TableName, rows: RemoteRow[]): Promise<void>;
  deleteByIds(table: TableName, ids: string[]): Promise<void>;
  /** 所有者IDを指定し、そのユーザーのテーブル内データを削除する（初期化の保留要求）。 */
  deleteAllOwned(table: TableName, ownerId: string): Promise<void>;
  /** ごみ箱にあるプロジェクト本体と配下レコードを、1トランザクションで削除する。 */
  deleteProjectsOwned(projectIds: string[], ownerId: string): Promise<DeleteProjectsOwnedResult>;
  /** 所有者の全テーブルを単一サーバートランザクションで削除し、新しい世代番号を返す。 */
  deleteAllOwnedData(ownerId: string, requestId: string): Promise<number>;
  /** deleted_at が cutoff より古いごみ箱データを所有者の全行から削除する。 */
  deleteExpiredTrash(table: TableName, ownerId: string, cutoff: number): Promise<void>;
  /** ローカルに残っている非表示レコードのIDだけ、サーバーにも存在するか確認する。 */
  fetchHiddenIds(table: TableName, ids: string[]): Promise<string[]>;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  purged: number;
}
