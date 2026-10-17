import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BOARD, UI_METRICS } from '@/config/layout';
import { toggleBoardMenu } from '@/hooks/boardMenu';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { SyncIndicator } from '../shell/SyncIndicator';

interface Props {
  title: string;
  /** 右端のボタン（横3点メニューなど） */
  right?: ReactNode;
  /** メニューアイコンを出すか（メニューが画面そのものになる画面では false） */
  menu?: boolean;
}

/** 画面上部のバー: 左にメニューアイコン、中央にタイトルと同期状態、右に横3点メニュー。 */
export function BoardHeader({ title, right, menu = true }: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  const { mode } = useLayoutMode();
  const permanent = mode === 'expanded';
  const showMenu = menu;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderBottomColor: lineColor,
          borderBottomWidth: lineWidth,
        },
      ]}
    >
      <View style={styles.side}>
        {showMenu ? (
          <IconButton
            icon="panelLeft"
            label={t('menu.toggle')}
            onPress={() =>
              permanent ? useUiStore.getState().toggleSidebarCollapsed() : toggleBoardMenu()
            }
          />
        ) : null}
      </View>

      <View style={styles.center}>
        <AppText variant="title" numberOfLines={UI_METRICS.text.singleLineMax} style={styles.title}>
          {title}
        </AppText>
        <View style={styles.sync}>
          <SyncIndicator />
        </View>
      </View>

      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BOARD.headerHeight,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  side: { width: BOARD.touchTarget, alignItems: 'center', justifyContent: 'center' },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    minWidth: 0,
  },
  title: { flexShrink: 1, textAlign: 'center' },
  sync: { paddingTop: SPACING.xs },
});
