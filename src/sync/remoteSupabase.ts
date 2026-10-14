import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '@/domain/types';
import type { RemoteApi, RemoteRow } from './types';

const fail = (error: unknown): never => {
  throw error;
};

/** Supabase（PostgreSQL + RLS）を使った RemoteApi 実装。RLS により自分の行だけが見える。 */
export function createSupabaseRemote(client: SupabaseClient): RemoteApi {
  return {
    async serverTime() {
      const { data, error } = await client.rpc('server_time');
      if (error) return fail(error);
      return Number(data);
    },

    async fetchSince(table: TableName, cursor: number, limit: number) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .gt('server_seq', cursor)
        .order('server_seq', { ascending: true })
        .limit(limit);
      if (error) return fail(error);
      return (data ?? []) as RemoteRow[];
    },

    async fetchByIds(table: TableName, ids: string[]) {
      const { data, error } = await client.from(table).select('*').in('id', ids);
      if (error) return fail(error);
      return (data ?? []) as RemoteRow[];
    },

    async upsert(table: TableName, rows: RemoteRow[]) {
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (error) fail(error);
    },

    async deleteByIds(table: TableName, ids: string[]) {
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await client
          .from(table)
          .delete()
          .in('id', ids.slice(i, i + 100));
        if (error) fail(error);
      }
    },

    async fetchHiddenIds(table: TableName) {
      const ids: string[] = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const query = client
          .from(table)
          .select('id')
          .range(from, from + page - 1);
        const filtered =
          table === 'kanban_columns'
            ? query.not('deleted_at', 'is', null)
            : query.or('deleted_at.not.is.null,archived_at.not.is.null');
        const { data, error } = await filtered;
        if (error) return fail(error);
        const rows = (data ?? []) as { id: string }[];
        ids.push(...rows.map((r) => r.id));
        if (rows.length < page) break;
      }
      return ids;
    },
  };
}
