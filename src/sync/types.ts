import type { TableName } from '@/domain/types';

export type RemoteRow = Record<string, unknown>;

/** サーバーとのやり取りの抽象。Supabase 実装は remoteSupabase.ts。テストではモックに差し替える。 */
export interface RemoteApi {
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
  deleteProjectsOwned(projectIds: string[], ownerId: string): Promise<void>;
  /** 所有者の全テーブルを単一サーバートランザクションで削除する。 */
  deleteAllOwnedData(ownerId: string): Promise<void>;
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
