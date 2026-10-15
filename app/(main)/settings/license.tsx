import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LICENSE_BODY } from '@/config/license';
import { APP_COPYRIGHT } from '@/config/app';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { BORDER_WIDTH, RADIUS, SPACING, useTheme } from '@/theme';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

export default function LicenseScreen() {
  const scrollRef = useWebWheelScroll();
  const { colors } = useTheme();

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.license')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <AppText variant="headline">MIT License</AppText>
          <AppText variant="caption" muted style={styles.copyright}>
            {APP_COPYRIGHT}
          </AppText>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
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
    touchAction: 'pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  card: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + 120,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  copyright: { opacity: 0.78 },
  divider: { height: BORDER_WIDTH, alignSelf: 'stretch', marginVertical: SPACING.xs },
  body: { lineHeight: 19 },
});
