import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { IconKey } from '@/config/icons';
import { BOARD, UI_METRICS } from '@/config/layout';
import { RADIUS, SPACING, useTheme, ICON_SIZE, OPACITY } from '@/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { canHover } from '@/lib/hover';

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const { colors, lineWidth, lineColor } = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <AppText variant="label" muted style={styles.sectionTitle}>
          {title}
        </AppText>
      ) : null}
      {description ? (
        <AppText variant="caption" muted style={styles.sectionTitle}>
          {description}
        </AppText>
      ) : null}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: lineColor, borderWidth: lineWidth },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

interface LinkRowProps {
  label: string;
  onPress: () => void;
  icon?: IconKey;
  value?: string;
  destructive?: boolean;
  chevron?: boolean;
  disabled?: boolean;
  /** 項目名の下に出す説明文 */
  description?: string;
}

export function LinkRow({
  label,
  onPress,
  icon,
  value,
  destructive,
  chevron = true,
  disabled,
  description,
}: LinkRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        {
          backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent',
          opacity: disabled ? OPACITY.buttonDisabled : OPACITY.fullyVisible,
        },
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={ICON_SIZE.xl}
          color={destructive ? colors.danger : colors.textMuted}
        />
      ) : null}
      <View style={styles.flex}>
        <AppText color={destructive ? colors.danger : colors.text}>{label}</AppText>
        {description ? (
          <AppText variant="caption" muted>
            {description}
          </AppText>
        ) : null}
      </View>
      {value ? <AppText muted>{value}</AppText> : null}
      {chevron ? <Icon name="right" size={ICON_SIZE.lg} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <AppText>{label}</AppText>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { colors, controlLineWidth, controlLineColor } = useTheme();
  return (
    <View style={[styles.row, styles.column]}>
      {label ? <AppText>{label}</AppText> : null}
      <View style={styles.choices}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[
                styles.choice,
                {
                  borderColor: selected ? colors.primary : controlLineColor,
                  borderWidth: controlLineWidth,
                  backgroundColor: selected ? colors.primary : colors.surface,
                },
              ]}
            >
              <AppText variant="caption" bold color={selected ? colors.onPrimary : colors.text}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Divider() {
  const { lineWidth, lineColor } = useTheme();
  return <View style={{ height: lineWidth, backgroundColor: lineColor }} />;
}

const styles = StyleSheet.create({
  section: { gap: SPACING.xs },
  sectionTitle: { paddingHorizontal: SPACING.sm },
  card: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  row: {
    minHeight: BOARD.touchTarget + UI_METRICS.rows.itemTouchHeightAdjustment,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  column: { flexDirection: 'column', alignItems: 'flex-start', paddingVertical: SPACING.md },
  flex: { flex: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  choice: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
});
