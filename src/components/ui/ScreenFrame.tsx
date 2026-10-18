import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme';

/** 線色がテーマ標準以外に設定されている場合だけ、画面の外周に設定色の枠を表示する。 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  const customBorderColor = useSettingsStore((s) => s.settings.borderColor !== null);
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.frame, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.content,
          customBorderColor ? { padding: lineWidth } : undefined,
          { backgroundColor: colors.bg },
        ]}
      >
        {children}
      </View>
      {customBorderColor ? (
        <View
          pointerEvents="none"
          style={[
            styles.border,
            {
              top: Platform.OS === 'web' ? 0 : Math.max(0, insets.top),
              bottom: Platform.OS === 'web' ? 0 : Math.max(0, insets.bottom),
              borderColor: lineColor,
              borderWidth: lineWidth,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minWidth: 0, minHeight: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  border: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderStyle: 'solid',
    zIndex: 1000,
    elevation: 1000,
  },
});
