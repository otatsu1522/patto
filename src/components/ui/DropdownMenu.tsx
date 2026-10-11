import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
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
}

/** 3点アイコンなどから開くドロップダウンメニュー（ボタンの近くに表示する）。 */
export function DropdownMenu({ items, trigger }: Props) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const anchor = useRef<View>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const open = () => {
    anchor.current?.measureInWindow((x, y, w, h) => setRect({ x, y, w, h }));
  };
  const close = () => setRect(null);

  const width = BOARD.menuMinWidth + 40;
  const left = rect ? Math.max(SPACING.sm, Math.min(rect.x + rect.w - width, win.width - width - SPACING.sm)) : 0;
  const top = rect ? Math.min(rect.y + rect.h + 4, Math.max(SPACING.sm, win.height - items.length * 48 - 24)) : 0;

  return (
    <>
      <View ref={anchor} collapsable={false}>
        {trigger(open)}
      </View>
      <Modal visible={rect !== null} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('common.close')}>
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
                  <AppText color={item.destructive ? colors.danger : colors.text} style={styles.label}>
                    {item.label}
                  </AppText>
                </Pressable>
              </View>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menu: { position: 'absolute', borderRadius: RADIUS.md, borderWidth: 1, paddingVertical: SPACING.xs, overflow: 'hidden' },
  item: { minHeight: BOARD.touchTarget, flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg },
  label: { flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginVertical: SPACING.xs },
});
