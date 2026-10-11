import * as SQLite from 'expo-sqlite';
import { fromLocalRow, TABLE_DEFS, TABLE_NAMES, toLocalRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import { MIGRATIONS } from './migrations';
import { dbNameFor, type LocalDb } from './types';

/** 端末内データベース（expo-sqlite）。Android / iOS / Web で同じ実装を使う。 */

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
  const db = await SQLite.openDatabaseAsync(`${dbNameFor(scope)}.db`);
  await migrate(db);

  // withTransactionAsync() は排他的ではなく、同じ接続で複数のトランザクションが重なるとエラーになる。
  // そのため、この接続への読み書きはすべて1本の待ち行列に並べて、1つずつ順番に実行する。
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    loadAll: () =>
      serial(async (): Promise<Snapshot> => {
      const projects = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM projects');
      const columns = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM kanban_columns');
      const tasks = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks');
      return {
        projects: (projects ?? []).map((r) => fromLocalRow('projects', r)),
        columns: (columns ?? []).map((r) => fromLocalRow('kanban_columns', r)),
        tasks: (tasks ?? []).map((r) => fromLocalRow('tasks', r)),
      } as Snapshot;
      }),

    upsert: (table: TableName, rows: AnyRecord[]) =>
      serial(async () => {
        if (rows.length === 0) return;
        const cols = [...TABLE_DEFS[table].map((c) => c.column), 'dirty'];
        const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        await db.withTransactionAsync(async () => {
          for (const rec of rows) {
            const row = toLocalRow(table, rec);
            await db.runAsync(sql, cols.map((c) => row[c] ?? null));
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
        const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
        return r?.value ?? null;
      }),

    setMeta: (key: string, value: string) =>
      serial(async () => {
        await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
      }),

    close: () =>
      serial(async () => {
        await db.closeAsync();
      }),
  };
}

export async function destroyLocalDb(scope: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(`${dbNameFor(scope)}.db`);
  } catch {
    /* 存在しない場合は無視 */
  }
}
