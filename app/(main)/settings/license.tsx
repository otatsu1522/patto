import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LICENSE_BODY, LICENSE_TRANSLATION_NOTE } from '@/config/license';
import { APP_DISPLAY_COPYRIGHT } from '@/config/app';
import { BOARD, UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme, OPACITY } from '@/theme';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

export default function LicenseScreen() {
  const scrollRef = useWebWheelScroll({ touchAction: 'pan-x pan-y' });
  const { colors, lineWidth, lineColor } = useTheme();

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.license')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: lineColor, borderWidth: lineWidth },
          ]}
        >
          <AppText variant="headline">{t('about.mitLicense')}</AppText>
          <AppText variant="caption" muted style={styles.copyright}>
            {APP_DISPLAY_COPYRIGHT}
          </AppText>
          <View style={[styles.divider, { backgroundColor: lineColor, height: lineWidth }]} />
          <AppText variant="caption" muted>
            {LICENSE_TRANSLATION_NOTE}
          </AppText>
          <AppText variant="caption" style={styles.body}>
            {LICENSE_BODY}
          </AppText>
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
  card: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + UI_METRICS.dialog.settingsPanelExtraWidth,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  copyright: { opacity: OPACITY.copyright },
  divider: { alignSelf: 'stretch', marginVertical: SPACING.xs },
  body: { lineHeight: UI_METRICS.license.bodyLineHeight },
});
