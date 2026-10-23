import { acquireAccountWork } from '@/auth/accountWork';
import { createSyncSupabaseClient, getFreshSession, getSupabase } from '@/auth/supabase';
import { isSupabaseConfigured } from '@/config/env';
import { useAuthStore, type Identity } from '@/auth/authStore';
import { countTargets, purgeTargets } from '@/domain/selectors';
import { t } from '@/i18n';
import { acquireSyncMutationLock, syncNow } from '@/sync/controller';
import {
  cancelPreparedRemoteDeleteAll,
  capturePendingRemoteDeletes,
  commitRemoteDeleteAll,
  flushPendingRemoteDeletes,
  queueRemoteDeleteAll,
  queueRemoteDeletes,
  queueRemoteExpiredTrash,
  queueRemoteProjectDeletes,
  removeQueuedRemoteDeletes,
  restorePendingRemoteDeletes,
  removeQueuedRemoteProjectDeletes,
} from '@/sync/pendingDeletes';
import { createSupabaseRemote } from '@/sync/remoteSupabase';
import { getDb, useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSyncStore } from '@/sync/status';
import type { TableName } from '@/domain/types';
import { DAY_MS } from '@/lib/dates';
import { nowMs } from '@/lib/clock';
import { RESET_GENERATION_META_KEY } from '@/sync/resetGeneration';

export type ClearKind = 'trash' | 'archive';

export const previewClear = (kind: ClearKind, projectId?: string): number =>
  countTargets(purgeTargets(useDataStore.getState().snapshot(), kind, projectId));

export type ClearResult =
  | {
      ok: true;
      count: number;
      projectCount?: number;
      remotePending?: boolean;
      /** 別端末で復元済みだったため、サーバー側で削除を保護したプロジェクト数。 */
      preservedProjectCount?: number;
    }
  | { ok: false; message: string };

const accountWorkUnavailable = (): ClearResult => ({
  ok: false,
  message: t('settings.accountLeaving'),
});

/**
 * アーカイブの中身はごみ箱へ移動し、ごみ箱の中身は完全に削除する。
 * 自動モードだけサーバー操作を即時実行する。手動／オフではローカルに削除要求を保存し、
 * 次に同期が許可されたときに送る。開始済みの同期は中断しない。
 */
