import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { BOARD } from '@/config/layout';
import { toggleBoardMenu } from '@/hooks/boardMenu';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { FONT, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Icon } from '../ui/Icon';
import { SyncIndicator } from '../shell/SyncIndicator';
import { BORDER_WIDTH } from '@/theme/tokens';

interface Props {
  title: string;
  /** 右端のボタン（横3点メニューなど） */
  right?: ReactNode;
  /** 検索中は、ヘッダー全体が検索フォームになる */
  search?: { value: string; onChange: (v: string) => void; onClose: () => void } | null;
  /** メニューアイコンを出すか（メニューが画面そのものになる画面では false） */
  menu?: boolean;
}

/** 画面上部のバー: 左にメニューアイコン、中央にタイトルと同期状態、右に横3点メニュー。 */
export function BoardHeader({ title, right, search, menu = true }: Props) {
  const { colors, fs } = useTheme();
  const { mode } = useLayoutMode();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const permanent = mode === 'expanded';
  const menuVisible = useUiStore((s) => s.menuVisible);
  const menuOpen = permanent ? !collapsed : menuVisible;
  const showMenu = menu;
  const input = useRef<TextInput>(null);

  const searching = !!search;
  useEffect(() => {
    if (searching) setTimeout(() => input.current?.focus(), 50);
  }, [searching]);

  return (
    <View
      style={[styles.bar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
    >
      <View style={styles.side}>
        {showMenu ? (
          <IconButton
            icon={menuOpen ? 'menuOpen' : 'menu'}
            label={menuOpen ? t('common.close') : t('menu.open')}
            onPress={() =>
              permanent ? useUiStore.getState().toggleSidebarCollapsed() : toggleBoardMenu()
            }
          />
        ) : null}
      </View>

      {search ? (
        <View style={styles.searchRow}>
          <Icon name="search" size={20} color={colors.textMuted} />
          <TextInput
            ref={input}
            autoFocus
            value={search.value}
            onChangeText={search.onChange}
            placeholder={t('board.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('board.search')}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.text, fontSize: fs(FONT.bodyLarge) }]}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <AppText variant="title" numberOfLines={1} style={styles.title}>
            {title}
          </AppText>
          <View style={styles.sync}>
            <SyncIndicator />
          </View>
        </View>
      )}

      <View style={styles.side}>
        {search ? (
          <IconButton icon="close" label={t('board.searchClose')} onPress={search.onClose} />
        ) : (
          right
        )}
      </View>
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
    borderBottomWidth: BORDER_WIDTH,
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
  sync: { paddingTop: 4 },
  searchRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  searchInput: {
    flex: 1,
    height: 48,
    backgroundColor: 'transparent',
    outlineStyle: 'none',
  } as never,
});
