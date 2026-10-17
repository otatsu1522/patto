import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme';

/** 線色がテーマ標準以外に設定されている場合だけ、画面の外周に設定色の枠を表示する。 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  const customBorderColor = useSettingsStore((s) => s.settings.borderColor !== null);
  const { colors, lineWidth, lineColor } = useTheme();

  return (
    <View
      style={[
        styles.frame,
        customBorderColor
          ? { backgroundColor: lineColor, padding: lineWidth }
          : { backgroundColor: colors.bg },
      ]}
    >
      <View style={[styles.content, { backgroundColor: colors.bg }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minWidth: 0, minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
});
