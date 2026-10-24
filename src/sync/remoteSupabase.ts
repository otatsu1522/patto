import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '@/domain/types';
import { SYNC } from '@/config/limits';
import type { DeleteProjectsOwnedResult, RemoteApi, RemoteRow } from './types';

const fail = (error: unknown): never => {
  throw error;
};

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

/** Supabase（PostgreSQL + RLS）を使った RemoteApi 実装。RLS により自分の行だけが見える。 */
export function createSupabaseRemote(client: SupabaseClient): RemoteApi {
  let activeResetGeneration = 0;

  const fetchDeleteEvents = async (
    table: TableName,
    cursor: number,
    limit: number,
    upperBound?: number,
  ): Promise<RemoteRow[]> => {
    let query = client
      .from('patto_delete_events')
      .select('record_id, server_seq, reset_generation')
      .eq('table_name', table)
      .eq('reset_generation', activeResetGeneration)
      .gt('server_seq', cursor)
      .order('server_seq', { ascending: true });
    if (upperBound !== undefined) query = query.lte('server_seq', upperBound);
    const { data, error } = await query.limit(limit);
    if (error) return fail(error);
    return (
      (data ?? []) as {
        record_id: string;
        server_seq: number | string;
        reset_generation: number | string;
      }[]
    ).map((event) => ({
      id: event.record_id,
      server_seq: Number(event.server_seq),
      reset_generation: Number(event.reset_generation),
      _patto_deleted: true,
    }));
  };

  return {
    async getAccountResetGeneration(ownerId: string) {
      const { data, error } = await client
        .from('patto_account_data_state')
        .select('reset_generation')
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (error) return fail(error);
      activeResetGeneration = Number(data?.reset_generation ?? 0);
      if (!Number.isSafeInteger(activeResetGeneration) || activeResetGeneration < 0) {
        throw new Error('Invalid account reset generation');
      }
      return activeResetGeneration;
    },

    async serverTime() {
      const { data, error } = await client.rpc('server_time');
      if (error) return fail(error);
      return Number(data);
    },

    async latestServerSeq(table: TableName) {
      const [rowsResult, deletesResult] = await Promise.all([
        client
          .from(table)
          .select('server_seq')
          .order('server_seq', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from('patto_delete_events')
          .select('server_seq')
          .eq('table_name', table)
          .eq('reset_generation', activeResetGeneration)
          .order('server_seq', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (rowsResult.error) return fail(rowsResult.error);
      if (deletesResult.error) return fail(deletesResult.error);
      return Math.max(
        Number(rowsResult.data?.server_seq ?? 0),
        Number(deletesResult.data?.server_seq ?? 0),
      );
    },

    async fetchSince(
      table: TableName,
      cursor: number,
      limit: number,
      includeVisibleIds = [],
      upperBound?: number,
    ) {
      const base = () => {
        const query = client
          .from(table)
          .select('*')
          .gt('server_seq', cursor)
          .order('server_seq', { ascending: true });
        return upperBound === undefined ? query : query.lte('server_seq', upperBound);
      };

      const deleteEventsPromise = fetchDeleteEvents(table, cursor, limit, upperBound);

      if (table !== 'tasks') {
        const [rowsResult, deleteEvents] = await Promise.all([
          base().limit(limit),
          deleteEventsPromise,
        ]);
        if (rowsResult.error) return fail(rowsResult.error);
        return [...((rowsResult.data ?? []) as RemoteRow[]), ...deleteEvents]
          .sort((a, b) => Number(a.server_seq) - Number(b.server_seq))
          .slice(0, limit);
      }

      // 通常同期では、サーバーにだけ存在するアーカイブ／ごみ箱の本文を取得しない。
      // ローカルで表示中のタスクが別端末で非表示化された場合はそのIDだけ状態変更を取得し、
      // 別端末で通常表示へ復元されたタスクは、この表示対象の取得で反映する。
      // サーバーにだけ存在する非表示レコードの本文は、一覧ダイアログを開くまで取得しない。
      const visible = () => base().is('deleted_at', null).is('archived_at', null);
      const ids = [...new Set(includeVisibleIds)];
      const combinedIdLimit = 150;
      const requests: ReturnType<typeof base>[] = [];

      if (ids.length <= combinedIdLimit) {
        requests.push(
          ids.length > 0
            ? base()
                .or(`and(deleted_at.is.null,archived_at.is.null),id.in.(${ids.join(',')})`)
                .limit(limit)
            : visible().limit(limit),
        );
      } else {
        requests.push(visible().limit(limit));
        // 表示中のタスクがリモート側でアーカイブ／削除された場合だけ、その行を取得する。
        for (const part of chunks(ids, combinedIdLimit)) {
          requests.push(
            base().in('id', part).or('deleted_at.not.is.null,archived_at.not.is.null').limit(limit),
          );
        }
      }

      const [results, deleteEvents] = await Promise.all([
        Promise.all(
          requests.map(async (query) => {
            const { data, error } = await query;
            if (error) return fail(error);
            return (data ?? []) as RemoteRow[];
          }),
        ),
        deleteEventsPromise,
      ]);
      const byId = new Map<string, RemoteRow>();
      for (const rows of results) {
        for (const row of rows) byId.set(String(row.id), row);
      }
      return [...byId.values(), ...deleteEvents]
        .sort((a, b) => Number(a.server_seq) - Number(b.server_seq))
        .slice(0, limit);
    },

    async fetchByIds(table: TableName, ids: string[]) {
      const rows: RemoteRow[] = [];
      for (const part of chunks([...new Set(ids)], SYNC.maxIdsPerQuery)) {
        if (part.length === 0) continue;
        const { data, error } = await client.from(table).select('*').in('id', part);
        if (error) return fail(error);
        rows.push(...((data ?? []) as RemoteRow[]));
      }
      return rows;
    },

    async fetchHiddenForProject(projectId: string, kind: 'archive' | 'trash') {
      const page = SYNC.hiddenIdsPageSize;
      const tasks: RemoteRow[] = [];
      const columns: RemoteRow[] = [];

      for (let from = 0; ; from += page) {
        // Keep the archive and trash query chains separate. Combining the two
        // PostgREST builder types in a conditional expression can trigger
        // TS2589 (excessively deep type instantiation) with Supabase's types.
        let rows: RemoteRow[];
        if (kind === 'archive') {
          const { data, error } = await client
            .from('tasks')
            .select('*')
            .eq('project_id', projectId)
            .is('deleted_at', null)
            .not('archived_at', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + page - 1);
          if (error) return fail(error);
          rows = (data ?? []) as RemoteRow[];
        } else {
          const { data, error } = await client
            .from('tasks')
            .select('*')
            .eq('project_id', projectId)
            .not('deleted_at', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + page - 1);
          if (error) return fail(error);
          rows = (data ?? []) as RemoteRow[];
        }
        tasks.push(...rows);
        if (rows.length < page) break;
      }

      if (kind === 'trash') {
        for (let from = 0; ; from += page) {
          const { data, error } = await client
            .from('kanban_columns')
            .select('*')
            .eq('project_id', projectId)
            .not('deleted_at', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + page - 1);
          if (error) return fail(error);
          const rows = (data ?? []) as RemoteRow[];
          columns.push(...rows);
          if (rows.length < page) break;
        }
      }
      return { columns, tasks };
    },

    async upsert(table: TableName, rows: RemoteRow[]) {
      const versionedRows = rows.map((row) => ({
        ...row,
        reset_generation: activeResetGeneration,
      }));
      const { error } = await client.from(table).upsert(versionedRows, { onConflict: 'id' });
      if (error) fail(error);
    },

    async deleteByIds(table: TableName, ids: string[]) {
      for (const part of chunks(ids, SYNC.maxIdsPerQuery)) {
        const { error } = await client.from(table).delete().in('id', part);
        if (error) fail(error);
      }
    },

    async deleteAllOwned(table: TableName, ownerId: string) {
      const { error } = await client.from(table).delete().eq('owner_id', ownerId);
      if (error) fail(error);
    },

    async deleteProjectsOwned(projectIds: string[], ownerId: string) {
      if (projectIds.length === 0) return { deletedProjectIds: [], preservedProjectIds: [] };
      const { data, error } = await client.rpc('patto_delete_trashed_projects', {
        p_owner_id: ownerId,
        p_project_ids: projectIds,
      });
      if (error) fail(error);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid project-delete response');
      }
      const result = data as Record<string, unknown>;
      const deletedProjectIds = result.deleted_project_ids;
      const preservedProjectIds = result.preserved_project_ids;
      if (
        !Array.isArray(deletedProjectIds) ||
        deletedProjectIds.some((id) => typeof id !== 'string') ||
        !Array.isArray(preservedProjectIds) ||
        preservedProjectIds.some((id) => typeof id !== 'string')
      ) {
        throw new Error('Invalid project-delete response');
      }
      return {
        deletedProjectIds: deletedProjectIds as string[],
        preservedProjectIds: preservedProjectIds as string[],
      } satisfies DeleteProjectsOwnedResult;
    },

    async deleteAllOwnedData(ownerId: string, requestId: string) {
      const { data, error } = await client.rpc('patto_delete_all_owned_data', {
        p_owner_id: ownerId,
        p_request_id: requestId,
      });
      if (error) return fail(error);
      const generation = Number(data);
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new Error('Invalid account reset generation response');
      }
      activeResetGeneration = generation;
      return generation;
    },

    async deleteExpiredTrash(table: TableName, ownerId: string, cutoff: number) {
      const { error } = await client
        .from(table)
        .delete()
        .eq('owner_id', ownerId)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff);
      if (error) fail(error);
    },

    async fetchDeletedIds(table: TableName, ids: string[]) {
      const deletedIds: string[] = [];
      for (const part of chunks([...new Set(ids)], SYNC.maxIdsPerQuery)) {
        if (part.length === 0) continue;
        const { data, error } = await client
          .from('patto_delete_events')
          .select('record_id')
          .eq('table_name', table)
          .eq('reset_generation', activeResetGeneration)
          .in('record_id', part);
        if (error) return fail(error);
        deletedIds.push(...((data ?? []) as { record_id: string }[]).map((row) => row.record_id));
      }
      return [...new Set(deletedIds)];
    },

    async fetchHiddenIds(table: TableName, ids: string[]) {
      const hiddenIds: string[] = [];
      for (const part of chunks([...new Set(ids)], SYNC.maxIdsPerQuery)) {
        if (part.length === 0) continue;
        let query = client.from(table).select('id').in('id', part);
        query =
          table === 'kanban_columns'
            ? query.not('deleted_at', 'is', null)
            : query.or('deleted_at.not.is.null,archived_at.not.is.null');
        const { data, error } = await query;
        if (error) return fail(error);
        hiddenIds.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
      }
      return hiddenIds;
    },
  };
}