export async function clearBucket(
  kind: ClearKind,
  projectId?: string,
  includeProject = false,
  projectIds?: string[],
): Promise<ClearResult> {
  const identity = useAuthStore.getState().identity;
  if (!identity) return accountWorkUnavailable();
  const releaseWork = acquireAccountWork(identity.userId);
  if (!releaseWork) return accountWorkUnavailable();

  try {
    const initialStore = useDataStore.getState();
    if (!initialStore.ready || initialStore.ownerId !== identity.userId) {
      return accountWorkUnavailable();
    }

    const targetsForCurrentScope = (snapshot: ReturnType<typeof initialStore.snapshot>) => {
      // サイドバーからは、ごみ箱にあるプロジェクトと配下の全レコードだけを対象にする。
      // 非表示の子レコードが端末に未取得でも、サーバー側はプロジェクト単位で削除する。
      if (kind === 'trash' && projectIds !== undefined) {
        const wanted = new Set(projectIds);
        const projects = snapshot.projects.filter(
          (item) => wanted.has(item.id) && item.deletedAt !== null,
        );
        const selectedProjectIds = new Set(projects.map((item) => item.id));
        return {
          projects: projects.map((item) => item.id),
          columns: snapshot.columns
            .filter((item) => selectedProjectIds.has(item.projectId))
            .map((item) => item.id),
          tasks: snapshot.tasks
            .filter((item) => selectedProjectIds.has(item.projectId))
            .map((item) => item.id),
        };
      }

      if (kind === 'trash' && includeProject && projectId) {
        const project = snapshot.projects.find((item) => item.id === projectId);
        if (!project || project.deletedAt === null) {
          return { projects: [], columns: [], tasks: [] };
        }
        return {
          projects: [project.id],
          // 個別の完全削除では deletedAt の状態によらず、配下のレコードを全て対象にする。
          columns: snapshot.columns
            .filter((item) => item.projectId === project.id)
            .map((item) => item.id),
          tasks: snapshot.tasks
            .filter((item) => item.projectId === project.id)
            .map((item) => item.id),
        };
      }

      const targets = purgeTargets(snapshot, kind, projectId);
      if (kind === 'trash' && projectId === undefined) {
        // 設定画面のごみ箱クリアでも、削除済みプロジェクト配下の未削除レコードを漏らさない。
        const trashedProjectIds = new Set(targets.projects);
        targets.columns = [
          ...new Set([
            ...targets.columns,
            ...snapshot.columns
              .filter((item) => trashedProjectIds.has(item.projectId))
              .map((item) => item.id),
          ]),
        ];
        targets.tasks = [
          ...new Set([
            ...targets.tasks,
            ...snapshot.tasks
              .filter((item) => trashedProjectIds.has(item.projectId))
              .map((item) => item.id),
          ]),
        ];
      }
      return targets;
    };

    const initialTargets = targetsForCurrentScope(initialStore.snapshot());
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
      const targets = targetsForCurrentScope(currentStore.snapshot());
      const count = countTargets(targets);
      if (count === 0) return { ok: true, count: 0 };

      if (kind === 'archive') {
        // アーカイブのクリアは完全削除ではなく、ごみ箱へ移動する。
        const movedCount = await currentStore.moveArchivedTasksToTrash(targets.tasks, nowMs());
        return { ok: true, count: movedCount };
      }

      const cascadeProjectIds = kind === 'trash' ? targets.projects : [];
      const cascadeProjectSet = new Set(cascadeProjectIds);
      const snapshotBeforePurge = currentStore.snapshot();
      const cascadedColumnIds = new Set(
        snapshotBeforePurge.columns
          .filter((item) => cascadeProjectSet.has(item.projectId))
          .map((item) => item.id),
      );
      const cascadedTaskIds = new Set(
        snapshotBeforePurge.tasks
          .filter((item) => cascadeProjectSet.has(item.projectId))
          .map((item) => item.id),
      );
      const standaloneTargets = {
        projects: targets.projects.filter((id) => !cascadeProjectSet.has(id)),
        columns: targets.columns.filter((id) => !cascadedColumnIds.has(id)),
        tasks: targets.tasks.filter((id) => !cascadedTaskIds.has(id)),
      };
      const standaloneRemoteTargets: Partial<Record<TableName, string[]>> = {
        projects: standaloneTargets.projects,
        kanban_columns: standaloneTargets.columns,
        tasks: standaloneTargets.tasks,
      };

      let previousDeleteQueue: Awaited<ReturnType<typeof capturePendingRemoteDeletes>> | null =
        null;
      if (remoteAccount) {
        try {
          // ローカル削除が失敗した場合に今回追加した要求だけを戻せるよう、既存キューを退避する。
          previousDeleteQueue = await capturePendingRemoteDeletes(identity.userId);
          if (cascadeProjectIds.length > 0) {
            // サーバーにしかない子レコードも削除できるよう、プロジェクト単位の要求を永続化する。
            await queueRemoteProjectDeletes(identity.userId, cascadeProjectIds);
          }
          if (
            standaloneTargets.projects.length > 0 ||
            standaloneTargets.columns.length > 0 ||
            standaloneTargets.tasks.length > 0
          ) {
            // 先に永続キューを確保し、ローカル削除が確定してからサーバー削除を実行する。
            await queueRemoteDeletes(identity.userId, standaloneRemoteTargets);
          }
        } catch {
          if (previousDeleteQueue) {
            await restorePendingRemoteDeletes(identity.userId, previousDeleteQueue).catch(
              () => undefined,
            );
          }
          return {
            ok: false,
            message: t('board.clearLocalFailed'),
          };
        }
      }

      // 永続キューを確保してからローカル削除を行う。DBトランザクションが失敗した場合は
      // 今回の操作前のキューへ戻し、サーバーだけ削除される状態を避ける。
      try {
        await currentStore.purgeLocal(targets);
      } catch (error) {
        if (remoteAccount && previousDeleteQueue) {
          await restorePendingRemoteDeletes(identity.userId, previousDeleteQueue).catch(
            () => undefined,
          );
        }
        throw error;
      }

      // 手動／オフでは要求を保持して次の同期で処理する。自動モードはローカル削除後に
      // RPC／ID削除を実行し、完了した要求だけをキューから除く。
      let remotePending = remoteAccount && !syncs;
      let preservedProjectIds: string[] = [];
      if (remoteAccount && syncs && client) {
        try {
          const session = await getFreshSession(client, identity.userId);
          if (!session?.access_token) throw new Error('Supabase session is unavailable');
          const remote = createSupabaseRemote(createSyncSupabaseClient(session.access_token));
          if (cascadeProjectIds.length > 0) {
            const projectDelete = await remote.deleteProjectsOwned(
              cascadeProjectIds,
              identity.userId,
            );
            preservedProjectIds = projectDelete.preservedProjectIds;
          }
          for (const [table, ids] of [
            ['tasks', standaloneTargets.tasks],
            ['kanban_columns', standaloneTargets.columns],
            ['projects', standaloneTargets.projects],
          ] as [TableName, string[]][]) {
            if (ids.length > 0) await remote.deleteByIds(table, ids);
          }
          await removeQueuedRemoteProjectDeletes(identity.userId, cascadeProjectIds);
          await removeQueuedRemoteDeletes(identity.userId, standaloneRemoteTargets);
          remotePending = false;
        } catch {
          remotePending = true;
        }
      }

      // count は削除した全レコード数を保ち、サイドバーではプロジェクト数を別途返す。
      return {
        ok: true,
        count,
        ...(projectIds !== undefined ? { projectCount: targets.projects.length } : {}),
        ...(remotePending ? { remotePending: true } : {}),
        ...(preservedProjectIds.length > 0
          ? { preservedProjectCount: preservedProjectIds.length }
          : {}),
      };
    } finally {
      releaseSyncMutation();
    }
  } finally {
    releaseWork();
  }
}

