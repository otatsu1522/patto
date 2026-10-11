import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { IconKey } from '@/config/icons';
import { BOARD } from '@/config/layout';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <AppText variant="label" muted style={styles.sectionTitle}>
          {title}
        </AppText>
      ) : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
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
}

export function LinkRow({ label, onPress, icon, value, destructive, chevron = true, disabled }: LinkRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        { backgroundColor: pressed || hovered ? colors.column : 'transparent', opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={20} color={destructive ? colors.danger : colors.textMuted} /> : null}
      <AppText color={destructive ? colors.danger : colors.text} style={styles.flex}>
        {label}
      </AppText>
      {value ? <AppText muted>{value}</AppText> : null}
      {chevron ? <Icon name="right" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export function SwitchRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
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
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, styles.column]}>
      <AppText>{label}</AppText>
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
                { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface },
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
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  section: { gap: SPACING.xs },
  sectionTitle: { paddingHorizontal: SPACING.sm },
  card: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: BOARD.touchTarget + 4, flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  column: { flexDirection: 'column', alignItems: 'flex-start', paddingVertical: SPACING.md },
  flex: { flex: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  choice: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: 0, borderWidth: 1 },
});
