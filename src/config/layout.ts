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
  dialogMaxWidth: 520,
  menuMinWidth: 220,
  touchTarget: 44,
  /** 画面上部のバー（ヘッダー）の高さ */
  headerHeight: 56,
  /** スマホ縦でカンバン本体が画面幅に占める割合 */
  compactColumnWidthRatio: 0.92,
  /** PCで左右端に見せる隣のカンバン幅 */
  peekWidth: 40,
  /** PCメニュー幅の最小値／最大値／画面幅に対する割合 */
  desktopSidebarMinWidth: 220,
  desktopSidebarMaxWidth: 400,
  desktopSidebarWidthRatio: 0.25,
  /** スマホメニュー幅の最小値／最大値／画面幅に対する割合 */
  compactSidebarMinWidth: 260,
  compactSidebarMaxWidth: 340,
  compactSidebarWidthRatio: 0.82,
} as const;

export const GESTURE = {
  /** 長押しでつかむまでの時間(ms) */
  longPressMs: 400,
  /** 画面端とみなす距離(px) */
  edgeZone: 48,
  /** 端に留まってから隣へ切り替えるまでの時間(ms) */
  edgeDwellMs: 600,
  /** 端へ自動スクロールした後、ドラッグの落とし先を再計算するまでの待ち時間(ms) */
  edgeScrollSettleMs: 350,
  /** ドラッグ中に画面端の滞在を確認する間隔(ms) */
  edgeScrollCheckIntervalMs: 100,
  /** Webでドラッグ開始とみなす移動量(px) */
  webDragDistance: 6,
  /** Webのタッチ移動方向を判定する最小距離(px) */
  webScrollAxisThresholdPx: 6,
  /** スマホWebのメニューを開く横移動距離(px) */
  drawerOpenDistancePx: 40,
  /** スマホWebのメニューを閉じる横移動距離(px) */
  drawerCloseDistancePx: 40,
  /** 横移動と縦移動のどちらかを判定する比率 */
  drawerHorizontalIntentRatio: 1.15,
  /** Webのホイール1ラインをピクセルへ換算する既定値 */
  webWheelLineDeltaPx: 16,
  /** ScrollViewのDOM接続を再試行する最大回数 */
  webScrollAttachAttempts: 8,
  /** ネストしたスクロール終端判定に許容する差分(px) */
  nestedScrollEndTolerancePx: 1,
  /** メニューが開閉位置にあるとみなすスクロール差分(px) */
  menuEdgeTolerancePx: 2,
  /** メニューアイコンを戻すときに開始位置と一致したとみなす差分(px) */
  menuIconRollbackTolerancePx: 0.5,
  /** スクロール吸着位置に着いたとみなす差分(px) */
  menuSnapSettleTolerancePx: 3,
} as const;

export const FONT_SCALES = {
  tiny: 0.75,
  small: 0.87,
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
} as const;
export type FontScaleKey = keyof typeof FONT_SCALES;

