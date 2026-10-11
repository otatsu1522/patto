import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { FONT_SCALES } from '@/config/layout';
import { useSettingsStore } from '@/store/settingsStore';
import { darkPalette, lightPalette, type Palette } from './palette';
import { FONT } from './tokens';

export { FONT, RADIUS, SHADOW, SPACING } from './tokens';

interface Theme {
  colors: Palette;
  isDark: boolean;
  /** 文字サイズ倍率を反映した fontSize を返す */
  fs: (size: number) => number;
  fontScale: number;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const mode = useSettingsStore((s) => s.settings.themeMode);
  const scaleKey = useSettingsStore((s) => s.settings.fontScale);

  const value = useMemo<Theme>(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    const fontScale = FONT_SCALES[scaleKey];
    return {
      colors: isDark ? darkPalette : lightPalette,
      isDark,
      fontScale,
      fs: (size: number) => Math.round(size * fontScale),
    };
  }, [mode, system, scaleKey]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('ThemeProvider が見つかりません');
  return ctx;
}

