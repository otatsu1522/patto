import type { AnyRecord, TableName } from './types';

export type ColumnKind = 'text' | 'int' | 'bool' | 'json';

export interface ColumnDef {
  /** レコード（camelCase）のプロパティ名 */
  field: string;
  /** DB（snake_case）の列名 */
  column: string;
  kind: ColumnKind;
  nullable?: boolean;
}

const col = (field: string, kind: ColumnKind, nullable = false): ColumnDef => ({
  field,
  column: field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
  kind,
  nullable,
});

const BASE: ColumnDef[] = [
  col('id', 'text'),
  col('ownerId', 'text'),
  col('createdAt', 'int'),
  col('updatedAt', 'int'),
  col('deletedAt', 'int', true),
  col('fieldUpdatedAt', 'json'),
];

export const TABLE_DEFS: Record<TableName, ColumnDef[]> = {
  projects: [
    ...BASE,
    col('title', 'text'),
    col('description', 'text'),
    col('color', 'text', true),
    col('isFavorite', 'bool'),
    col('sortKey', 'text'),
    col('archivedAt', 'int', true),
  ],
  kanban_columns: [
    ...BASE,
    col('projectId', 'text'),
    col('title', 'text'),
    col('color', 'text', true),
    col('sortKey', 'text'),
    col('sortMode', 'text'),
    col('isDoneColumn', 'bool'),
  ],
  tasks: [
    ...BASE,
    col('projectId', 'text'),
    col('columnId', 'text'),
    col('title', 'text'),
    col('description', 'text'),
    col('color', 'text', true),
    col('dueAt', 'int', true),
    col('dueHasTime', 'bool'),
    col('isFavorite', 'bool'),
    col('sortKey', 'text'),
    col('completedAt', 'int', true),
    col('archivedAt', 'int', true),
  ],
};

export const TABLE_NAMES: TableName[] = ['projects', 'kanban_columns', 'tasks'];

/** マージ対象（識別子・作成日・メタ情報を除いた項目） */
const NON_MERGEABLE = new Set(['id', 'ownerId', 'createdAt', 'updatedAt', 'fieldUpdatedAt']);
export const mergeableFields = (table: TableName): string[] =>
  TABLE_DEFS[table].filter((c) => !NON_MERGEABLE.has(c.field)).map((c) => c.field);

type Row = Record<string, string | number | boolean | null | Record<string, number>>;

/** 端末(SQLite/ローカル)用の行: bool は 0/1、json は文字列、dirty を含む */
export function toLocalRow(
  table: TableName,
  rec: AnyRecord,
): Record<string, string | number | null> {
  const src = rec as unknown as Record<string, unknown>;
  const row: Record<string, string | number | null> = {};
  for (const c of TABLE_DEFS[table]) {
    const v = src[c.field];
    if (v === null || v === undefined) row[c.column] = null;
    else if (c.kind === 'bool') row[c.column] = v ? 1 : 0;
    else if (c.kind === 'json') row[c.column] = JSON.stringify(v);
    else row[c.column] = v as string | number;
  }
  row.dirty = rec.dirty ? 1 : 0;
  return row;
}

export function fromLocalRow<T extends AnyRecord>(
  table: TableName,
  row: Record<string, unknown>,
): T {
  const rec: Record<string, unknown> = {};
  for (const c of TABLE_DEFS[table]) {
    const v = row[c.column];
    if (v === null || v === undefined)
      rec[c.field] = c.kind === 'json' ? {} : c.kind === 'bool' ? false : null;
    else if (c.kind === 'bool') rec[c.field] = v === 1 || v === true;
    else if (c.kind === 'json') rec[c.field] = typeof v === 'string' ? safeParse(v) : v;
    else rec[c.field] = v;
  }
  rec.dirty = row.dirty === 1 || row.dirty === true;
  return rec as unknown as T;
}

/** サーバー(Supabase)用の行: bool/json はそのまま、dirty は含めない */
export function toRemoteRow(table: TableName, rec: AnyRecord): Row {
  const src = rec as unknown as Record<string, unknown>;
  const row: Row = {};
  for (const c of TABLE_DEFS[table]) {
    const v = src[c.field];
    row[c.column] = v === undefined ? null : (v as Row[string]);
  }
  return row;
}

export function fromRemoteRow<T extends AnyRecord>(
  table: TableName,
  row: Record<string, unknown>,
): T {
  const rec: Record<string, unknown> = {};
  for (const c of TABLE_DEFS[table]) {
    const v = row[c.column];
    if (v === null || v === undefined)
      rec[c.field] = c.kind === 'json' ? {} : c.kind === 'bool' ? false : null;
    else if (c.kind === 'int') rec[c.field] = Number(v);
    else rec[c.field] = v;
  }
  rec.dirty = false;
  return rec as unknown as T;
}

function safeParse(s: string): Record<string, number> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
