import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import type { IconKey } from '@/config/icons';
import { t } from '@/i18n';
import { formatTime } from '@/lib/dates';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useManualSync } from '@/hooks/useManualSync';
import { useSyncStore } from '@/sync/status';
import { useTheme, ICON_SIZE, ICON_BUTTON_BOX } from '@/theme';
import { IconButton } from '../ui/IconButton';

/** 同期の状態を表す文言とアイコン。 */
export function useSyncLabel(): {
  icon: IconKey;
  label: string;
  pendingLabel?: string;
  color: string;
  enabled: boolean;
} {
  const { colors } = useTheme();
  const normalColor = colors.text;
  const identity = useAuthStore((s) => s.identity);
  const syncMode = useSettingsStore((s) => s.settings.syncMode);
  const status = useSyncStore((s) => s.status);
  const manualRequestCount = useSyncStore((s) => s.manualRequestCount);
  const last = useSyncStore((s) => s.lastSyncedAt);
  const pending = useDataStore(
    (s) => [...s.projects, ...s.columns, ...s.tasks].filter((r) => r.dirty).length,
  );

  if (!identity || identity.local || !isSupabaseConfigured) {
    return { icon: 'offline', label: t('sync.localOnly'), color: normalColor, enabled: false };
  }
  if (syncMode === 'off')
    return { icon: 'offline', label: t('sync.off'), color: normalColor, enabled: false };
  if (manualRequestCount > 0)
    return { icon: 'sync', label: t('sync.syncing'), color: colors.accent, enabled: true };
  // 自動同期中は進行中アイコン・アクセント色へ切り替えず、最終同期時刻や未送信件数を表示する。
  const displayStatus = status === 'syncing' ? 'idle' : status;
  if (displayStatus === 'offline')
    return {
      icon: 'offline',
      label: pending
        ? `${t('sync.offline')} · ${t('sync.pending', { count: pending })}`
        : t('sync.offline'),
      color: normalColor,
      enabled: true,
    };
  if (displayStatus === 'error')
    return { icon: 'error', label: t('sync.error'), color: normalColor, enabled: true };
  // オンライン時のアイコンは操作ボタンとして固定する。未送信件数は文字で示し、
  // 自動同期によって pending が変化してもアイコン形状・色は変えない。
  return {
    icon: 'sync',
    label: last
      ? t('sync.syncedAt', { time: formatTime(last) })
      : pending > 0
        ? t('sync.never')
        : t('sync.synced'),
    pendingLabel: pending > 0 ? t('sync.pending', { count: pending }) : undefined,
    color: normalColor,
    enabled: true,
  };
}

/** タイトルの横に出す同期状態のアイコン。押すと今すぐ同期する。 */
export function SyncIndicator() {
  const { icon, label, pendingLabel, color, enabled } = useSyncLabel();
  const syncManually = useManualSync();
  return (
    <IconButton
      icon={icon}
      label={
        enabled ? `${t('sync.now')} (${label}${pendingLabel ? ` (${pendingLabel})` : ''})` : label
      }
      color={color}
      size={ICON_SIZE.xl}
      box={ICON_BUTTON_BOX.medium}
      onPress={enabled ? () => void syncManually() : undefined}
    />
  );
}
