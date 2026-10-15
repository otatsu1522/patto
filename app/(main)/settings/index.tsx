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
import { BOARD } from '@/config/layout';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

/** 設定のトップ: プロフィール編集 / システム設定 / ショートカット / アプリについて / ライセンス。 */
export default function SettingsIndex() {
  const scrollRef = useWebWheelScroll();
  const router = useRouter();
  const { confirm } = useFeedback();
  const identity = useAuthStore((s) => s.identity);
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
    if (result === 'confirm') await useAuthStore.getState().signOut();
  };

  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={t('settings.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
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
              {!isGuest && identity ? (
                <Button
                  label={t('settings.logout')}
                  variant="secondary"
                  icon="logout"
                  onPress={() => void logout()}
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
    touchAction: 'pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.lg },
  account: { padding: SPACING.lg, gap: SPACING.sm, alignItems: 'center' },
  accountText: { textAlign: 'center' },
  logoutButton: { marginTop: SPACING.md },
});
