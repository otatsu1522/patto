/** 配色トークン。色を変えるときはこのファイルだけ編集する。 */
export interface Palette {
  bg: string;
  surface: string;
  column: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
  overlay: string;
  focus: string;
}

export const lightPalette: Palette = {
  bg: '#EEF1F6',
  surface: '#FFFFFF',
  column: '#E2E7F0',
  border: '#D0D7E4',
  text: '#1B2433',
  textMuted: '#5F6C85',
  primary: '#2F5BEA',
  onPrimary: '#FFFFFF',
  accent: '#FFC93C',
  danger: '#D93F3F',
  warning: '#C77700',
  success: '#2E9D6A',
  overlay: 'rgba(15, 23, 42, 0.45)',
  focus: '#2F5BEA',
};

export const darkPalette: Palette = {
  bg: '#0F131A',
  surface: '#1A212C',
  column: '#141A23',
  border: '#2A3445',
  text: '#E8EDF5',
  textMuted: '#93A0B8',
  primary: '#7B97FF',
  onPrimary: '#0B1020',
  accent: '#FFC93C',
  danger: '#FF6B6B',
  warning: '#F5B342',
  success: '#4CC38A',
  overlay: 'rgba(0, 0, 0, 0.6)',
  focus: '#7B97FF',
};

/** ロゴ・スプラッシュなどブランド固定色 */
export const BRAND = { blue: '#2F5BEA', yellow: '#FFC93C', white: '#FFFFFF' } as const;
