import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { ChoiceRow, LinkRow, Section, SwitchRow } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { AppText } from '@/components/ui/AppText';
import { isSupabaseConfigured } from '@/config/env';
import type { CardDensity, SyncMode, ThemeMode } from '@/config/defaults';
import { BOARD, type FontScaleKey } from '@/config/layout';
import { exportProjects, importProjects } from '@/features/importExport';
import { clearBucket, previewClear } from '@/features/maintenance';
import { visibleProjects, archivedProjects } from '@/domain/selectors';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { SPACING } from '@/theme';

/** システム設定: 外観 / 同期 / ごみ箱 / インポート・エクスポート。 */
export default function SystemSettings() {
  const { confirm, toast } = useFeedback();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const identity = useAuthStore((s) => s.identity);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncAvailable = !!identity && !identity.local && isSupabaseConfigured;

  const doExport = async () => {
    const answer = await confirm({
      title: t('settings.exportConfirmTitle'),
      message: t('settings.exportConfirmMessage'),
      confirmLabel: t('settings.exportConfirm'),
    });
    if (answer !== 'confirm') return;
    const s = useDataStore.getState();
    const ids = [...visibleProjects(s.projects), ...archivedProjects(s.projects)].map((p) => p.id);
    if (ids.length === 0) return toast(t('settings.exportEmpty'));
    await exportProjects(ids);
    toast(t('settings.exportDone'));
  };

  const doImport = async () => {
    try {
      const count = await importProjects();
      if (count !== null) toast(t('settings.importDone', { count }));
    } catch {
      toast(t('settings.importFailed'), undefined, { force: true });
    }
  };

  const clearAll = async (kind: 'trash' | 'archive') => {
    const count = previewClear(kind);
    if (count === 0) return toast(t('board.clearNothing'));
    const r = await confirm({
      title: kind === 'trash' ? t('settings.trashClearAll') : t('settings.archiveClearAll'),
      message: t('settings.clearAllMessage', { count }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (r !== 'confirm') return;
    const res = await clearBucket(kind);
    toast(res.ok ? t('board.clearDone', { count: res.count }) : res.message, undefined, {
      force: !res.ok,
    });
  };

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.system')} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <Section title={t('settings.appearance')} description={t('settings.appearanceHint')}>
            <ChoiceRow<ThemeMode>
              label={t('settings.theme')}
              value={settings.themeMode}
              onChange={(v) => update({ themeMode: v })}
              options={[
                { value: 'system', label: t('settings.theme.system') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
              ]}
            />
            <ChoiceRow<FontScaleKey>
              label={t('settings.fontSize')}
              value={settings.fontScale}
              onChange={(v) => update({ fontScale: v })}
              options={[
                { value: 'small', label: t('settings.fontSize.small') },
                { value: 'normal', label: t('settings.fontSize.normal') },
                { value: 'large', label: t('settings.fontSize.large') },
                { value: 'xlarge', label: t('settings.fontSize.xlarge') },
              ]}
            />
            <ChoiceRow<CardDensity>
              label={t('settings.density')}
              value={settings.cardDensity}
              onChange={(v) => update({ cardDensity: v })}
              options={[
                { value: 'normal', label: t('settings.density.normal') },
                { value: 'compact', label: t('settings.density.compact') },
              ]}
            />
          </Section>

          <Section
            title={t('settings.syncSection')}
            description={syncAvailable ? undefined : t('settings.syncHint')}
          >
            {syncAvailable ? (
              <>
                <ChoiceRow<SyncMode>
                  label={t('settings.syncMode')}
                  value={settings.syncMode}
                  onChange={(v) => update({ syncMode: v })}
                  options={[
                    { value: 'off', label: t('settings.syncMode.off') },
                    { value: 'manual', label: t('settings.syncMode.manual') },
                    { value: 'auto', label: t('settings.syncMode.auto') },
                  ]}
                />
                <LinkRow
                  icon="sync"
                  label={t('settings.syncNow')}
                  value={
                    lastSyncedAt
                      ? `${t('settings.lastSync')} ${formatDateTime(lastSyncedAt)}`
                      : t('sync.never')
                  }
                  chevron={false}
                  disabled={settings.syncMode === 'off'}
                  onPress={() => void syncNow()}
                />
              </>
            ) : (
              <View style={styles.note}>
                <AppText muted>{t('settings.syncLocalOnly')}</AppText>
              </View>
            )}
          </Section>

          {syncAvailable ? (
            <View style={styles.syncDescs}>
              <AppText variant="caption" muted>
                {t('settings.syncHint')}
              </AppText>
              <AppText variant="caption" muted>
                {t('settings.syncModeOffDesc')}
              </AppText>
              <AppText variant="caption" muted>
                {t('settings.syncModeManualDesc')}
              </AppText>
              <AppText variant="caption" muted>
                {t('settings.syncModeAutoDesc')}
              </AppText>
            </View>
          ) : null}

          <Section title={t('settings.toastSection')} description={t('settings.toastHint')}>
            <SwitchRow
              label={t('settings.toast')}
              value={settings.toastEnabled}
              onChange={(v) => update({ toastEnabled: v })}
            />
          </Section>

          <Section title={t('settings.trashSection')} description={t('settings.trashHint')}>
            <SwitchRow
              label={t('settings.trashAutoDelete')}
              hint={t('settings.trashRetentionDays', { days: settings.trashRetentionDays })}
              value={settings.trashAutoDelete}
              onChange={(v) => update({ trashAutoDelete: v })}
            />
            <LinkRow
              icon="trash"
              label={t('settings.trashClearAll')}
              destructive
              chevron={false}
              onPress={() => void clearAll('trash')}
            />
            <LinkRow
              icon="archive"
              label={t('settings.archiveClearAll')}
              destructive
              chevron={false}
              onPress={() => void clearAll('archive')}
            />
          </Section>

          <Section title={t('settings.dataSection')} description={t('settings.dataHint')}>
            <LinkRow icon="download" label={t('settings.export')} onPress={() => void doExport()} />
            <LinkRow icon="upload" label={t('settings.import')} onPress={() => void doImport()} />
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: SPACING.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.lg },
  note: { padding: SPACING.lg },
  syncDescs: { gap: SPACING.xs, marginTop: -SPACING.sm, paddingHorizontal: SPACING.sm },
});
