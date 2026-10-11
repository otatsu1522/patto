import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { TASK_COLOR_KEYS, type TaskColorKey } from '@/theme/taskColors';
import { AppText } from './AppText';
import { Icon } from './Icon';

interface Props {
  label: string;
  value: TaskColorKey | null;
  onChange: (v: TaskColorKey | null) => void;
}

/** パレットから色を選ぶ。先頭は「なし」。 */
export function ColorPicker({ label, value, onChange }: Props) {
  const { colors, taskColor, isDark } = useTheme();
  return (
    <View style={styles.wrap}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.none')}
          onPress={() => onChange(null)}
          style={[styles.swatch, { borderColor: value === null ? colors.primary : colors.border, backgroundColor: colors.surface }]}
        />
        {TASK_COLOR_KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key}
            onPress={() => onChange(key)}
            style={[styles.swatch, { backgroundColor: taskColor(key), borderColor: value === key ? colors.text : 'transparent' }]}
          >
            {value === key ? <Icon name="check" size={16} color={isDark || key === 'yellow' ? '#000000' : '#FFFFFF'} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  swatch: { width: 34, height: 34, borderRadius: RADIUS.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
