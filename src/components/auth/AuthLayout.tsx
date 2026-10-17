import { useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_NAME } from '@/config/app';
import { UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Logo } from '../ui/Logo';
import { AuthInputFocusProvider, useInputFocusScroller } from './AuthInputFocusContext';

/** ログイン・登録系の画面の共通枠（上にアプリ名、その下にフォーム）。 */
export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  const { colors, lineWidth, lineColor } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const { revealFocusedInput, onScroll } = useInputFocusScroller(scrollRef);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
        }
        style={styles.root}
      >
        <AuthInputFocusProvider value={revealFocusedInput}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={TIMING.scrollEventThrottleMs}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            <View style={styles.brand}>
              <Logo size={UI_METRICS.brand.authLogoSize} />
              <AppText variant="headline">{APP_NAME}</AppText>
              {subtitle ? (
                <AppText muted style={styles.center}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <View
              style={[
                styles.card,
                SHADOW.card,
                { backgroundColor: colors.surface, borderColor: lineColor, borderWidth: lineWidth },
              ]}
            >
              {children}
            </View>
          </ScrollView>
        </AuthInputFocusProvider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    gap: SPACING.xl,
  },
  brand: { alignItems: 'center', gap: SPACING.sm },
  center: { textAlign: 'center' },
  card: {
    width: '100%',
    maxWidth: UI_METRICS.dialog.contentMaxWidth,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
});
