import { StyleSheet, View } from 'react-native';
import { BRAND } from '@/theme/palette';

/** Patto のロゴ（3列のカンバンとカード）。ビューだけで描くので画像ファイルは不要。 */
export function Logo({ size = 64 }: { size?: number }) {
  const u = size / 64;
  const col = (cards: number[], accentIndex = -1) => (
    <View style={[styles.col, { width: 14 * u, borderRadius: 4 * u, padding: 2 * u, gap: 2 * u }]}>
      {cards.map((h, i) => (
        <View
          key={i}
          style={{ height: h * u, borderRadius: 2.5 * u, backgroundColor: i === accentIndex ? BRAND.yellow : BRAND.white }}
        />
      ))}
    </View>
  );
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.24, paddingHorizontal: 7 * u, gap: 4 * u }]}>
      {col([10, 8, 8], 0)}
      {col([8, 12])}
      {col([12, 8, 6], 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: BRAND.blue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  col: { backgroundColor: 'rgba(255,255,255,0.28)', alignSelf: 'center' },
});
