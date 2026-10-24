import { mergeableFields } from './schema';
import type { AnyRecord, TableName } from './types';

type Dict = Record<string, unknown>;

const stamp = (rec: AnyRecord, field: string): number => rec.fieldUpdatedAt[field] ?? 0;

/** JSON文字列を Unicode コードポイント順で比較し、クライアントと PostgreSQL の結果を揃える。 */
function compareJsonValues(a: unknown, b: unknown): number {
  const left = Array.from(JSON.stringify(a) ?? '', (character) => character.codePointAt(0)!);
  const right = Array.from(JSON.stringify(b) ?? '', (character) => character.codePointAt(0)!);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

/** 値が同時刻のときも両端末で同じ結果になるよう、値の文字列表現で決める。 */
const tieBreak = (a: unknown, b: unknown): unknown => (compareJsonValues(a, b) >= 0 ? a : b);

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
  const taskMoveFields = ['columnId', 'completedAt', 'sortKey'] as const;
  const taskMoveStateDiffers =
    table === 'tasks' &&
    (JSON.stringify(l.columnId ?? null) !== JSON.stringify(r.columnId ?? null) ||
      JSON.stringify(l.completedAt ?? null) !== JSON.stringify(r.completedAt ?? null));
  const localMoveRevision = Math.max(
    stamp(local, '__taskMove'),
    stamp(local, 'columnId'),
    stamp(local, 'completedAt'),
  );
  const remoteMoveRevision = Math.max(
    stamp(remote, '__taskMove'),
    stamp(remote, 'columnId'),
    stamp(remote, 'completedAt'),
  );
  const hasTaskMoveMetadata =
    Object.prototype.hasOwnProperty.call(local.fieldUpdatedAt, '__taskMove') ||
    Object.prototype.hasOwnProperty.call(remote.fieldUpdatedAt, '__taskMove');

  if (taskMoveStateDiffers) {
    // columnId と completedAt が違う場合、並べ替えを含む位置状態全体を一体として選ぶ。
    // 同じ revision なら状態タプルを比較し、複数端末でも同じ移動を選択する。
    let winner: Dict;
    let winnerRevision: number;
    if (localMoveRevision > remoteMoveRevision) {
      winner = l;
      winnerRevision = localMoveRevision;
    } else if (remoteMoveRevision > localMoveRevision) {
      winner = r;
      winnerRevision = remoteMoveRevision;
    } else {
      const localState = taskMoveFields.map((field) => l[field] ?? null);
      const remoteState = taskMoveFields.map((field) => r[field] ?? null);
      const localWins = compareJsonValues(localState, remoteState) >= 0;
      winner = localWins ? l : r;
      winnerRevision = localMoveRevision;
    }

    for (const field of taskMoveFields) {
      out[field] = winner[field] ?? null;
      fieldTs[field] = winnerRevision;
    }
    fieldTs.__taskMove = winnerRevision;
  }

  for (const f of mergeableFields(table)) {
    if (taskMoveStateDiffers && (taskMoveFields as readonly string[]).includes(f)) continue;
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

  if (table === 'tasks' && hasTaskMoveMetadata && !taskMoveStateDiffers) {
    // 同じ配置への通常編集では sortKey などのフィールド単位マージを維持しつつ、
    // hidden revision が古い値に戻らないよう最大の位置 revision を残す。
    fieldTs.__taskMove = Math.max(localMoveRevision, remoteMoveRevision);
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
  if (table === 'tasks' && stamp(a, '__taskMove') !== stamp(b, '__taskMove')) return false;
  return mergeableFields(table).every(
    (f) =>
      JSON.stringify(x[f] ?? null) === JSON.stringify(y[f] ?? null) && stamp(a, f) === stamp(b, f),
  );
}
