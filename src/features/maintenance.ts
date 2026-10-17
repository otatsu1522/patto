import { getSupabase } from '@/auth/supabase';
import { isSupabaseConfigured } from '@/config/env';
import { useAuthStore } from '@/auth/authStore';
import { countTargets, purgeTargets } from '@/domain/selectors';
import { t } from '@/i18n';
import { syncNow } from '@/sync/controller';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSyncStore } from '@/sync/status';
import type { TableName } from '@/domain/types';
import { SYNC } from '@/config/limits';
import { DAY_MS } from '@/lib/dates';
import { nowMs } from '@/lib/clock';

export type ClearKind = 'trash' | 'archive';

export const previewClear = (kind: ClearKind, projectId?: string): number =>
  countTargets(purgeTargets(useDataStore.getState().snapshot(), kind, projectId));

export type ClearResult = { ok: true; count: number } | { ok: false; message: string };

/**
 * アーカイブの中身はごみ箱へ移動し、ごみ箱の中身は完全に削除する。
 * アカウント利用中は操作前に同期し、ごみ箱を完全削除する場合はサーバー側を削除してから端末側を削除する。
 * 同期オフ・端末内のみのときは端末内だけを変更する。
 */
export async function clearBucket(kind: ClearKind, projectId?: string): Promise<ClearResult> {
  const store = useDataStore.getState();
  let targets = purgeTargets(store.snapshot(), kind, projectId);
  let count = countTargets(targets);
  if (count === 0) return { ok: true, count: 0 };

  const identity = useAuthStore.getState().identity;
  const syncs =
    !!identity && !identity.local && useSettingsStore.getState().settings.syncMode !== 'off';
  let client: ReturnType<typeof getSupabase> = null;
  if (syncs) {
    client = getSupabase();
    if (!client) return { ok: false, message: t('auth.notConfigured') };
    try {
      // 同期中に呼ばれた場合、syncNow は false を返して次回同期をキューに積む。
      // 操作前の同期が実行されなかった場合は、変更・削除を続行しない。
      const synced = await syncNow({ throwOnError: true });
      if (!synced) return { ok: false, message: t('board.clearSyncNotStarted') };
    } catch {
      return { ok: false, message: t('board.clearNeedsSync') };
    }
    // 同期後の最新状態から対象を再取得し、確認時点以降の状態変化を反映する。
    targets = purgeTargets(useDataStore.getState().snapshot(), kind, projectId);
    count = countTargets(targets);
    if (count === 0) return { ok: true, count: 0 };
  }

  if (kind === 'archive') {
    // アーカイブのクリアは完全削除ではなく、ごみ箱へ移動する。
    // archivedAt を解除して deletedAt を設定するため、ごみ箱から復元可能になる。
    const movedCount = await useDataStore
      .getState()
      .moveArchivedTasksToTrash(targets.tasks, nowMs());
    return { ok: true, count: movedCount };
  }

  if (syncs && client) {
    const order: [TableName, string[]][] = [
      ['tasks', targets.tasks],
      ['kanban_columns', targets.columns],
      ['projects', targets.projects],
    ];
    try {
      for (const [table, ids] of order) {
        for (let i = 0; i < ids.length; i += SYNC.maxIdsPerQuery) {
          const { error } = await client
            .from(table)
            .delete()
            .in('id', ids.slice(i, i + SYNC.maxIdsPerQuery));
          if (error) throw error;
        }
      }
    } catch {
      return { ok: false, message: t('board.clearNeedsSync') };
    }
  }
  await store.purgeLocal(targets);
  return { ok: true, count };
}

/** ゲスト利用時: 保持日数を過ぎたごみ箱の中身を端末から自動削除する（アカウント時は同期処理で行う）。 */
export async function autoPurgeLocal(retentionDays: number, now: number): Promise<void> {
  const store = useDataStore.getState();
  const limit = now - retentionDays * DAY_MS;
  const snap = store.snapshot();
  const expired = (r: { deletedAt: number | null }) => r.deletedAt !== null && r.deletedAt < limit;
  const ids = {
    projects: snap.projects.filter(expired).map((r) => r.id),
    columns: snap.columns.filter(expired).map((r) => r.id),
    tasks: snap.tasks.filter(expired).map((r) => r.id),
  };
  if (countTargets(ids) > 0) await store.purgeLocal(ids);
}

/** 全データを完全削除し、アカウントを残したままアプリ設定を初期値へ戻す。 */
export async function resetAllData(): Promise<ClearResult> {
  const store = useDataStore.getState();
  const identity = useAuthStore.getState().identity;
  const ids = {
    projects: store.projects.map((item) => item.id),
    columns: store.columns.map((item) => item.id),
    tasks: store.tasks.map((item) => item.id),
  };
  const count = ids.projects.length + ids.columns.length + ids.tasks.length;

  if (identity && !identity.local && isSupabaseConfigured) {
    const client = getSupabase();
    if (!client) return { ok: false, message: t('settings.resetAllFailed') };
    try {
      // 親子の外部キーを設けていないため、子から順に削除する。
      for (const table of ['tasks', 'kanban_columns', 'projects'] as const) {
        const { error } = await client.from(table).delete().eq('owner_id', identity.userId);
        if (error) throw error;
      }
    } catch {
      return { ok: false, message: t('settings.resetAllFailed') };
    }
  }

  try {
    await store.purgeLocal(ids);
    useSettingsStore.getState().reset();
    useSyncStore.getState().set({ status: 'idle', lastSyncedAt: null, error: null });
    return { ok: true, count };
  } catch {
    return { ok: false, message: t('settings.resetAllFailed') };
  }
}
