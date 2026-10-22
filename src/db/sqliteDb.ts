import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { fromLocalRow, TABLE_DEFS, toLocalRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import { MIGRATIONS } from './migrations';
import { dbNameFor, type LocalDb, type LocalDbChanges, type LocalDbRemoval } from './types';

/** 端末内データベース（expo-sqlite）。Android / iOS / Web で同じ実装を使う。 */

const WEB_TAB_DATABASE_ID_KEY = 'patto:sqlite-tab-database-id';
let cachedWebTabDatabaseId: string | null = null;

/** 同一ブラウザー内で SQLite の共有ファイルを開けない場合に使う、タブ固有のDBスコープ。 */
export function webTabDatabaseScope(scope: string, rotateId = false): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (rotateId) {
    // 複製したタブは sessionStorage も複製されるため、同じタブ固有DBを
    // 先に開いたタブが使用中なら、新しいIDに切り替えて再試行する。
    cachedWebTabDatabaseId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.sessionStorage.setItem(WEB_TAB_DATABASE_ID_KEY, cachedWebTabDatabaseId);
    } catch {
      // ストレージが使えない環境でも、現在のページ内では識別できるIDを使用する。
    }
  } else if (!cachedWebTabDatabaseId) {
    try {
      cachedWebTabDatabaseId = window.sessionStorage.getItem(WEB_TAB_DATABASE_ID_KEY);
      if (!cachedWebTabDatabaseId) {
        cachedWebTabDatabaseId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(WEB_TAB_DATABASE_ID_KEY, cachedWebTabDatabaseId);
      }
    } catch {
      // ストレージが使えない環境でも、現在のページ内では識別できるIDを使用する。
      cachedWebTabDatabaseId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }
  return `${scope}__webtab_${cachedWebTabDatabaseId}`;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const statements = MIGRATIONS[version]!;
    await db.withTransactionAsync(async () => {
      for (const sql of statements) await db.execAsync(sql);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

export async function openLocalDb(scope: string): Promise<LocalDb> {
  const databaseName = `${dbNameFor(scope)}.db`;
  const openAndMigrate = async (): Promise<SQLite.SQLiteDatabase> => {
    const opened = await SQLite.openDatabaseAsync(databaseName);
    try {
      await migrate(opened);
      return opened;
    } catch (error) {
      await opened.closeAsync().catch(() => undefined);
      throw error;
    }
  };

  // Web 版では別タブも同じ IndexedDB/SQLite ファイルを開くため、初回オープンと
  // マイグレーションだけはタブ間でも直列化する。未対応ブラウザでは従来どおり開く。
  type WebLockManager = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
  };
  const locks =
    Platform.OS === 'web' && typeof navigator !== 'undefined'
      ? (navigator as Navigator & { locks?: WebLockManager }).locks
      : undefined;
  const db = locks
    ? await locks.request(`patto:sqlite-init:${databaseName}`, openAndMigrate)
    : await openAndMigrate();

  // withTransactionAsync() は排他的ではなく、同じ接続で複数のトランザクションが重なるとエラーになる。
  // そのため、この接続への読み書きはすべて1本の待ち行列に並べて、1つずつ順番に実行する。
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    loadAll: () =>
      serial(async (): Promise<Snapshot> => {
        const projects = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM projects');
        const columns = await db.getAllAsync<Record<string, unknown>>(
          'SELECT * FROM kanban_columns',
        );
        const tasks = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks');
        return {
          projects: (projects ?? []).map((r) => fromLocalRow('projects', r)),
          columns: (columns ?? []).map((r) => fromLocalRow('kanban_columns', r)),
          tasks: (tasks ?? []).map((r) => fromLocalRow('tasks', r)),
        } as Snapshot;
      }),

    applyChanges: (changes: LocalDbChanges, removed: LocalDbRemoval[] = []) =>
      serial(async () => {
        const writes: { table: TableName; rows: AnyRecord[] }[] = [
          { table: 'projects', rows: changes.projects ?? [] },
          { table: 'kanban_columns', rows: changes.columns ?? [] },
          { table: 'tasks', rows: changes.tasks ?? [] },
        ];
        if (
          writes.every((write) => write.rows.length === 0) &&
          removed.every((item) => item.ids.length === 0)
        ) {
          return;
        }

        // 親と子の更新、またはリモート削除と取得データの適用を一括確定する。
        // 途中のテーブルで失敗した場合は SQLite がトランザクション全体をロールバックする。
        await db.withTransactionAsync(async () => {
          // 外部キー制約が有効なスキーマでも、子から親の順に削除する。
          const deleteOrder: TableName[] = ['tasks', 'kanban_columns', 'projects'];
          for (const table of deleteOrder) {
            for (const item of removed) {
              if (item.table !== table) continue;
              for (const id of item.ids) {
                await db.runAsync(`DELETE FROM ${item.table} WHERE id = ?`, [id]);
              }
            }
          }
          for (const { table, rows } of writes) {
            if (rows.length === 0) continue;
            const cols = [...TABLE_DEFS[table].map((c) => c.column), 'dirty'];
            const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
            for (const rec of rows) {
              const row = toLocalRow(table, rec);
              await db.runAsync(
                sql,
                cols.map((c) => row[c] ?? null),
              );
            }
          }
        });
      }),

    upsert: (table: TableName, rows: AnyRecord[]) =>
      serial(async () => {
        if (rows.length === 0) return;
        const cols = [...TABLE_DEFS[table].map((c) => c.column), 'dirty'];
        const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        await db.withTransactionAsync(async () => {
          for (const rec of rows) {
            const row = toLocalRow(table, rec);
            await db.runAsync(
              sql,
              cols.map((c) => row[c] ?? null),
            );
          }
        });
      }),

    remove: (table: TableName, ids: string[]) =>
      serial(async () => {
        if (ids.length === 0) return;
        await db.withTransactionAsync(async () => {
          for (const id of ids) await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
        });
      }),

    getMeta: (key: string) =>
      serial(async () => {
        const r = await db.getFirstAsync<{ value: string }>(
          'SELECT value FROM sync_meta WHERE key = ?',
          [key],
        );
        return r?.value ?? null;
      }),

    setMeta: (key: string, value: string) =>
      serial(async () => {
        await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
          key,
          value,
        ]);
      }),

    close: () =>
      serial(async () => {
        await db.closeAsync();
      }),
  };
}

function isMissingDatabaseError(error: unknown): boolean {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /DatabaseNotFoundException|database .+ not found|no such file or directory|ENOENT/i.test(
    detail,
  );
}

export async function destroyLocalDb(scope: string): Promise<void> {
  const names = new Set([`${dbNameFor(scope)}.db`]);
  const tabScope = webTabDatabaseScope(scope);
  if (tabScope) names.add(`${dbNameFor(tabScope)}.db`);
  const results = await Promise.allSettled(
    [...names].map(async (name) => {
      try {
        await SQLite.deleteDatabaseAsync(name);
      } catch (error) {
        // 起動時に作成されていないタブ用DBなど、「元から存在しない」場合だけ成功扱いにする。
        if (!isMissingDatabaseError(error)) throw error;
      }
    }),
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
