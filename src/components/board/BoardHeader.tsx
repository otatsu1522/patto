import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { SyncIndicator } from '../shell/SyncIndicator';

interface Props {
  title: string;
  /** タイトルの右側（検索・メニューなど） */
  right?: ReactNode;
}

/** 画面上部のバー: 左にメニューアイコン、中央にプロジェクト名、右に操作ボタンと同期状態。 */
export function BoardHeader({ title, right }: Props) {
  const { colors } = useTheme();
  const { mode } = useLayoutMode();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const permanent = mode === 'expanded';
  const showMenu = !permanent || collapsed;

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {showMenu ? (
        <IconButton
          icon="menu"
          label={t('menu.open')}
          onPress={() => (permanent ? useUiStore.getState().toggleSidebarCollapsed() : useUiStore.getState().setSidebarOpen(true))}
        />
      ) : null}
      <AppText variant="title" numberOfLines={1} style={[styles.title, !showMenu && styles.titleFlush]}>
        {title}
      </AppText>
      {right}
      <SyncIndicator showLabel={permanent} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: SPACING.sm, gap: SPACING.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, marginLeft: SPACING.xs },
  titleFlush: { marginLeft: SPACING.md },
});
