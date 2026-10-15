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

export type ClearKind = 'trash' | 'archive';

export const previewClear = (kind: ClearKind, projectId?: string): number =>
  countTargets(purgeTargets(useDataStore.getState().snapshot(), kind, projectId));

export type ClearResult = { ok: true; count: number } | { ok: false; message: string };

/**
 * ごみ箱 / アーカイブを完全に削除する。
 * アカウント利用中は、競合を避けるため先に同期し、サーバー側を削除してから端末側を削除する。
 * 同期オフ・端末内のみのときは端末内だけ削除する。
 */
export async function clearBucket(kind: ClearKind, projectId?: string): Promise<ClearResult> {
  const store = useDataStore.getState();
  const targets = purgeTargets(store.snapshot(), kind, projectId);
  const count = countTargets(targets);
  if (count === 0) return { ok: true, count: 0 };

  const identity = useAuthStore.getState().identity;
  const syncs =
    !!identity && !identity.local && useSettingsStore.getState().settings.syncMode !== 'off';
  if (syncs) {
    const client = getSupabase();
    if (!client) return { ok: false, message: t('auth.notConfigured') };
    try {
      await syncNow({ throwOnError: true });
      const order: [TableName, string[]][] = [
        ['tasks', targets.tasks],
        ['kanban_columns', targets.columns],
        ['projects', targets.projects],
      ];
      for (const [table, ids] of order) {
        for (let i = 0; i < ids.length; i += 100) {
          const { error } = await client
            .from(table)
            .delete()
            .in('id', ids.slice(i, i + 100));
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
  const limit = now - retentionDays * 24 * 60 * 60 * 1000;
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
