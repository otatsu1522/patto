import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { VIEW_KANBAN_PATH } from '@/config/logo';
import { UI_METRICS } from '@/config/layout';
import { BRAND } from '@/theme/palette';
import { useTheme } from '@/theme';

/** Patto のロゴ: Google の Material Symbols「view_kanban」。必要に応じて白い枠を付ける。 */
export function Logo({
  size = UI_METRICS.brand.defaultLogoSize,
  framed = true,
}: {
  size?: number;
  framed?: boolean;
}) {
  const { colors, lineWidth, lineColor } = useTheme();
  return (
    <View
      style={[
        { width: size, height: size, padding: size * 0.12 },
        framed
          ? [styles.framed, { borderWidth: lineWidth, borderColor: lineColor }]
          : styles.unframed,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 -960 960 960">
        <Path d={VIEW_KANBAN_PATH} fill={framed ? BRAND.foreground : colors.text} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  framed: {
    backgroundColor: BRAND.background,
  },
  unframed: { backgroundColor: 'transparent', borderWidth: 0 },
});
