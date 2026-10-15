import { TABLE_DEFS } from '@/domain/schema';
import type { ColumnKind } from '@/domain/schema';
import type { TableName } from '@/domain/types';

const SQL_TYPE: Record<ColumnKind, string> = {
  text: 'TEXT',
  int: 'INTEGER',
  bool: 'INTEGER',
  json: 'TEXT',
};

function createTableSql(table: TableName): string {
  const cols = TABLE_DEFS[table].map((c) => {
    const pk = c.field === 'id' ? ' PRIMARY KEY' : '';
    const nn = c.nullable || c.field === 'id' ? '' : ' NOT NULL';
    return `${c.column} ${SQL_TYPE[c.kind]}${pk}${nn}`;
  });
  cols.push('dirty INTEGER NOT NULL DEFAULT 0');
  return `CREATE TABLE IF NOT EXISTS ${table} (${cols.join(', ')});`;
}

/**
 * スキーマの版管理。変更するときは末尾に追加し、既存の項目は書き換えない。
 * PRAGMA user_version と照らして、未適用のものだけ順に実行する。
 */
export const MIGRATIONS: string[][] = [
  [
    createTableSql('projects'),
    createTableSql('kanban_columns'),
    createTableSql('tasks'),
    'CREATE INDEX IF NOT EXISTS idx_columns_project ON kanban_columns(project_id);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id);',
    'CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);',
  ],
  [],
];
