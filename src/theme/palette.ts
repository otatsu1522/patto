/** 配色トークン。色を変えるときはこのファイルだけ編集する。白黒ベース（ライト=白、ダーク=黒）。 */
export interface Palette {
  /** 画面の背景 */
  bg: string;
  /** ヘッダー・メニュー・カード・ダイアログの面 */
  surface: string;
  /** カンバンの背景 */
  column: string;
  border: string;
  text: string;
  textMuted: string;
  /** 主ボタンの色（文字色の反転と同じ） */
  primary: string;
  onPrimary: string;
  /** リンク・フォーカスなどの強調色（青） */
  accent: string;
  danger: string;
  onDanger: string;
  warning: string;
  onWarning: string;
  success: string;
  overlay: string;
  focus: string;
  /** 通知（スナックバー）: 画面と反転した面 */
  inverse: string;
  onInverse: string;
  inverseAccent: string;
  /** スクロールバー */
  scrollThumb: string;
}

export const lightPalette: Palette = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  column: '#EBEBEB',
  border: '#D4D4D4',
  text: '#111111',
  textMuted: '#616161',
  primary: '#111111',
  onPrimary: '#FFFFFF',
  accent: '#0B57D0',
  danger: '#C5221F',
  onDanger: '#FFFFFF',
  warning: '#8F5200',
  onWarning: '#FFFFFF',
  success: '#137333',
  overlay: 'rgba(0, 0, 0, 0.45)',
  focus: '#0B57D0',
  inverse: '#1F1F1F',
  onInverse: '#FFFFFF',
  inverseAccent: '#8AB4F8',
  scrollThumb: '#B0B0B0',
};

export const darkPalette: Palette = {
  bg: '#1A1A1A',
  surface: '#000000',
  column: '#262626',
  border: '#3A3A3A',
  text: '#F2F2F2',
  textMuted: '#A8A8A8',
  primary: '#F2F2F2',
  onPrimary: '#000000',
  accent: '#8AB4F8',
  danger: '#F28B82',
  onDanger: '#000000',
  warning: '#FDD663',
  onWarning: '#000000',
  success: '#81C995',
  overlay: 'rgba(0, 0, 0, 0.65)',
  focus: '#8AB4F8',
  inverse: '#F2F2F2',
  onInverse: '#111111',
  inverseAccent: '#0B57D0',
  scrollThumb: '#5A5A5A',
};

/** アプリアイコン・ロゴ: 白背景に黒 */
export const BRAND = { background: '#FFFFFF', foreground: '#000000' } as const;
