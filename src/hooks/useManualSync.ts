import { useCallback } from 'react';
import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { useFeedback } from '@/components/ui/FeedbackProvider';

/** 手動同期。オフライン／同期エラーの理由を利用者に伝える。 */
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
    if (synced) return;

    const current = useSyncStore.getState();
    if (current.status === 'offline') {
      alert(t('sync.offline'), t('sync.offlineMessage'));
    } else if (current.status === 'error' && current.error) {
      alert(t('sync.error'), current.error);
    }
  }, [alert]);
}
