import type { TableName } from '@/domain/types';

export type RemoteRow = Record<string, unknown>;

/** サーバーとのやり取りの抽象。Supabase 実装は remoteSupabase.ts。テストではモックに差し替える。 */
export interface RemoteApi {
  /** サーバー時刻（epoch ms） */
  serverTime(): Promise<number>;
  /** server_seq が cursor より大きい行を昇順で取得 */
  fetchSince(table: TableName, cursor: number, limit: number): Promise<RemoteRow[]>;
  fetchByIds(table: TableName, ids: string[]): Promise<RemoteRow[]>;
  upsert(table: TableName, rows: RemoteRow[]): Promise<void>;
  deleteByIds(table: TableName, ids: string[]): Promise<void>;
  /** 削除済み・アーカイブ済みの行のID一覧（完全削除の反映確認用） */
  fetchHiddenIds(table: TableName): Promise<string[]>;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  purged: number;
}
