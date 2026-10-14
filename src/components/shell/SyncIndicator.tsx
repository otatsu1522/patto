import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import type { IconKey } from '@/config/icons';
import { t } from '@/i18n';
import { formatTime } from '@/lib/dates';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { useTheme } from '@/theme';
import { IconButton } from '../ui/IconButton';

/** 同期の状態を表す文言とアイコン。 */
export function useSyncLabel(): { icon: IconKey; label: string; color: string; enabled: boolean } {
  const { colors } = useTheme();
  const identity = useAuthStore((s) => s.identity);
  const syncMode = useSettingsStore((s) => s.settings.syncMode);
  const status = useSyncStore((s) => s.status);
  const last = useSyncStore((s) => s.lastSyncedAt);
  const pending = useDataStore(
    (s) => [...s.projects, ...s.columns, ...s.tasks].filter((r) => r.dirty).length,
  );

  if (!identity || identity.local || !isSupabaseConfigured) {
    return { icon: 'offline', label: t('sync.localOnly'), color: colors.textMuted, enabled: false };
  }
  if (syncMode === 'off')
    return { icon: 'offline', label: t('sync.off'), color: colors.textMuted, enabled: false };
  if (status === 'syncing')
    return { icon: 'sync', label: t('sync.syncing'), color: colors.accent, enabled: true };
  if (status === 'offline')
    return {
      icon: 'offline',
      label: pending
        ? `${t('sync.offline')} · ${t('sync.pending', { count: pending })}`
        : t('sync.offline'),
      color: colors.warning,
      enabled: true,
    };
  if (status === 'error')
    return { icon: 'error', label: t('sync.error'), color: colors.danger, enabled: true };
  if (pending > 0)
    return {
      icon: 'sync',
      label: t('sync.pending', { count: pending }),
      color: colors.warning,
      enabled: true,
    };
  return {
    icon: 'synced',
    label: last ? t('sync.syncedAt', { time: formatTime(last) }) : t('sync.synced'),
    color: colors.success,
    enabled: true,
  };
}

/** タイトルの横に出す同期状態のアイコン。押すと今すぐ同期する。 */
export function SyncIndicator() {
  const { icon, label, color, enabled } = useSyncLabel();
  return (
    <IconButton
      icon={icon}
      label={enabled ? `${t('sync.now')} (${label})` : label}
      color={color}
      size={20}
      box={36}
      onPress={enabled ? () => void syncNow() : undefined}
    />
  );
}
