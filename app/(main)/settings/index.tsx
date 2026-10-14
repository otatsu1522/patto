import { useRouter } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { AppText } from '@/components/ui/AppText';
import { LinkRow, Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { t } from '@/i18n';
import { SPACING } from '@/theme';
import { BOARD } from '@/config/layout';

/** 設定のトップ: プロフィール編集 / システム設定 / ショートカット / アプリについて / ライセンス。 */
export default function SettingsIndex() {
  const router = useRouter();
  const identity = useAuthStore((s) => s.identity);
  const isGuest = identity?.mode === 'guest';

  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={t('settings.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <Section>
            <View style={styles.account}>
              <AppText bold>
                {isGuest ? t('settings.guestTitle') : identity?.displayName || identity?.email}
              </AppText>
              <AppText variant="caption" muted>
                {isGuest ? t('settings.guestDescription') : identity?.email}
              </AppText>
            </View>
          </Section>
          <Section>
            <LinkRow
              icon="person"
              label={t('settings.profile')}
              onPress={() => router.push('/settings/profile')}
            />
            <LinkRow
              icon="settings"
              label={t('settings.system')}
              onPress={() => router.push('/settings/system')}
            />
            {Platform.OS === 'web' ? (
              <LinkRow
                icon="keyboard"
                label={t('settings.shortcuts')}
                onPress={() => router.push('/settings/shortcuts')}
              />
            ) : null}
            <LinkRow
              icon="info"
              label={t('settings.about')}
              onPress={() => router.push('/settings/about')}
            />
            <LinkRow
              icon="document"
              label={t('settings.license')}
              onPress={() => router.push('/settings/license')}
            />
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
  account: { padding: SPACING.lg, gap: 2 },
});
