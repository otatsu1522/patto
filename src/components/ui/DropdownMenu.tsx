import { useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { BOARD } from '@/config/layout';
import type { IconKey } from '@/config/icons';
import { t } from '@/i18n';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  onPress: () => void;
  icon?: IconKey;
  destructive?: boolean;
  disabled?: boolean;
  /** この項目の上に区切り線を入れる */
  separator?: boolean;
}

interface Props {
  items: MenuItem[];
  /** メニューを開くボタン。open() を呼ぶと表示される */
  trigger: (open: () => void) => ReactNode;
  /** ボタンを包む領域のスタイル（カード全体に広げたいときなど） */
  anchorStyle?: ViewStyle;
}

const ITEM_HEIGHT = BOARD.touchTarget;

/**
 * 3点アイコンなどから開くドロップダウンメニュー。ボタンの「下」に表示する（下に入りきらないときだけ上）。
 * Modal の座標系と画面の座標系にずれがあっても位置が狂わないよう、Modal 内の基準点を測って補正する。
 */
export function DropdownMenu({ items, trigger, anchorStyle }: Props) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const anchor = useRef<View>(null);
  const backdrop = useRef<View>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  const open = () => {
    Keyboard.dismiss();
    anchor.current?.measureInWindow((x, y, w, h) => setRect({ x, y, w, h }));
  };
  const close = () => setRect(null);
  const measureOrigin = () => backdrop.current?.measureInWindow((x, y) => setOrigin({ x, y }));

  const width = BOARD.menuMinWidth + 40;
  const height = items.length * ITEM_HEIGHT + SPACING.sm;
  let left = 0;
  let top = 0;
  if (rect) {
    const below = rect.y + rect.h + 2;
    const above = rect.y - height - 2;
    const fitsBelow = below + height <= win.height - SPACING.sm;
    top = fitsBelow || above < SPACING.sm ? Math.min(below, win.height - height - SPACING.sm) : above;
    left = Math.max(SPACING.sm, Math.min(rect.x + rect.w - width, win.width - width - SPACING.sm));
    top -= origin.y;
    left -= origin.x;
  }

  return (
    <>
      <View ref={anchor} collapsable={false} style={anchorStyle}>
        {trigger(open)}
      </View>
      <Modal visible={rect !== null} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <View ref={backdrop} collapsable={false} style={StyleSheet.absoluteFill} onLayout={measureOrigin}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')} />
          <View style={[styles.menu, SHADOW.float, { left, top, width, backgroundColor: colors.surface, borderColor: colors.border }]}>
            {items.map((item, i) => (
              <View key={`${item.label}-${i}`}>
                {item.separator ? <View style={[styles.sep, { backgroundColor: colors.border }]} /> : null}
                <Pressable
                  accessibilityRole="menuitem"
                  disabled={item.disabled}
                  onPress={() => {
                    close();
                    item.onPress();
                  }}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.item,
                    { backgroundColor: pressed || hovered ? colors.column : 'transparent', opacity: item.disabled ? 0.4 : 1 },
                  ]}
                >
                  {item.icon ? <Icon name={item.icon} size={18} color={item.destructive ? colors.danger : colors.text} /> : null}
                  <AppText color={item.destructive ? colors.danger : colors.text} numberOfLines={1} style={styles.label}>
                    {item.label}
                  </AppText>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menu: { position: 'absolute', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: SPACING.xs, overflow: 'hidden' },
  item: { height: ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg },
  label: { flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: 0 },
});
