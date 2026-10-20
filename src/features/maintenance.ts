import { acquireAccountWork } from '@/auth/accountWork';
import { createSyncSupabaseClient, getFreshSession, getSupabase } from '@/auth/supabase';
import { isSupabaseConfigured } from '@/config/env';
import { useAuthStore, type Identity } from '@/auth/authStore';
import { countTargets, purgeTargets } from '@/domain/selectors';
import { t } from '@/i18n';
import { acquireSyncMutationLock, syncNow } from '@/sync/controller';
import { queueRemoteDeleteAll, queueRemoteDeletes } from '@/sync/pendingDeletes';
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

const accountWorkUnavailable = (): ClearResult => ({
  ok: false,
  message: t('settings.accountLeaving'),
});

/**
 * アーカイブの中身はごみ箱へ移動し、ごみ箱の中身は完全に削除する。
 * 自動モードだけサーバー操作を即時実行する。手動／オフではローカルに削除要求を保存し、
 * 次に同期が許可されたときに送る。開始済みの同期は中断しない。
 */
export async function clearBucket(kind: ClearKind, projectId?: string): Promise<ClearResult> {
  const identity = useAuthStore.getState().identity;
  if (!identity) return accountWorkUnavailable();
  const releaseWork = acquireAccountWork(identity.userId);
  if (!releaseWork) return accountWorkUnavailable();

  try {
    const initialStore = useDataStore.getState();
    if (!initialStore.ready || initialStore.ownerId !== identity.userId) {
      return accountWorkUnavailable();
    }

    const initialTargets = purgeTargets(initialStore.snapshot(), kind, projectId);
    if (countTargets(initialTargets) === 0) return { ok: true, count: 0 };

    // 手動／オフでは、この操作自体が同期やリモート要求を開始しない。
    // リモート操作を即時実行するのは自動モードのみ。手動／オフの削除はDBメタへキューする。
    const syncMode = useSettingsStore.getState().settings.syncMode;
    const remoteAccount = !identity.local && isSupabaseConfigured;
    const syncs = remoteAccount && syncMode === 'auto';
    let client: ReturnType<typeof getSupabase> = null;
    if (syncs) {
      client = getSupabase();
      if (!client) return { ok: false, message: t('auth.notConfigured') };
      try {
        const synced = await syncNow({ throwOnError: true });
        if (!synced) return { ok: false, message: t('board.clearSyncNotStarted') };
      } catch {
        return { ok: false, message: t('board.clearNeedsSync') };
      }
    }

    // 完全削除・ローカル移動の最中に別の同期が始まらないよう入口を閉じる。
    // すでに実行中、または事前に受理済みの同期は完了を待つ。キャンセルはしない。
    const releaseSyncMutation = await acquireSyncMutationLock();
    try {
      const currentIdentity = useAuthStore.getState().identity;
      const currentStore = useDataStore.getState();
      if (
        currentIdentity?.userId !== identity.userId ||
        !currentStore.ready ||
        currentStore.ownerId !== identity.userId
      ) {
        return accountWorkUnavailable();
      }

      // 同期待ちの間にローカル内容が変化している可能性があるため、対象は操作直前に再取得する。
      const targets = purgeTargets(currentStore.snapshot(), kind, projectId);
      const count = countTargets(targets);
      if (count === 0) return { ok: true, count: 0 };

      if (kind === 'archive') {
        // アーカイブのクリアは完全削除ではなく、ごみ箱へ移動する。
        const movedCount = await currentStore.moveArchivedTasksToTrash(targets.tasks, nowMs());
        return { ok: true, count: movedCount };
      }

      if (syncs && client) {
        const order: [TableName, string[]][] = [
          ['tasks', targets.tasks],
          ['kanban_columns', targets.columns],
          ['projects', targets.projects],
        ];
        try {
          // 直前に認証ユーザーも照合し、共有セッションが別アカウントに変わっていたら削除しない。
          const session = await getFreshSession(client, identity.userId);
          if (!session?.access_token) {
            return { ok: false, message: t('auth.sessionMismatch') };
          }
          // リクエストごとに開始時点のトークンを固定し、後からセッションが切り替わっても
          // 別アカウントの資格情報で削除しない。owner_id 条件も併用する。
          const scopedClient = createSyncSupabaseClient(session.access_token);
          for (const [table, ids] of order) {
            for (let i = 0; i < ids.length; i += SYNC.maxIdsPerQuery) {
              const { error } = await scopedClient
                .from(table)
                .delete()
                .eq('owner_id', identity.userId)
                .in('id', ids.slice(i, i + SYNC.maxIdsPerQuery));
              if (error) throw error;
            }
          }
        } catch {
          return { ok: false, message: t('board.clearNeedsSync') };
        }
      } else if (remoteAccount) {
        // 手動／オフではネットワーク通信せず、削除要求を開始時のローカルDBへ永続化する。
        // 次に同期ボタンが押されるか自動同期が許可されたとき、固定済みの所有者IDで削除する。
        try {
          await queueRemoteDeletes(identity.userId, {
            projects: targets.projects,
            kanban_columns: targets.columns,
            tasks: targets.tasks,
          });
        } catch {
          return { ok: false, message: t('board.clearLocalFailed') };
        }
      }
      await currentStore.purgeLocal(targets);
      return { ok: true, count };
    } finally {
      releaseSyncMutation();
    }
  } finally {
    releaseWork();
  }
}

