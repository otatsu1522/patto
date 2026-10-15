import { useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Logo } from '@/components/ui/Logo';
import { LinkRow, Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import {
  APP_DISPLAY_COPYRIGHT,
  APP_LICENSE,
  APP_LINKS,
  APP_NAME,
  APP_TECH,
  APP_VERSION,
} from '@/config/app';
import { BOARD } from '@/config/layout';
import { t, type StringKey } from '@/i18n';
import { BORDER_WIDTH, RADIUS, SPACING, useTheme } from '@/theme';

export default function AboutScreen() {
  const scrollRef = useWebWheelScroll();
  const router = useRouter();
  const { colors } = useTheme();
  const links = [
    { label: t('about.terms'), url: APP_LINKS.terms },
    { label: t('about.privacy'), url: APP_LINKS.privacy },
    { label: t('about.contact'), url: APP_LINKS.contact },
  ].filter((l) => l.url);

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.about')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <View
            style={[
              styles.introCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.brand}>
              <Logo size={80} />
              <AppText variant="headline">{APP_NAME}</AppText>
              <AppText muted>
                {t('about.version')} {APP_VERSION}
              </AppText>
              <AppText variant="caption" muted>
                {APP_DISPLAY_COPYRIGHT}
              </AppText>
            </View>
            <View style={styles.body}>
              {(
                [
                  'about.body1',
                  'about.body2',
                  'about.body3',
                  'about.body4',
                  'about.body5',
                ] as StringKey[]
              ).map((key) => (
                <AppText key={key}>{t(key)}</AppText>
              ))}
            </View>
          </View>
          <Section title={t('about.tech')}>
            {APP_TECH.map((tech) => (
              <LinkRow
                key={tech.name}
                label={tech.name}
                value=""
                description={t(tech.descriptionKey as StringKey)}
                onPress={() => void Linking.openURL(tech.url)}
              />
            ))}
          </Section>
          <Section>
            <LinkRow
              label={t('about.license')}
              value={APP_LICENSE}
              onPress={() => router.navigate('/settings/license')}
            />
            {links.map((l) => (
              <LinkRow key={l.label} label={l.label} onPress={() => void Linking.openURL(l.url)} />
            ))}
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
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.xl },
  introCard: {
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.xl,
  },
  brand: { alignItems: 'center', gap: SPACING.sm },
  center: { textAlign: 'center' },
  body: { gap: SPACING.md },
});