/** サイドバーのごみ箱にある複数のプロジェクトと配下のレコードを完全削除する。 */
export async function clearTrashedProjects(projectIds: string[]): Promise<ClearResult> {
  if (projectIds.length === 0) return { ok: true, count: 0 };
  return clearBucket('trash', undefined, false, projectIds);
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
      const remoteAccount = !identity.local && isSupabaseConfigured;
      const syncMode = useSettingsStore.getState().settings.syncMode;
      // 同期オフの保持期限削除は、サーバー上だけにある期限切れ行も対象にできるよう
      // cutoff を先に永続化する。キュー保存失敗時はローカルも削除しない。
      if (remoteAccount && syncMode === 'off') {
        await queueRemoteExpiredTrash(identity.userId, limit);
      }
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

      // 先に準備状態を永続化するが、この段階では次回同期もサーバー削除を実行しない。
      // ローカル削除成功後に ready 状態へ確定する。クラッシュ時は同期時にローカル状態から回復する。
      if (remoteAccount) {
        try {
          await queueRemoteDeleteAll(identity.userId, {
            projects: ids.projects,
            kanban_columns: ids.columns,
            tasks: ids.tasks,
          });
        } catch {
          return { ok: false, message: t('settings.resetAllFailed') };
        }
      }

      try {
        await currentStore.purgeLocal(ids);
      } catch {
        if (remoteAccount) {
          await cancelPreparedRemoteDeleteAll(identity.userId).catch(() => undefined);
        }
        return { ok: false, message: t('settings.resetAllFailed') };
      }

      let remotePending = remoteAccount;
      let deleteAllReady = !remoteAccount;
      if (remoteAccount) {
        try {
          await commitRemoteDeleteAll(identity.userId);
          deleteAllReady = true;
        } catch {
          // 準備状態は残る。次回同期時にローカルが空であることを確認して確定し直す。
          remotePending = true;
        }
      }

      try {
        const settingsReset = await useSettingsStore.getState().reset({ preserveSyncMode: true });
        if (!settingsReset) return { ok: false, message: t('settings.resetAllFailed') };
        useSyncStore
          .getState()
          .set({ status: 'idle', activeSource: null, lastSyncedAt: null, error: null });

        if (remoteAccount && syncMode === 'auto' && deleteAllReady) {
          try {
            const client = getSupabase();
            if (!client) throw new Error('Supabase client is unavailable');
            const session = await getFreshSession(client, identity.userId);
            if (!session?.access_token) throw new Error('Supabase session is unavailable');
            const pending = await flushPendingRemoteDeletes(
              createSupabaseRemote(createSyncSupabaseClient(session.access_token)),
              identity.userId,
            );
            // 世代をローカルへ保存してから削除キューを確定する。保存失敗時は次回同期で再試行する。
            if (pending.resetGeneration !== undefined) {
              await getDb().setMeta(RESET_GENERATION_META_KEY, String(pending.resetGeneration));
              for (const table of ['projects', 'kanban_columns', 'tasks'] as TableName[]) {
                await getDb().setMeta(`cursor:${table}`, '0');
              }
            }
            // ローカルはすでに空なので、サーバー削除とキュー確定だけを行う。
            await pending.complete();
            remotePending = false;
          } catch {
            // 全件削除は端末側で完了済み。サーバー要求はキューに残し次の同期で再試行する。
            remotePending = true;
          }
        }
        // 手動／オフでは次に同期が許可されたときに、サーバー側の全件削除を行う。
        return { ok: true, count, ...(remotePending ? { remotePending: true } : {}) };
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
