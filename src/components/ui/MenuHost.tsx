import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOARD, UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { RADIUS, SHADOW, SPACING, useTheme, LAYER, ICON_SIZE, OPACITY } from '@/theme';
import { AppText } from './AppText';
import type { MenuItem } from './DropdownMenu';
import { Icon } from './Icon';
import { canHover } from '@/lib/hover';
import { DIAGNOSTIC_MESSAGES } from '@/config/diagnostics';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Host {
  show: (anchor: Rect, items: MenuItem[]) => void;
  hide: () => void;
}

const Ctx = createContext<Host | null>(null);

export const useMenuHost = (): Host => {
  const v = useContext(Ctx);
  if (!v) throw new Error(DIAGNOSTIC_MESSAGES.menuProviderMissing);
  return v;
};

const ITEM_HEIGHT = BOARD.touchTarget;
const MENU_SEPARATOR_INSET = SPACING.sm;

/**
 * ドロップダウンメニューを表示する層。アプリ全体の最上位に置き、ボタンの下にメニューを描く。
 * 項目のどれかにアイコン（チェックなど）があるときは、ない項目にも同じ幅の空きを作って文字の位置をそろえる。
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const { colors, lineWidth, lineColor } = useTheme();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<{ anchor: Rect; items: MenuItem[] } | null>(null);

  const hide = useCallback(() => setMenu(null), []);
  const show = useCallback((anchor: Rect, items: MenuItem[]) => setMenu({ anchor, items }), []);
  const host = useMemo(() => ({ show, hide }), [show, hide]);

  const width = Math.min(
    BOARD.menuMinWidth + UI_METRICS.menu.popupWidthExtra,
    Math.max(0, win.width - SPACING.md * 2),
  );
  let menuLayout: {
    left: number;
    top: number;
    width: number;
    height: number;
  } = { left: SPACING.sm, top: SPACING.sm, width, height: 0 };
  if (menu) {
    const separatorCount = menu.items.filter((item) => item.separator).length;
    const desiredHeight =
      menu.items.length * ITEM_HEIGHT + separatorCount * lineWidth + SPACING.sm + lineWidth * 2;
    // Safe-area の内側にメニューを収め、Android の下部ナビゲーション領域や
    // ステータスバー領域にメニュー項目が重ならないようにする。
    const safeTop = Math.max(insets.top, 0) + SPACING.sm;
    const safeBottom = win.height - Math.max(insets.bottom, 0) - SPACING.sm;
    const safeHeight = Math.max(ITEM_HEIGHT + lineWidth * 2, safeBottom - safeTop);
    const height = Math.min(desiredHeight, safeHeight);
    const below = menu.anchor.y + menu.anchor.h + UI_METRICS.menu.anchorGap;
    const above = menu.anchor.y - height - UI_METRICS.menu.anchorGap;
    const availableBelow = Math.max(0, safeBottom - below);
    const availableAbove = Math.max(0, menu.anchor.y - safeTop - UI_METRICS.menu.anchorGap);

    // 基本はアンカーの下、入らなければ上。どちらも足りない場合は余白が広い側に置き、
    // SafeArea の内側へ収めてメニュー内部をスクロール可能にする。
    let top: number;
    if (desiredHeight <= availableBelow) {
      top = below;
    } else if (desiredHeight <= availableAbove) {
      top = menu.anchor.y - desiredHeight - UI_METRICS.menu.anchorGap;
    } else if (availableBelow >= availableAbove) {
      top = below;
    } else {
      top = above;
    }
    top = Math.max(safeTop, Math.min(top, safeBottom - height));

    const left = Math.max(
      SPACING.sm,
      Math.min(menu.anchor.x + menu.anchor.w - width, win.width - width - SPACING.sm),
    );
    menuLayout = { left, top, width, height };
  }

  const hasIcons = menu?.items.some((i) => i.icon) ?? false;

  return (
    <Ctx.Provider value={host}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        {children}
        {menu ? (
          <View style={styles.overlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={hide}
              accessibilityLabel={t('common.close')}
            />
            <View
              style={[
                styles.menu,
                SHADOW.float,
                {
                  ...menuLayout,
                  backgroundColor: colors.surface,
                  borderColor: lineColor,
                  borderWidth: lineWidth,
                },
              ]}
            >
              <ScrollView
                style={styles.menuScroll}
                contentContainerStyle={styles.menuItems}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {menu.items.map((item, i) => (
                  <View key={`${item.label}-${i}`}>
                    {item.separator ? (
                      <View
                        style={[styles.sep, { backgroundColor: lineColor, height: lineWidth }]}
                      />
                    ) : null}
                    <Pressable
                      accessibilityRole="menuitem"
                      disabled={item.disabled}
                      onPress={() => {
                        hide();
                        item.onPress();
                      }}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.item,
                        {
                          backgroundColor:
                            pressed || (hovered && canHover) ? colors.hover : 'transparent',
                          opacity: item.disabled ? OPACITY.disabled : OPACITY.fullyVisible,
                        },
                      ]}
                    >
                      {hasIcons ? (
                        <View style={styles.iconSlot}>
                          {item.icon ? (
                            <Icon
                              name={item.icon}
                              size={ICON_SIZE.lg}
                              color={
                                item.destructive
                                  ? colors.danger
                                  : item.mutedIcon
                                    ? colors.textMuted
                                    : colors.text
                              }
                            />
                          ) : null}
                        </View>
                      ) : null}
                      <AppText
                        color={
                          item.destructive
                            ? colors.danger
                            : item.mutedIcon
                              ? colors.textMuted
                              : colors.text
                        }
                        numberOfLines={UI_METRICS.text.singleLineMax}
                        style={styles.label}
                      >
                        {item.label}
                      </AppText>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: LAYER.systemBars },
  menu: {
    position: 'absolute',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  menuScroll: { flex: 1, minHeight: 0 },
  menuItems: { paddingVertical: SPACING.xs },
  item: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  iconSlot: { width: UI_METRICS.menu.iconSlotWidth, alignItems: 'center' },
  label: { flex: 1 },
  sep: {
    flexShrink: 0,
    marginHorizontal: MENU_SEPARATOR_INSET,
  },
});
