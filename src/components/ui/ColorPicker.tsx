import { Pressable, StyleSheet, View } from 'react-native';
import { BOARD, UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { BORDER_WIDTH_EMPHASIS, RADIUS, SPACING, useTheme, ICON_SIZE, LAYER } from '@/theme';
import { TASK_COLOR_PICKER_KEYS, type TaskColorKey } from '@/theme/taskColors';
import { BRAND } from '@/theme/palette';
import { AppText } from './AppText';
import { Icon } from './Icon';

interface Props {
  label: string;
  value: TaskColorKey | null;
  onChange: (v: TaskColorKey | null) => void;
  /** null の選択肢に表示する色。指定時は「色なし」の斜線を表示しない。 */
  noneColor?: string;
  /** null の選択肢のアクセシビリティ名。 */
  noneLabel?: string;
  /** ラベルの表示スタイル。 */
  labelVariant?: 'body' | 'label';
  labelMuted?: boolean;
}

/** パレットから色を選ぶ。先頭の null 選択肢は通常「色なし」として斜線表示する。 */
export function ColorPicker({
  label,
  value,
  onChange,
  noneColor,
  noneLabel = t('color.none'),
  labelVariant = 'label',
  labelMuted = true,
}: Props) {
  const { colors, taskColor, isDark } = useTheme();
  return (
    <View style={styles.wrap}>
      <AppText variant={labelVariant} muted={labelMuted}>
        {label}
      </AppText>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={noneLabel}
          onPress={() => onChange(null)}
          style={[
            styles.swatch,
            {
              borderColor: colors.border,
              backgroundColor: noneColor ?? colors.surface,
            },
          ]}
        >
          {noneColor === undefined ? (
            <View style={[styles.slash, { backgroundColor: colors.border }]} />
          ) : null}
          {value === null ? (
            <View style={styles.checkBadge}>
              <Icon name="check" size={ICON_SIZE.xs} color={colors.text} />
            </View>
          ) : null}
        </Pressable>
        {TASK_COLOR_PICKER_KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={t(`color.${key}`)}
            onPress={() => onChange(key)}
            style={[
              styles.swatch,
              {
                backgroundColor: taskColor(key),
                borderWidth: 0,
              },
            ]}
          >
            {value === key ? (
              <View style={styles.checkBadge}>
                <Icon
                  name="check"
                  size={ICON_SIZE.md}
                  color={isDark || key === 'yellow' ? BRAND.foreground : BRAND.background}
                />
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  slash: {
    position: 'absolute',
    width: BOARD.touchTarget,
    height: BORDER_WIDTH_EMPHASIS,
    borderRadius: BORDER_WIDTH_EMPHASIS / 2,
    transform: [{ rotate: '-45deg' }],
  },
  checkBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: 'transparent',
    zIndex: LAYER.colorBadge,
  },
  swatch: {
    width: UI_METRICS.colorPicker.swatchSize,
    height: UI_METRICS.colorPicker.swatchSize,
    borderRadius: RADIUS.pill,
    borderWidth: BORDER_WIDTH_EMPHASIS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
