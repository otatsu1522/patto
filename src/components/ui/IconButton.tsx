import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { BOARD } from '@/config/layout';
import type { IconKey } from '@/config/icons';
import { useTheme, HIT_SLOP, ICON_SIZE, OPACITY } from '@/theme';
import { Icon } from './Icon';
import { canHover } from '@/lib/hover';

interface Props {
  icon: IconKey;
  label: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: ViewStyle;
  /** タップ領域の大きさ。既定は最小タップサイズ */
  box?: number;
  /** ホバー・押下時の背景色（背景が反転している行の上など、既定の色が合わないとき） */
  hoverColor?: string;
}

/** アイコンだけのボタン。アクセシビリティのため label を必須にしている。 */
export const IconButton = ({
  icon,
  label,
  onPress,
  size = ICON_SIZE.xxl,
  color,
  disabled,
  style,
  box = BOARD.touchTarget,
  hoverColor,
}: Props) => {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={HIT_SLOP.iconButton}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        {
          width: box,
          height: box,
          backgroundColor:
            pressed || (hovered && canHover) ? (hoverColor ?? colors.hover) : 'transparent',
          opacity: disabled ? OPACITY.disabled : OPACITY.fullyVisible,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
