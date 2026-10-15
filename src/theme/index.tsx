import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { FONT_SCALES } from '@/config/layout';
import { isTouchWeb } from '@/lib/hover';
import { useSettingsStore } from '@/store/settingsStore';
import { darkPalette, lightPalette, type Palette } from './palette';
import { TASK_COLORS, TASK_COLORS_DARK, type TaskColorKey } from './taskColors';

import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';

export { BORDER_WIDTH, FONT, RADIUS, SEPARATOR_WIDTH, SHADOW, SPACING } from './tokens';

interface Theme {
  colors: Palette;
  isDark: boolean;
  /** 文字サイズ倍率を反映した fontSize を返す */
  fs: (size: number) => number;
  fontScale: number;
  /** テーマに合わせたタスク色（ダークは明るめ） */
  taskColor: (key: TaskColorKey) => string;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Web: ブラウザのスクロールバー・標準部品の配色・アドレスバーの色をテーマに合わせ、
 * スマホのブラウザでもアプリのように動くよう、ブラウザ特有の挙動（引っ張って更新、選択、拡大など）を抑える。
 */
function useWebChrome(isDark: boolean, colors: Palette) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    let style = document.getElementById('patto-scrollbar') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'patto-scrollbar';
      document.head.appendChild(style);
    }
    style.textContent = `* { scrollbar-width: thin; scrollbar-color: ${colors.scrollThumb} transparent; overscroll-behavior: none; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb { background: ${colors.scrollThumb}; }
*::-webkit-scrollbar-track { background: transparent; }`;
    document.body.style.backgroundColor = colors.bg;
    // スマホのブラウザのアドレスバー・ステータスバーの色（ヘッダーと同じ色）
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.surface);
  }, [isDark, colors]);

  // スマホのブラウザ: キーボードが出て表示領域が小さくなったら、画面の高さもそれに合わせる（iOS は自動で縮まないため）
  useEffect(() => {
    if (Platform.OS !== 'web' || !isTouchWeb || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const root = document.getElementById('root');
    const fit = () => {
      if (root) root.style.height = `${viewport.height}px`;
      window.scrollTo(0, 0);
    };
    fit();
    viewport.addEventListener('resize', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      if (root) root.style.height = '';
    };
  }, []);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const mode = useSettingsStore((s) => s.settings.themeMode);
  const scaleKey = useSettingsStore((s) => s.settings.fontScale);

  const value = useMemo<Theme>(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    const fontScale = FONT_SCALES[scaleKey];
    const map = isDark ? TASK_COLORS_DARK : TASK_COLORS;
    return {
      colors: isDark ? darkPalette : lightPalette,
      isDark,
      fontScale,
      fs: (size: number) => Math.round(size * fontScale),
      taskColor: (key) => map[key] ?? '#888888',
    };
  }, [mode, system, scaleKey]);

  // 画面遷移（ナビゲーション）の背景色などもテーマに合わせる。合わせないとOS標準の背景色になる。
  const navigationTheme = useMemo(() => {
    const base = value.isDark ? NavigationDarkTheme : NavigationDefaultTheme;
    return {
      ...base,
      dark: value.isDark,
      colors: {
        ...base.colors,
        primary: value.colors.accent,
        background: value.colors.bg,
        card: value.colors.surface,
        text: value.colors.text,
        border: value.colors.border,
        notification: value.colors.danger,
      },
    };
  }, [value]);

  // アプリのテーマをOSに伝える。OSとアプリでテーマが違うと、ステータスバー・ナビゲーションボタン・
  // 標準ダイアログなどの背景/文字色がOSのテーマのままになり、アプリと逆の色になってしまう。
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  useWebChrome(value.isDark, value.colors);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </NavigationThemeProvider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('ThemeProvider が見つかりません');
  return ctx;
}
