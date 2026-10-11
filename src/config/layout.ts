/** レイアウト・操作感に関する数値。 */
export const BREAKPOINTS = {
  /** この幅未満: スマホ縦（1列表示） */
  medium: 600,
  /** この幅以上: PC（サイドバー常設） */
  expanded: 1024,
} as const;

export const BOARD = {
  /** 1画面に並べるカンバン数（medium以上） */
  visibleColumns: 3,
  /** カンバンの最小幅。これを下回る場合は列数を減らす */
  minColumnWidth: 260,
  columnGap: 12,
  boardPadding: 12,
  sidebarWidth: 300,
  drawerWidth: 300,
  dialogMaxWidth: 520,
  menuMinWidth: 220,
  touchTarget: 44,
} as const;

export const GESTURE = {
  /** 長押しでつかむまでの時間(ms) */
  longPressMs: 400,
  /** 画面端とみなす距離(px) */
  edgeZone: 48,
  /** 端に留まってから隣へ切り替えるまでの時間(ms) */
  edgeDwellMs: 600,
  /** Webでドラッグ開始とみなす移動量(px) */
  webDragDistance: 6,
} as const;

export const FONT_SCALES = { small: 0.87, normal: 1, large: 1.15, xlarge: 1.3 } as const;
export type FontScaleKey = keyof typeof FONT_SCALES;
