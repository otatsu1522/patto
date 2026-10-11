import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_NAME } from '@/config/app';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Logo } from '../ui/Logo';

/** ログイン・登録系の画面の共通枠（上にアプリ名、その下にフォーム）。 */
export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo size={72} />
            <AppText variant="headline">{APP_NAME}</AppText>
            {subtitle ? (
              <AppText muted style={styles.center}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <View style={[styles.card, SHADOW.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg, gap: SPACING.xl },
  brand: { alignItems: 'center', gap: SPACING.sm },
  center: { textAlign: 'center' },
  card: { width: '100%', maxWidth: 420, borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.xl, gap: SPACING.md },
});