/** コンポーネントごとに調整するUI寸法。構造上の 0 や flex 値は含めない。 */
export const UI_METRICS = {
  startup: {
    noticeMaxWidth: 480,
  },
  dialog: {
    contentMaxWidth: 420,
    /** すべてのダイアログに加える共通幅（BOARD.dialogMaxWidth への加算値） */
    standardExtraWidth: 160,
    feedbackCardMaxWidth: 440,
    toastMaxWidth: 520,
    /** 設定画面カードの最大幅に加える余白 */
    settingsPanelExtraWidth: 120,
    /** 本文固定ダイアログの高さ（キーボード表示時は表示可能領域に合わせて縮小） */
    fixedBodyHeight: '90%',
    /** ダイアログの最大高さ */
    maxHeightPercent: '90%',
  },
  keyboard: {
    /** ダイアログでキーボード表示中と判断する visual viewport 差 */
    dialogVisibleHeightPx: 120,
    /** Webでキーボードが閉じたと判断する viewport 差。閉じる途中の位置跳ねを防ぐ */
    dialogHideTolerancePx: 24,
    /** プロフィール画面でキーボード表示中と判断する viewport 差 */
    profileViewportDeltaPx: 100,
    /** TextFieldでキーボード表示中と判断する viewport 差 */
    textFieldViewportDeltaPx: 80,
  },
  menu: {
    /** メニュー幅を最小幅に加算する寸法 */
    popupWidthExtra: 40,
    /** トリガーとメニュー間の隙間 */
    anchorGap: 2,
    /** アイコン用のスロット幅 */
    iconSlotWidth: 18,
  },
  shortcuts: {
    rowMinHeight: 60,
    keyFieldMinHeight: 40,
    comboGap: 3,
    comboPaddingHorizontal: 4,
    comboPaddingVertical: 3,
    comboMinHeight: 30,
    keyCapMinWidth: 18,
    helpKeyCapMinWidth: 22,
    keyCapMinHeight: 22,
    keyCapPaddingHorizontal: 2,
    comboPlusPaddingHorizontal: 1,
    estimatedKeyCapCharWidth: 7,
    estimatedComboSeparatorWidth: 12,
    /** キー枠の左右 padding の合計。枠線幅は設定値から別途加算する。 */
    estimatedComboTrailingWidth: 8,
    addActionSlotWidth: 42,
    captureActionSlotWidth: 72,
    /** ショートカット行の再レイアウト判定の最小差(px) */
    rowWidthChangeThreshold: 1,
    /** 計測値の変化として扱う最小差(px) */
    measuredWidthChangeThreshold: 0.5,
    /** リセット操作領域の想定幅(px) */
    resetButtonWidth: 34,
    /** 行のラベルなどの固定領域幅(px) */
    fixedLabelAreaWidth: 96,
    /** 実測前に使うキー欄の最小幅(px) */
    fallbackMinWidth: 70,
    /** 実測前に使うキー欄の最大幅(px) */
    fallbackMaxWidth: 440,
    /** 実測前に確保する画面幅の割合 */
    fallbackWidthRatio: 0.6,
  },
  colorPicker: {
    swatchSize: 34,
  },
  brand: {
    defaultLogoSize: 64,
    authLogoSize: 72,
    aboutLogoSize: 80,
  },
  scrollbar: {
    width: 8,
  },
  scroll: {
    /** スクロール位置が端・前後位置と一致したとみなす許容差(px) */
    positionTolerancePx: 1,
  },
  board: {
    pagerHeight: 31,
    pagerReservedHeight: 32,
    pagerDotSize: 8,
    colorDotSize: 12,
    taskActionWidth: 36,
    checkboxSlotWidth: 22,
    navigationButtonInset: 2,
    taskContentPaddingAdjustment: 2,
    taskContentGapAdjustment: 2,
    sidebarItemRightPadding: 8,
    /** ピン留め項目と通常項目の間に表示する共通区切り線の長さ(px) */
    pinnedDividerWidth: 238,
    dueButtonBaselineAdjustment: 2,
    /** ドラッグ中に表示するカードの既定幅 */
    dragPreviewWidth: 140,
    /** カーソル対象の上下スクロール時に確保する余白(px) */
    cursorScrollMargin: 4,
    /** ドラッグ表示カードの既定高さ(px) */
    dragPreviewDefaultHeight: 44,
    /** ドラッグ表示カードの既定X補正(px) */
    dragPreviewOffsetX: 70,
    /** ドラッグ表示カードの既定Y補正(px) */
    dragPreviewOffsetY: 20,
  },

  textField: {
    /** 複数行入力の最大高さ */
    autoGrowMaxHeight: 320,
    /** 画面に対する複数行入力の最大高さの比率 */
    autoGrowMaxViewportRatio: 0.36,
    /** 複数行入力の最小高さをタップ領域より小さくする量 */
    autoGrowMinHeightAdjustment: 2,
    /** フォントサイズに対する行高倍率 */
    lineHeightMultiplier: 1.5,
    /** 入力欄の自動拡張で1行追加とみなす比率 */
    autoGrowStepFraction: 0.7,
    /** 説明欄の既定表示行数 */
    descriptionLines: 4,
  },
  search: {
    inputHeight: 48,
    filterChipMinHeight: 32,
    filterChipMaxWidth: 240,
    resultGap: 2,
  },
  license: {
    bodyLineHeight: 19,
  },
  systemBars: {
    /** Androidのシステムバーinsetが初期描画で0のときに使う最小値(px) */
    androidMinimumInsetPx: 24,
  },
  text: {
    /** 1行に制限する短い表示 */
    singleLineMax: 1,
    /** 一般的な短いプレビューに用いる最大行数 */
    previewLines: 2,
  },
  rows: {
    /** タップ行の最小高さに足す余裕(px) */
    itemTouchHeightAdjustment: 4,
  },
} as const;
