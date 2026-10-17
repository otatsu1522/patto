import { useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Logo } from '@/components/ui/Logo';
import { LinkRow, Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import {
  APP_DISPLAY_COPYRIGHT,
  APP_LINKS,
  APP_NAME,
  APP_TECH,
  APP_VERSION,
  APP_WEB_URL,
} from '@/config/app';
import { BOARD, UI_METRICS } from '@/config/layout';
import { t, type StringKey } from '@/i18n';
import { BORDER_WIDTH, RADIUS, SPACING, useTheme } from '@/theme';

export default function AboutScreen() {
  const scrollRef = useWebWheelScroll({ touchAction: 'pan-x pan-y' });
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
              <Logo size={UI_METRICS.brand.aboutLogoSize} framed={false} />
              <AppText variant="headline">{APP_NAME}</AppText>
              <AppText muted>
                {t('about.version')} {APP_VERSION}
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
          <Section>
            {APP_TECH.map((tech) => (
              <LinkRow
                key={tech.name}
                label={tech.name}
                description={t(tech.descriptionKey as StringKey)}
                onPress={() => void Linking.openURL(tech.url)}
              />
            ))}
            <LinkRow
              label={APP_NAME}
              description={APP_WEB_URL}
              onPress={() => void Linking.openURL(APP_WEB_URL)}
            />
            <LinkRow
              label={t('about.mitLicense')}
              description={t('about.licenseDescription')}
              onPress={() => router.navigate('/settings/license')}
            />
            {links.map((l) => (
              <LinkRow key={l.label} label={l.label} onPress={() => void Linking.openURL(l.url)} />
            ))}
          </Section>
        </View>
        <AppText variant="caption" muted style={styles.copyright}>
          {APP_DISPLAY_COPYRIGHT}
        </AppText>
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
    gap: SPACING.xl,
  },
  copyright: { textAlign: 'center', paddingTop: SPACING.xl, paddingBottom: SPACING.sm },
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
