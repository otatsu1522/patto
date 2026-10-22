import { useRouter } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { LinkRow, Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { t } from '@/i18n';
import { SPACING } from '@/theme';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { BOARD, UI_METRICS } from '@/config/layout';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { useProjectNavigation } from '@/hooks/useProjectNavigation';
import { visibleProjects } from '@/domain/selectors';

/** 設定のトップ: プロフィール編集 / システム設定 / ショートカット / アプリについて / ライセンス。 */
export default function SettingsIndex() {
  const scrollRef = useWebWheelScroll({ touchAction: 'pan-x pan-y' });
  const router = useRouter();
  const { confirm, alert } = useFeedback();
  const identity = useAuthStore((s) => s.identity);
  const projects = useDataStore((s) => s.projects);
  const lastProjectId = useSettingsStore((s) => s.settings.lastProjectId);
  const navigateToProject = useProjectNavigation();
  const returnToLastProject = () => {
    const target = visibleProjects(projects).find((project) => project.id === lastProjectId);
    if (target) navigateToProject(target.id);
    else router.replace({ pathname: '/home', params: { selection: 'empty' } });
  };
  const isGuest = identity?.mode === 'guest';
  const logout = async () => {
    if (!identity || isGuest) return;
    const s = useDataStore.getState();
    const pending = [...s.projects, ...s.columns, ...s.tasks].filter((r) => r.dirty).length;
    const result = await confirm({
      title: t('settings.logoutTitle'),
      message:
        pending > 0 ? t('settings.logoutPending', { count: pending }) : t('settings.logoutMessage'),
      confirmLabel: t('settings.logoutNow'),
      destructive: true,
    });
    if (result === 'confirm') {
      const exitResult = await useAuthStore.getState().signOut();
      if (!exitResult.ok) alert(t('common.error'), exitResult.message);
    }
  };
  const leaveGuest = async () => {
    if (!identity || !isGuest) return;
    const result = await confirm({
      title: t('settings.guestLeaveTitle'),
      message: t('settings.guestLeaveMessage'),
      confirmLabel: t('settings.guestLeaveConfirm'),
      destructive: true,
    });
    if (result === 'confirm') {
      const exitResult = await useAuthStore.getState().leaveGuest();
      if (!exitResult.ok) alert(t('common.error'), exitResult.message);
    }
  };

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.title')} onBack={returnToLastProject} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <Section>
            <View style={styles.account}>
              <AppText variant="headline" bold style={styles.accountText}>
                {isGuest ? t('settings.guestTitle') : identity?.displayName || identity?.email}
              </AppText>
              <AppText variant="body" muted style={styles.accountText}>
                {isGuest ? t('settings.guestDescription') : identity?.email}
              </AppText>
              {identity ? (
                <Button
                  label={isGuest ? t('settings.backToLogin') : t('settings.logout')}
                  variant={isGuest ? 'outlineDanger' : 'outline'}
                  icon="logout"
                  onPress={() => void (isGuest ? leaveGuest() : logout())}
                  fullWidth
                  style={styles.logoutButton}
                />
              ) : null}
            </View>
          </Section>
          <Section>
            <LinkRow
              icon="person"
              label={t('settings.profile')}
              onPress={() => router.navigate('/settings/profile')}
            />
            <LinkRow
              icon="settings"
              label={t('settings.system')}
              onPress={() => router.navigate('/settings/system')}
            />
            {Platform.OS === 'web' ? (
              <LinkRow
                icon="keyboard"
                label={t('settings.shortcuts')}
                onPress={() => router.navigate('/settings/shortcuts')}
              />
            ) : null}
            <LinkRow
              icon="help"
              label={t('settings.qa')}
              onPress={() => router.navigate('/settings/qa')}
            />
            <LinkRow
              icon="info"
              label={t('settings.about')}
              onPress={() => router.navigate('/settings/about')}
            />
            <LinkRow
              icon="document"
              label={t('settings.license')}
              onPress={() => router.navigate('/settings/license')}
            />
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    touchAction: 'pan-x pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + UI_METRICS.dialog.settingsPanelExtraWidth,
    gap: SPACING.lg,
  },
  account: { padding: SPACING.lg, gap: SPACING.sm, alignItems: 'center' },
  accountText: { textAlign: 'center' },
  logoutButton: { marginTop: SPACING.md },
});
