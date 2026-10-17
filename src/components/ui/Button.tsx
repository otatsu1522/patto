import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { BOARD } from '@/config/layout';
import type { IconKey } from '@/config/icons';
import { RADIUS, SPACING, useTheme, ICON_SIZE, OPACITY } from '@/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { CONTROL_BORDER_WIDTH } from '@/theme/tokens';
import { canHover } from '@/lib/hover';

type Variant =
  'primary' | 'accent' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'outlineDanger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconKey;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  /** テキスト・アイコンの色を明示的に上書きする（設定画面など）。 */
  textColor?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  fullWidth,
  style,
  textColor,
}: Props) {
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    accent: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    danger: { bg: colors.danger, fg: colors.onDanger, border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    outline: { bg: 'transparent', fg: colors.text, border: colors.text },
    outlineDanger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  }[variant];
  const foreground = textColor ?? palette.fg;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inactive
            ? OPACITY.buttonDisabled
            : pressed
              ? OPACITY.pressed
              : hovered && canHover
                ? OPACITY.hovered
                : OPACITY.fullyVisible,
        },
        fullWidth && styles.full,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <Icon name={icon} size={ICON_SIZE.lg} color={foreground} />
      ) : null}
      <AppText bold color={foreground}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: BOARD.touchTarget,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: CONTROL_BORDER_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  full: { alignSelf: 'stretch' },
});
