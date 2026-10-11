import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { t } from '@/i18n';
import { SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/** 設定画面などの上部バー（戻るボタン + タイトル）。 */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
      <IconButton icon="back" label={t('common.back')} onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/settings')))} />
      <AppText variant="title" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  title: { flex: 1, marginLeft: SPACING.xs },
});
