import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { BOARD, UI_METRICS } from '@/config/layout';
import { APP_QA } from '@/config/qa';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme } from '@/theme';

/** アプリの質問と回答。複数のアコーディオンを同時には開かない。 */
export default function QaScreen() {
  const { colors, lineWidth, lineColor } = useTheme();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const scrollRef = useWebWheelScroll({ touchAction: 'pan-x pan-y' });

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('settings.qa')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <AppText muted>{t('settings.qaHint')}</AppText>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: lineColor, borderWidth: lineWidth },
            ]}
          >
            {APP_QA.map((item, index) => {
              const isOpen = openIndex === index;
              return (
                <View key={item.question}>
                  {index > 0 ? (
                    <View style={{ height: lineWidth, backgroundColor: lineColor }} />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    onPress={() => setOpenIndex(isOpen ? null : index)}
                    style={({ pressed }) => [
                      styles.question,
                      { backgroundColor: pressed ? colors.hover : colors.surface },
                    ]}
                  >
                    <AppText bold style={styles.questionText}>
                      {t('settings.qaQuestionPrefix', { number: index + 1 })} {item.question}
                    </AppText>
                    <Icon name={isOpen ? 'up' : 'down'} color={colors.textMuted} />
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.answer}>
                      <AppText>
                        <AppText bold>{t('settings.qaAnswerPrefix')} </AppText>
                        {item.answer}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
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
    touchAction: 'pan-x pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + UI_METRICS.dialog.settingsPanelExtraWidth,
    gap: SPACING.md,
  },
  card: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden' },
  question: {
    minHeight: BOARD.touchTarget,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  questionText: { flex: 1 },
  answer: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
});
