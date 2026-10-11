import { useRef, type ReactNode } from 'react';
import { Keyboard, View, type ViewStyle } from 'react-native';
import type { IconKey } from '@/config/icons';
import { useMenuHost } from './MenuHost';

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

/**
 * 3点アイコンなどから開くドロップダウンメニュー。ボタンの「下」に表示する（下に入りきらないときだけ上）。
 * 表示は画面全体を覆う MenuHost が担当する。ボタンの位置は measure()（画面のルートからの位置）で測るので、
 * ステータスバーなどの分だけずれることがない。
 */
export function DropdownMenu({ items, trigger, anchorStyle }: Props) {
  const host = useMenuHost();
  const anchor = useRef<View>(null);

  const open = () => {
    Keyboard.dismiss();
    anchor.current?.measure((_x, _y, w, h, pageX, pageY) => host.show({ x: pageX, y: pageY, w, h }, items));
  };

  return (
    <View ref={anchor} collapsable={false} style={anchorStyle}>
      {trigger(open)}
    </View>
  );
}
