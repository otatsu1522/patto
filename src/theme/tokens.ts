/** 余白・角丸・文字の基準値。角丸はなし（直角）。pill は「色の丸」だけに使う。 */
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 0, md: 0, lg: 0, pill: 999 } as const;
export const FONT = {
  caption: 12,
  label: 13,
  body: 14,
  bodyLarge: 16,
  title: 18,
  headline: 20,
} as const;
export const FONT_WEIGHT = { normal: '400', medium: '600', bold: '700' } as const;
/** アイコン拡大率の上限。文字の拡大率に引きずられて崩れないようにする。 */
export const FONT_SCALE = { iconMax: 1.15 } as const;
/** アイコンの共通サイズ。各画面で数値を直接指定しない。 */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 22 } as const;
/** IconButton の明示的なタップ領域サイズ。既定値は BOARD.touchTarget。 */
export const ICON_BUTTON_BOX = { compact: 32, navigation: 34, medium: 36, large: 40 } as const;
/** 操作対象の当たり判定を視覚サイズより広げる値。 */
export const HIT_SLOP = { iconButton: 4, control: 8 } as const;
/** 共通の半透明状態。 */
export const OPACITY = {
  disabled: 0.4,
  muted: 0.65,
  completed: 0.6,
  copyright: 0.78,
  buttonDisabled: 0.5,
  pressed: 0.8,
  hovered: 0.92,
  fullyVisible: 1,
  draggingTask: 0.35,
  draggingColumn: 0.5,
  hoverOverlay: 0.25,
} as const;
/** 重なり順をコンポーネント間で揃えるためのレイヤー。 */
export const LAYER = {
  base: 0,
  colorBadge: 1,
  dragColumn: 5,
  searchResults: 10,
  boardFooter: 20,
  boardChrome: 30,
  sidebarEdge: 40,
  dragPreview: 50,
  systemBars: 1000,
} as const;
export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  float: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
} as const;

/** 枠線を表示しない箇所で使う値。数値の直書きを避ける。 */
export const BORDER_WIDTH_NONE = 0;

/** 通常の画面枠線・区切り線の既定値（実際の表示値はテーマ設定で変更する）。 */
export const BORDER_WIDTH = 1;

/** フォームやボタンなど、太さをユーザー設定に連動させないコントロール用の枠線。 */
export const CONTROL_BORDER_WIDTH = 2;

/** 選択・フォーカス・色スウォッチなど、強調表示に使う太い線の太さ。 */
export const BORDER_WIDTH_EMPHASIS = 2;

/** 区切り線も通常の枠線と同じ太さに統一する（Web・ネイティブ共通）。 */
export const SEPARATOR_WIDTH = BORDER_WIDTH;
