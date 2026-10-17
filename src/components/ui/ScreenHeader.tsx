import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { t } from '@/i18n';
import { useLayoutMode } from '@/hooks/useLayout';
import { toggleSettingsMenu } from '@/hooks/settingsMenu';
import { useUiStore } from '@/store/uiStore';
import { BOARD, UI_METRICS } from '@/config/layout';
import { SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/** 設定画面などの上部バー（メニューまたは戻るボタン + タイトル）。 */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();
  const { colors, lineWidth, lineColor } = useTheme();
  const useMenuToggle = pathname.startsWith('/settings');
  const toggleMenu = () => {
    if (mode === 'expanded') useUiStore.getState().toggleSidebarCollapsed();
    else toggleSettingsMenu();
  };
  return (
    <View
      style={[
        styles.bar,
        {
          borderBottomColor: lineColor,
          borderBottomWidth: lineWidth,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <IconButton
        icon={useMenuToggle ? 'panelLeft' : 'back'}
        label={useMenuToggle ? t('menu.toggle') : t('common.back')}
        onPress={
          useMenuToggle
            ? toggleMenu
            : (onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/settings'))))
        }
      />
      <AppText variant="title" numberOfLines={UI_METRICS.text.singleLineMax} style={styles.title}>
        {title}
      </AppText>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    minHeight: BOARD.headerHeight,
  },
  title: { flex: 1, textAlign: 'center' },
  spacer: { width: BOARD.touchTarget },
});
