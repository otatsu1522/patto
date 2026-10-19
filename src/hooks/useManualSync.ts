import { useCallback } from 'react';
import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { useFeedback } from '@/components/ui/FeedbackProvider';

/** 手動同期。オフラインで実行できなかった場合は理由をダイアログで伝える。 */
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
    const synced = await syncNow();
    if (!synced && useSyncStore.getState().status === 'offline') {
      alert(t('sync.offline'), t('sync.offlineMessage'));
    }
  }, [alert]);
}
