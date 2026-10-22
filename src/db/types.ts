import type { AnyRecord, Snapshot, TableName } from '@/domain/types';

/** 端末内データベースの共通インターフェース（ネイティブ: SQLite / Web: localStorage）。 */
export interface LocalDbChanges {
  projects?: AnyRecord[];
  columns?: AnyRecord[];
  tasks?: AnyRecord[];
}

export interface LocalDbRemoval {
  table: TableName;
  ids: string[];
}

export interface LocalDb {
  loadAll(): Promise<Snapshot>;
  /** 関連テーブルの削除・更新を単一トランザクションとして永続化する。 */
  applyChanges(changes: LocalDbChanges, removed?: LocalDbRemoval[]): Promise<void>;
  upsert(table: TableName, rows: AnyRecord[]): Promise<void>;
  remove(table: TableName, ids: string[]): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

/** 利用者（scope）ごとにDBを分ける。ゲストは 'guest'、アカウントはユーザーID。 */
export const dbNameFor = (scope: string): string => `patto_${scope}`;
