/**
 * 配色トークン。色を変えるときはこのファイルだけ編集する。白黒ベース（ライト=白、ダーク=黒）。
 * 背景（bg / surface / column）は同色にして、境界は border で区切る。将来グレーなどに変えるときは各値を変える。
 */
export interface Palette {
  /** 画面の背景 */
  bg: string;
  /** ヘッダー・メニュー・カード・ダイアログの面 */
  surface: string;
  /** カンバンの背景 */
  column: string;
  border: string;
  /** 区切り線（横線・縦線）。いまは border と同じ値。変えると区切り線だけの色を変えられる */
  divider: string;
  /** ホバー・押下・選択中の行の背景 */
  hover: string;
  text: string;
  textMuted: string;
  /** 主ボタンの色（文字色の反転と同じ） */
  primary: string;
  onPrimary: string;
  /** リンク・フォーカスなどの強調色（青） */
  accent: string;
  /** 強調色の上に載せる文字色 */
  onAccent: string;
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
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  column: '#FFFFFF',
  border: '#D4D4D4',
  divider: '#D4D4D4',
  hover: '#F0F0F0',
  text: '#111111',
  textMuted: '#616161',
  primary: '#111111',
  onPrimary: '#FFFFFF',
  accent: '#0B57D0',
  onAccent: '#FFFFFF',
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
  bg: '#000000',
  surface: '#000000',
  column: '#000000',
  border: '#3A3A3A',
  divider: '#3A3A3A',
  hover: '#1F1F1F',
  text: '#F2F2F2',
  textMuted: '#A8A8A8',
  primary: '#F2F2F2',
  onPrimary: '#000000',
  accent: '#8AB4F8',
  onAccent: '#000000',
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
