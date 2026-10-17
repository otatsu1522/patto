import { Pressable, StyleSheet, View } from 'react-native';
import { UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme, ICON_SIZE, LAYER } from '@/theme';
import { TASK_COLOR_PICKER_KEYS, type TaskColorKey } from '@/theme/taskColors';
import { BRAND } from '@/theme/palette';
import { AppText } from './AppText';
import { Icon } from './Icon';

interface Props {
  label: string;
  value: TaskColorKey | null;
  onChange: (v: TaskColorKey | null) => void;
  /** null の選択肢の背景色。省略時はテーマの面色を使う。 */
  noneColor?: string;
  /** null の選択肢のアクセシビリティ名。 */
  noneLabel?: string;
  /** ラベルの表示スタイル。 */
  labelVariant?: 'body' | 'label';
  labelMuted?: boolean;
}

/** パレットから色を選ぶ。先頭の null 選択肢はデフォルト色を表し、斜線は表示しない。 */
export function ColorPicker({
  label,
  value,
  onChange,
  noneColor,
  noneLabel = t('color.none'),
  labelVariant = 'label',
  labelMuted = true,
}: Props) {
  const { colors, taskColor, isDark, controlLineWidth } = useTheme();
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
              // 未設定の丸は、設定中の線色に左右されないテーマ標準色で表示する。
              borderColor: colors.border,
              borderWidth: controlLineWidth,
              backgroundColor: noneColor ?? colors.surface,
            },
          ]}
        >
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
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
