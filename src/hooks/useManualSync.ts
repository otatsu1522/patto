import { useCallback } from 'react';
import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { useFeedback } from '@/components/ui/FeedbackProvider';

/** 明示的な同期操作。進行中の表示は利用者の要求にだけ反応させ、自動同期とは分離する。 */
export function useManualSync(): () => Promise<void> {
  const { alert } = useFeedback();

  return useCallback(async () => {
    const identity = useAuthStore.getState().identity;
    if (
      !identity ||
      identity.local ||
      !isSupabaseConfigured ||
      useSettingsStore.getState().settings.syncMode === 'off'
    ) {
      return;
    }

    // オフ／手動モードでは、再認証要求が保存済みでも明示的な同期操作まではダイアログを出さない。
    // 同期ボタン操作中に認証エラーが判明した場合だけ、再認証ダイアログを表示できるようにする。
    const auth = useAuthStore.getState();
    if (identity.mode === 'account' && !identity.local) {
      if (useSettingsStore.getState().settings.syncMode !== 'auto') {
        // オフ／手動では、以前保存された要求だけで通信前にダイアログを出さない。
        // 今回の操作が認証エラーになった場合は、同期コントローラーが再要求を記録する。
        auth.setNeedsReauth(false);
      }
      auth.setReauthPromptRequested(true);
    }
    const statusBefore = useSyncStore.getState();
    statusBefore.set({ manualRequestCount: statusBefore.manualRequestCount + 1 });
    try {
      const synced = await syncNow();
      if (synced) return;

      const current = useSyncStore.getState();
      if (current.status === 'offline') {
        alert(t('sync.offline'), t('sync.offlineMessage'));
      } else if (current.status === 'error' && current.error) {
        alert(t('sync.error'), current.error);
      }
    } finally {
      const currentStatus = useSyncStore.getState();
      currentStatus.set({ manualRequestCount: Math.max(0, currentStatus.manualRequestCount - 1) });
      const latest = useAuthStore.getState();
      if (!latest.needsReauth) latest.setReauthPromptRequested(false);
    }
  }, [alert]);
}
