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

  return {
    async loadAll(): Promise<Snapshot> {
      const [projects, columns, tasks] = await Promise.all(
        TABLE_NAMES.map((t) => db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${t}`)),
      );
      return {
        projects: (projects ?? []).map((r) => fromLocalRow('projects', r)),
        columns: (columns ?? []).map((r) => fromLocalRow('kanban_columns', r)),
        tasks: (tasks ?? []).map((r) => fromLocalRow('tasks', r)),
      } as Snapshot;
    },

    async upsert(table: TableName, rows: AnyRecord[]): Promise<void> {
      if (rows.length === 0) return;
      const cols = [...TABLE_DEFS[table].map((c) => c.column), 'dirty'];
      const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      await db.withTransactionAsync(async () => {
        for (const rec of rows) {
          const row = toLocalRow(table, rec);
          await db.runAsync(sql, cols.map((c) => row[c] ?? null));
        }
      });
    },

    async remove(table: TableName, ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await db.withTransactionAsync(async () => {
        for (const id of ids) await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
      });
    },

    async getMeta(key: string): Promise<string | null> {
      const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
      return r?.value ?? null;
    },

    async setMeta(key: string, value: string): Promise<void> {
      await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
    },

    async close(): Promise<void> {
      await db.closeAsync();
    },
  };
}

export async function destroyLocalDb(scope: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(`${dbNameFor(scope)}.db`);
  } catch {
    /* 存在しない場合は無視 */
  }
}
