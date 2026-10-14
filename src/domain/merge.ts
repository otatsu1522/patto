import { mergeableFields } from './schema';
import type { AnyRecord, TableName } from './types';

type Dict = Record<string, unknown>;

const stamp = (rec: AnyRecord, field: string): number => rec.fieldUpdatedAt[field] ?? 0;

/** 値が同時刻のときも両端末で同じ結果になるよう、値の文字列表現で決める。 */
const tieBreak = (a: unknown, b: unknown): unknown =>
  JSON.stringify(a) >= JSON.stringify(b) ? a : b;

export interface MergeResult<T extends AnyRecord> {
  merged: T;
  /** マージ結果がサーバー側の行と異なる（= サーバーへ送る必要がある） */
  differsFromRemote: boolean;
  /** マージ結果が端末側の行と異なる（= 端末を更新する必要がある） */
  differsFromLocal: boolean;
}

/**
 * 項目単位の最終更新優先マージ。
 * - 別々の項目の変更は両方残る
 * - 同じ項目は fieldUpdatedAt が新しい方
 * - 削除(deletedAt)・アーカイブ(archivedAt)も項目の1つとして扱う
 * 純粋関数なので単体テストしやすい。
 */
export function mergeRecords<T extends AnyRecord>(
  table: TableName,
  local: T,
  remote: T,
): MergeResult<T> {
  const l = local as unknown as Dict;
  const r = remote as unknown as Dict;
  const out: Dict = { ...r };
  const fieldTs: Record<string, number> = { ...remote.fieldUpdatedAt };

  for (const f of mergeableFields(table)) {
    const lt = stamp(local, f);
    const rt = stamp(remote, f);
    let value: unknown;
    let ts: number;
    if (lt > rt) {
      value = l[f];
      ts = lt;
    } else if (rt > lt) {
      value = r[f];
      ts = rt;
    } else {
      value = JSON.stringify(l[f]) === JSON.stringify(r[f]) ? r[f] : tieBreak(l[f], r[f]);
      ts = rt;
    }
    out[f] = value ?? null;
    fieldTs[f] = ts;
  }

  out.id = remote.id;
  out.ownerId = remote.ownerId;
  out.createdAt = Math.min(local.createdAt, remote.createdAt);
  out.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  out.fieldUpdatedAt = fieldTs;
  out.dirty = false;

  const merged = out as unknown as T;
  return {
    merged,
    differsFromRemote: !sameContent(table, merged, remote),
    differsFromLocal: !sameContent(table, merged, local),
  };
}

function sameContent(table: TableName, a: AnyRecord, b: AnyRecord): boolean {
  const x = a as unknown as Dict;
  const y = b as unknown as Dict;
  if (a.updatedAt !== b.updatedAt) return false;
  return mergeableFields(table).every(
    (f) =>
      JSON.stringify(x[f] ?? null) === JSON.stringify(y[f] ?? null) && stamp(a, f) === stamp(b, f),
  );
}