/** ゲスト／同期オフ時: 保持日数を過ぎたごみ箱の中身を端末から自動削除する。 */
export async function autoPurgeLocal(retentionDays: number, now: number): Promise<void> {
  const identity = useAuthStore.getState().identity;
  if (!identity) return;
  const releaseWork = acquireAccountWork(identity.userId);
  if (!releaseWork) return;
  try {
    // ローカル自動削除も実行中の同期と重ねず、同期が通常完了してから対象を確定する。
    const releaseSyncMutation = await acquireSyncMutationLock();
    try {
      const store = useDataStore.getState();
      if (!store.ready || store.ownerId !== identity.userId) return;
      const limit = now - retentionDays * DAY_MS;
      const snap = store.snapshot();
      const expired = (r: { deletedAt: number | null }) =>
        r.deletedAt !== null && r.deletedAt < limit;
      const ids = {
        projects: snap.projects.filter(expired).map((r) => r.id),
        columns: snap.columns.filter(expired).map((r) => r.id),
        tasks: snap.tasks.filter(expired).map((r) => r.id),
      };
      if (countTargets(ids) > 0) await store.purgeLocal(ids);
    } finally {
      releaseSyncMutation();
    }
  } finally {
    releaseWork();
  }
}

/** 全データを完全削除し、アカウントを残したままアプリ設定を初期値へ戻す。 */
export async function resetAllData(): Promise<ClearResult> {
  const identity: Identity | null = useAuthStore.getState().identity;
  if (!identity) return { ok: false, message: t('settings.resetAllFailed') };
  const releaseWork = acquireAccountWork(identity.userId);
  if (!releaseWork) return accountWorkUnavailable();

  try {
    // 初期化中に同期が並行すると、削除直後に古い行が再作成される可能性がある。
    // 先に同期を静止状態にし、実行中／事前受理済み処理を終えてから初期化する。
    const releaseSyncMutation = await acquireSyncMutationLock();
    try {
      const store = useDataStore.getState();
      if (!store.ready || store.ownerId !== identity.userId) {
        return { ok: false, message: t('settings.resetAllFailed') };
      }
      const ids = {
        projects: store.projects.map((item) => item.id),
        columns: store.columns.map((item) => item.id),
        tasks: store.tasks.map((item) => item.id),
      };
      const count = ids.projects.length + ids.columns.length + ids.tasks.length;

      const remoteAccount = !identity.local && isSupabaseConfigured;
      const syncMode = useSettingsStore.getState().settings.syncMode;
      if (remoteAccount && syncMode === 'auto') {
        const client = getSupabase();
        if (!client) return { ok: false, message: t('settings.resetAllFailed') };
        try {
          // 自動モードではサーバー操作を即時実行し、開始時の所有者とトークンを検証する。
          const session = await getFreshSession(client, identity.userId);
          if (!session?.access_token) {
            return { ok: false, message: t('auth.sessionMismatch') };
          }
          const scopedClient = createSyncSupabaseClient(session.access_token);
          // 親子の外部キーを設けていないため、子から順に削除する。
          for (const table of ['tasks', 'kanban_columns', 'projects'] as const) {
            const { error } = await scopedClient
              .from(table)
              .delete()
              .eq('owner_id', identity.userId);
            if (error) throw error;
          }
        } catch {
          return { ok: false, message: t('settings.resetAllFailed') };
        }
      } else if (remoteAccount) {
        // 手動／オフではネットワーク通信せず、全件削除要求をローカルDBへ保存する。
        // 次回同期時にこの所有者のデータを子から順に削除する。
        try {
          await queueRemoteDeleteAll(identity.userId);
        } catch {
          return { ok: false, message: t('settings.resetAllFailed') };
        }
      }

      // アカウント作業リースと同期入口のロックにより、同じDBが安定している。
      const currentIdentity = useAuthStore.getState().identity;
      const currentStore = useDataStore.getState();
      if (
        currentIdentity?.userId !== identity.userId ||
        !currentStore.ready ||
        currentStore.ownerId !== identity.userId
      ) {
        return { ok: false, message: t('settings.resetAllFailed') };
      }

      try {
        await currentStore.purgeLocal(ids);
        useSettingsStore.getState().reset({ preserveSyncMode: true });
        useSyncStore.getState().set({ status: 'idle', lastSyncedAt: null, error: null });
        return { ok: true, count };
      } catch {
        return { ok: false, message: t('settings.resetAllFailed') };
      }
    } finally {
      releaseSyncMutation();
    }
  } finally {
    releaseWork();
  }
}
