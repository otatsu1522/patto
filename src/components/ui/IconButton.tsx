import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { BOARD } from '@/config/layout';
import type { IconKey } from '@/config/icons';
import { RADIUS, useTheme } from '@/theme';
import { Icon } from './Icon';

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
}

/** アイコンだけのボタン。アクセシビリティのため label を必須にしている。 */
export const IconButton = ({ icon, label, onPress, size = 22, color, disabled, style, box = BOARD.touchTarget }: Props) => {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        { width: box, height: box, backgroundColor: pressed || hovered ? colors.hover : 'transparent', opacity: disabled ? 0.4 : 1 },
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
