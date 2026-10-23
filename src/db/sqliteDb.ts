import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { fromLocalRow, TABLE_DEFS, toLocalRow } from '@/domain/schema';
import type { AnyRecord, Snapshot, TableName } from '@/domain/types';
import { MIGRATIONS } from './migrations';
import { dbNameFor, type LocalDb, type LocalDbChanges, type LocalDbRemoval } from './types';

/** 端末内データベース（expo-sqlite）。Android / iOS / Web で同じ実装を使う。 */

type WebLockManager = {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T>;
};

/**
 * Web の SQLite ファイルをタブ間で排他利用する。
 * OPFS の同期アクセスハンドルは同じ DB を複数タブで同時に開けないため、
 * 接続が開いている間は Web Locks を保持し、競合時に別 DB へ分岐させない。
 */
async function acquireWebDatabaseLock(databaseName: string): Promise<() => void> {
  if (Platform.OS !== 'web') return () => undefined;
  if (typeof navigator === 'undefined') {
    throw new Error(
      'Web データベースの排他制御を利用できません。対応ブラウザーで開き直してください。',
    );
  }

  const locks = (navigator as Navigator & { locks?: WebLockManager }).locks;
  if (!locks) {
    throw new Error(
      'このブラウザーは複数タブ間のデータベース排他制御に対応していません。対応ブラウザーで開き直してください。',
    );
  }

  return new Promise<() => void>((resolve, reject) => {
    let acquired = false;
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolveHold) => {
      releaseHold = resolveHold;
    });
    const request = locks.request(
      `patto:sqlite-access:${databaseName}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          reject(
            new Error(
              'このデータベースは別のタブで使用中です。ほかの Patto タブを閉じてから、このタブを再読み込みしてください。',
            ),
          );
          return;
        }
        acquired = true;
        resolve(() => releaseHold());
        await hold;
      },
    );
    void request.catch((error) => {
      if (!acquired) reject(error);
    });
  });
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
  const releaseAccessLock = await acquireWebDatabaseLock(databaseName);
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

  let db: SQLite.SQLiteDatabase;
  try {
    db = await openAndMigrate();
  } catch (error) {
    releaseAccessLock();
    throw error;
  }

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
        try {
          await db.closeAsync();
        } finally {
          releaseAccessLock();
        }
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
  const name = `${dbNameFor(scope)}.db`;
  const releaseAccessLock = await acquireWebDatabaseLock(name);
  try {
    try {
      await SQLite.deleteDatabaseAsync(name);
    } catch (error) {
      // 起動時に作成されていない DB など、「元から存在しない」場合だけ成功扱いにする。
      if (!isMissingDatabaseError(error)) throw error;
    }
  } finally {
    releaseAccessLock();
  }
}
