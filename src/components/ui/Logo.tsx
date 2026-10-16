import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { VIEW_KANBAN_PATH } from '@/config/logo';
import { UI_METRICS } from '@/config/layout';
import { BRAND } from '@/theme/palette';
import { BORDER_WIDTH } from '@/theme/tokens';

/** Patto のロゴ: Google の Material Symbols「view_kanban」。白背景に黒。 */
export function Logo({ size = UI_METRICS.brand.defaultLogoSize }: { size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, padding: size * 0.12 }]}>
      <Svg width="100%" height="100%" viewBox="0 -960 960 960">
        <Path d={VIEW_KANBAN_PATH} fill={BRAND.foreground} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: BRAND.background, borderWidth: BORDER_WIDTH, borderColor: BRAND.border },
});
