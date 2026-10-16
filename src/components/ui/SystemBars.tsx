import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useTheme, LAYER } from '@/theme';

/** アプリ本体と各 Modal で、システムバーの前景色・背景を同じ方法で管理する。 */
export function SystemBars() {
  const { colors, isDark } = useTheme();
  // 背景ビューは、OSが実際に通知するシステムバー領域だけを覆う。
  // 固定値で最小高さを足すと、非 edge-to-edge 環境でアプリ内容に重なる。
  const insets = useSafeAreaInsets();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {Platform.OS === 'android' ? (
        // SDK 57 の style は、light=明るいバー＋暗いアイコン、dark=暗いバー＋明るいアイコン。
        <NavigationBar style={isDark ? 'dark' : 'light'} />
      ) : null}
      {/* Android edge-to-edge ではナビゲーション領域にアプリ内容が透過して見えるため、
          ステータスバー／ナビゲーションバーの背後をテーマ色で明示的に塗る。 */}
      <View
        pointerEvents="none"
        style={[styles.top, { height: insets.top, backgroundColor: colors.bg }]}
      />
      <View
        pointerEvents="none"
        style={[styles.bottom, { height: insets.bottom, backgroundColor: colors.bg }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: LAYER.systemBars,
    elevation: LAYER.systemBars,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: LAYER.systemBars,
    elevation: LAYER.systemBars,
  },
});
