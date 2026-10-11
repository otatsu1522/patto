import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import type { MenuItem } from './DropdownMenu';
import { Icon } from './Icon';

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
  if (!v) throw new Error('MenuProvider が見つかりません');
  return v;
};

const ITEM_HEIGHT = BOARD.touchTarget;
const ICON_SLOT = 18;

/**
 * ドロップダウンメニューを表示する層。アプリ全体の最上位に置き、ボタンの下にメニューを描く。
 * 項目のどれかにアイコン（チェックなど）があるときは、ない項目にも同じ幅の空きを作って文字の位置をそろえる。
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const [menu, setMenu] = useState<{ anchor: Rect; items: MenuItem[] } | null>(null);

  const hide = useCallback(() => setMenu(null), []);
  const show = useCallback((anchor: Rect, items: MenuItem[]) => setMenu({ anchor, items }), []);
  const host = useMemo(() => ({ show, hide }), [show, hide]);

  let position = { left: 0, top: 0 };
  const width = BOARD.menuMinWidth + 40;
  if (menu) {
    const height = menu.items.length * ITEM_HEIGHT + SPACING.sm;
    const below = menu.anchor.y + menu.anchor.h + 2;
    const above = menu.anchor.y - height - 2;
    const fitsBelow = below + height <= win.height - SPACING.sm;
    const top = fitsBelow || above < SPACING.sm ? Math.min(below, Math.max(SPACING.sm, win.height - height - SPACING.sm)) : above;
    const left = Math.max(SPACING.sm, Math.min(menu.anchor.x + menu.anchor.w - width, win.width - width - SPACING.sm));
    position = { left, top };
  }

  const hasIcons = menu?.items.some((i) => i.icon) ?? false;

  return (
    <Ctx.Provider value={host}>
      <View style={styles.root}>
        {children}
        {menu ? (
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={hide} accessibilityLabel={t('common.close')} />
            <View style={[styles.menu, SHADOW.float, { ...position, width, backgroundColor: colors.surface, borderColor: colors.border }]}>
              {menu.items.map((item, i) => (
                <View key={`${item.label}-${i}`}>
                  {item.separator ? <View style={[styles.sep, { backgroundColor: colors.divider }]} /> : null}
                  <Pressable
                    accessibilityRole="menuitem"
                    disabled={item.disabled}
                    onPress={() => {
                      hide();
                      item.onPress();
                    }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.item,
                      { backgroundColor: pressed || hovered ? colors.hover : 'transparent', opacity: item.disabled ? 0.4 : 1 },
                    ]}
                  >
                    {hasIcons ? (
                      <View style={styles.iconSlot}>{item.icon ? <Icon name={item.icon} size={ICON_SLOT} color={item.destructive ? colors.danger : colors.text} /> : null}</View>
                    ) : null}
                    <AppText color={item.destructive ? colors.danger : colors.text} numberOfLines={1} style={styles.label}>
                      {item.label}
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000 },
  menu: { position: 'absolute', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: SPACING.xs, overflow: 'hidden' },
  item: { height: ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg },
  iconSlot: { width: ICON_SLOT, alignItems: 'center' },
  label: { flex: 1 },
  sep: { height: 1, marginHorizontal: SPACING.sm },
});
