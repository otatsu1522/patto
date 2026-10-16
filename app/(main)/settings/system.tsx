import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { useAuthStore } from '@/auth/authStore';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { ChoiceRow, Section, SwitchRow } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { isSupabaseConfigured } from '@/config/env';
import type { CardDensity, SyncMode, ThemeMode } from '@/config/defaults';
import { BOARD, UI_METRICS, type FontScaleKey } from '@/config/layout';
import { exportProjects, importProjects } from '@/features/importExport';
import { UserActionError } from '@/domain/operationError';
import { clearBucket, previewClear, resetAllData } from '@/features/maintenance';
import { visibleProjects, archivedProjects } from '@/domain/selectors';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { SPACING, useTheme } from '@/theme';

/** システム設定: 外観 / システム / データ管理。 */
export default function SystemSettings() {
  const { confirm, toast, alert } = useFeedback();
  const { colors } = useTheme();
  const [syncRequested, setSyncRequested] = useState(false);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const identity = useAuthStore((s) => s.identity);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncStatus = useSyncStore((s) => s.status);
  const syncInProgress = syncStatus === 'syncing' || syncRequested;
  const syncAvailable = !!identity && !identity.local && isSupabaseConfigured;
  const scrollRef = useWebWheelScroll();

  const runManualSync = async () => {
    if (syncInProgress) return;
    // 状態ストアの更新を待たずにボタンを即時表示へ切り替える。
    setSyncRequested(true);
    try {
      await syncNow();
    } finally {
      setSyncRequested(false);
    }
  };

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
    } catch (error) {
      alert(
        t('common.error'),
        error instanceof UserActionError ? error.message : t('settings.importFailed'),
      );
    }
  };

  const clearAll = async (kind: 'trash' | 'archive') => {
    const count = previewClear(kind);
    if (count === 0) return toast(t('board.clearNothing'));
    const r = await confirm({
      title: kind === 'trash' ? t('settings.trashClearAll') : t('settings.archiveClearAll'),
      message: t(
        kind === 'trash' ? 'settings.trashClearAllMessage' : 'settings.archiveClearAllMessage',
        { count },
      ),
      confirmLabel: t('settings.clearPermanently'),
      destructive: true,
    });
    if (r !== 'confirm') return;
    const res = await clearBucket(kind);
    toast(res.ok ? t('board.clearDone', { count: res.count }) : res.message, undefined, {
      force: !res.ok,
    });
  };

  const reset = async () => {
    const result = await confirm({
      title: t('settings.resetAllTitle'),
      message: t('settings.resetAllMessage'),
      confirmLabel: t('settings.resetAllConfirm'),
      destructive: true,
    });
    if (result !== 'confirm') return;
    const res = await resetAllData();
    toast(res.ok ? t('settings.resetAllDone') : res.message, undefined, { force: !res.ok });
  };

  const category = (label: string) => (
    <AppText variant="title" style={styles.category}>
      {label}
    </AppText>
  );
  const hint = (value: string) => (
    <AppText variant="caption" muted style={styles.hint}>
      {value}
    </AppText>
  );

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.system')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          {category(t('settings.appearance'))}
          <Section title={t('settings.theme')}>
            {hint(t('settings.themeHint'))}
            <ChoiceRow<ThemeMode>
              value={settings.themeMode}
              onChange={(v) => update({ themeMode: v })}
              options={[
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'system', label: t('settings.theme.system') },
              ]}
            />
          </Section>
          <Section title={t('settings.fontSize')}>
            {hint(t('settings.fontSizeHint'))}
            <ChoiceRow<FontScaleKey>
              value={settings.fontScale}
              onChange={(v) => update({ fontScale: v })}
              options={[
                { value: 'tiny', label: t('settings.fontSize.tiny') },
                { value: 'small', label: t('settings.fontSize.small') },
                { value: 'normal', label: t('settings.fontSize.normal') },
                { value: 'large', label: t('settings.fontSize.large') },
                { value: 'xlarge', label: t('settings.fontSize.xlarge') },
              ]}
            />
          </Section>
          <Section title={t('settings.density')}>
            {hint(t('settings.densityHint'))}
            <ChoiceRow<CardDensity>
              value={settings.cardDensity}
              onChange={(v) => update({ cardDensity: v })}
              options={[
                { value: 'compact', label: t('settings.density.compact') },
                { value: 'normal', label: t('settings.density.normal') },
                { value: 'detailed', label: t('settings.density.detailed') },
              ]}
            />
            {hint(t('settings.cardFieldsHint'))}
            <SwitchRow
              label={t('settings.showDescription')}
              value={settings.showTaskDescription}
              onChange={(v) => update({ showTaskDescription: v })}
            />
            <SwitchRow
              label={t('settings.showDueDate')}
              value={settings.showTaskDueDate}
              onChange={(v) => update({ showTaskDueDate: v })}
            />
            <SwitchRow
              label={t('settings.showUpdatedAt')}
              value={settings.showTaskUpdatedAt}
              onChange={(v) => update({ showTaskUpdatedAt: v })}
            />
          </Section>

          {category(t('settings.systemCategory'))}
          <Section title={t('settings.notification')}>
            {hint(t('settings.notificationHint'))}
            <SwitchRow
              label={t('settings.toast')}
              value={settings.toastEnabled}
              onChange={(v) => update({ toastEnabled: v })}
            />
          </Section>
          <Section title={t('settings.syncSection')}>
            {hint(syncAvailable ? t('settings.syncHint') : t('settings.syncLocalOnly'))}
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
                <View style={styles.syncDescs}>
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
                <View style={styles.syncAction}>
                  <Button
                    label={syncInProgress ? t('sync.syncing') : t('settings.syncNow')}
                    variant="outline"
                    icon="upload"
                    loading={syncInProgress}
                    disabled={settings.syncMode === 'off' || syncInProgress}
                    textColor={syncInProgress ? colors.accent : undefined}
                    onPress={() => void runManualSync()}
                    fullWidth
                  />
                  <AppText variant="caption" muted style={styles.syncLast}>
                    {lastSyncedAt
                      ? `${t('settings.lastSync')} ${formatDateTime(lastSyncedAt)}`
                      : t('sync.never')}
                  </AppText>
                </View>
              </>
            ) : null}
          </Section>

          {category(t('settings.dataManagement'))}
          <Section title={t('settings.dataSection')}>
            {hint(t('settings.dataHint'))}
            <View style={styles.actionButtons}>
              <Button
                label={t('settings.import')}
                variant="outline"
                onPress={() => void doImport()}
                fullWidth
              />
              <Button
                label={t('settings.export')}
                variant="outline"
                onPress={() => void doExport()}
                fullWidth
              />
            </View>
          </Section>
          <Section title={t('settings.trashSection')}>
            {hint(t('settings.trashHint'))}
            <SwitchRow
              label={t('settings.trashAutoDelete')}
              hint={t('settings.trashRetentionDays', { days: settings.trashRetentionDays })}
              value={settings.trashAutoDelete}
              onChange={(v) => update({ trashAutoDelete: v })}
            />
            <View style={styles.actionButtons}>
              <Button
                label={t('settings.archiveClearAll')}
                variant="outlineDanger"
                onPress={() => void clearAll('archive')}
                fullWidth
              />
              <Button
                label={t('settings.trashClearAll')}
                variant="outlineDanger"
                onPress={() => void clearAll('trash')}
                fullWidth
              />
            </View>
          </Section>
          <Section title={t('settings.resetAll')}>
            {hint(t('settings.resetAllHint'))}
            <View style={styles.resetButton}>
              <Button
                label={t('settings.resetAll')}
                variant="danger"
                icon="trash"
                onPress={() => void reset()}
                fullWidth
              />
            </View>
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    touchAction: 'pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + UI_METRICS.dialog.settingsPanelExtraWidth,
    gap: SPACING.lg,
  },
  category: { marginTop: SPACING.md, paddingHorizontal: SPACING.sm },
  hint: { padding: SPACING.lg, paddingBottom: 0 },
  syncDescs: { gap: SPACING.xs, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  syncAction: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  syncLast: { textAlign: 'center' },
  actionButtons: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  resetButton: { padding: SPACING.lg, paddingTop: SPACING.sm },
});
