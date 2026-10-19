import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOARD, GESTURE, UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import type { KanbanColumn, Task } from '@/domain/types';
import {
  registerBoardMenu,
  closeBoardMenu,
  consumeBoardMenuCloseAfterProjectRender,
} from '@/hooks/boardMenu';
import {
  cancelDrawerCloseTransition,
  finishDrawerCloseAfterRender,
  scheduleDrawerCloseAfterRender,
} from '@/hooks/drawerTransition';
import { isTouchWeb } from '@/lib/hover';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  adjacentOffset,
  boardGeometry,
  columnIndexAt,
  nearestOffsetIndex,
  sidebarWidthFor,
  useLayoutMode,
} from '@/hooks/useLayout';
import { t } from '@/i18n';
import type { Cursor } from '@/shortcuts/cursor';
import {
  BORDER_WIDTH_EMPHASIS,
  BORDER_WIDTH_NONE,
  RADIUS,
  SHADOW,
  SPACING,
  useTheme,
  ICON_BUTTON_BOX,
  HIT_SLOP,
  LAYER,
} from '@/theme';
import { AppText } from '../ui/AppText';
import { Sidebar } from '../shell/Sidebar';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import type { MenuItem } from '../ui/DropdownMenu';
import { ColumnView } from './ColumnView';
import type { DragHandlers, GrabInfo } from './dragGesture';

/** スマホのブラウザで、つかんでいる間にページが一緒にスクロールしないようにする */
const preventTouchMove = (e: Event) => {
  if (e.cancelable) e.preventDefault();
};

export interface BoardViewHandle {
  scrollToColumn: (index: number) => void;
}

interface Props {
  columns: KanbanColumn[];
  tasksOf: (columnId: string) => Task[];
  cursor: Cursor | null;
  compactCards: boolean;
  detailedCards: boolean;
  showTaskDescription: boolean;
  showTaskDueDate: boolean;
  showTaskUpdatedAt: boolean;
  menuItemsFor: (column: KanbanColumn, index: number) => MenuItem[];
  taskMenuFor: (task: Task) => MenuItem[];
  onAdvance: (task: Task) => void;
  /** ドラッグで落としたとき（ピン留めの状態は移動先でも変わらない） */
  onTaskDrop: (task: Task, target: KanbanColumn, manualIndex?: number) => void;
  onColumnDrop: (column: KanbanColumn, toIndex: number) => void;
  onAddTask: (column: KanbanColumn) => void;
  onCopyTitle: (task: Task) => void;
  onCopyDescription: (task: Task) => void;
  onRefresh?: () => Promise<void>;
  /**
   * 画面上部のバー。スマホではメニューと一緒に横へ動かす（メニューを開くと、画面全体が右へずれてメニューが現れる）。
   * PCでは、ボードの上にそのまま表示する。
   */
  header?: (active: boolean) => ReactNode;
  /** カンバンが0件のとき、通常の「カンバンなし」案内を表示するか */
  showEmptyState?: boolean;
  /** この値が変わったら（プロジェクトの切り替えなど）、スクロールを最初の位置に戻す */
  resetKey?: string;
}

type DragInfo = ({ kind: 'task'; task: Task } | { kind: 'column'; column: KanbanColumn }) & {
  grab?: GrabInfo;
};

interface ScrollUiSnapshot {
  page: number;
  menuVisible: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

/**
 * カンバンを横に並べるボード。
 * - スマホ縦: 前後のカンバンが見える幅で、1つずつ吸着しながらスクロール。
 *   メニューは「いちばん左のカンバンのさらに左」にある横スクロールの一部で、カンバンを動かすのと同じ操作で開く。
 * - それ以外: 3列表示、4つ以上は横スクロール＋前後ボタン（動かせる方向のボタンだけ表示）
 * - 長押し（PCはドラッグ）でタスク・カンバンをつかんで移動。画面端に寄せると隣へスクロール
 */
export const BoardView = forwardRef<BoardViewHandle, Props>(function BoardView(props, ref) {
  const { columns, tasksOf, cursor, header } = props;
  const { colors, isDark, lineWidth, lineColor, controlLineWidth, controlLineColor } = useTheme();
  const customOuterBorder = useSettingsStore((s) => s.settings.borderColor !== null);
  const { mode, width: windowWidth, height: windowHeight } = useLayoutMode();
  const showTaskMetadataIcons = mode === 'expanded' || (Platform.OS === 'web' && !isTouchWeb);
  const insets = useSafeAreaInsets();
  // 画面切替直後に width=0 のため ScrollView 自体が描画されず、1フレーム白くなるのを防ぐ。
  // 初期値はウィンドウ寸法から安全領域を差し引いて見積もり、実際のレイアウト値は onLayout で同期する。
  const [size, setSize] = useState(() => ({
    width: windowWidth,
    height: Math.max(1, windowHeight - insets.top - insets.bottom),
  }));
  const [scrollX, setScrollX] = useState(0);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const activePageIndexRef = useRef(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [blurSignal, setBlurSignal] = useState(0);

  const scrollAnim = useRef(new Animated.Value(0)).current;

  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const taskNodeRefs = useRef(new Map<string, View>());
  const origin = useRef({ x: 0, y: 0 });
  const scrollXRef = useRef(0);
  // プログラム操作中は、スクロール完了まで意図した開閉状態を優先する。
  const menuTargetRef = useRef<boolean | null>(null);
  const pendingMenuCloseRef = useRef<(() => void) | null>(null);
  const pendingMenuCloseFrameRef = useRef<number | null>(null);
  const automaticMenuCloseTokenRef = useRef<number | null>(null);
  const lastResetKeyRef = useRef(props.resetKey);
  const didInitialPlacementRef = useRef(false);
  const closeMenuImplRef = useRef<(() => void) | null>(null);
  // 手動スクロールでは、アニメーションの完了を待たずにメニューアイコンを切り替える。
  // 元の位置へ戻った場合は、開閉が成立しなかったものとしてアイコンも戻す。
  const menuGestureStartXRef = useRef<number | null>(null);
  const menuIconTransitionRef = useRef<'opening' | 'closing' | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const edge = useRef({ side: 0, since: 0 });
  const dragRef = useRef<DragInfo | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pos = useRef(new Animated.ValueXY()).current;

  const geo = useMemo(
    () => boardGeometry(size.width, mode, columns.length),
    [size.width, mode, columns.length],
  );

  // スマホ（PC以外）: メニューを「いちばん左のカンバンのさらに左」の1ページとして横スクロールの中に置く。
  // メニューの幅ぶん、カンバンが右へずれるので、カンバンの止まる位置もその分ずらす。
  const pane = mode !== 'expanded';
  const menuWidth = sidebarWidthFor(windowWidth, false);
  // ネイティブは従来どおり gap 分を含めて位置を合わせる。
  // Web はメニュー領域の右余白を相殺するため、現在の Web 配置を維持する。
  const menuShift = pane
    ? menuWidth + (Platform.OS === 'web' ? BOARD.columnGap / 2 : BOARD.columnGap) - geo.padding
    : 0;
  /** カンバンごとの「止まる位置」（メニューを含む） */
  const offsets = useMemo(() => geo.offsets.map((o) => o + menuShift), [geo.offsets, menuShift]);
  /** 横スクロールが吸着する位置。メニューを開いた位置（0）も含める */
  const snapOffsets = useMemo(() => (pane ? [0, ...offsets] : offsets), [pane, offsets]);
  const closedX = offsets[0] ?? 0;
  const maxOffset = offsets[offsets.length - 1] ?? 0;
  // contentOffset is an initial value, not a live menu-state binding. Keeping it stable
  // prevents React Native from resetting the native scroll position during an animation.
  const [initialContentOffset] = useState(() => ({
    x: pane ? (useUiStore.getState().menuVisible ? 0 : closedX) : 0,
    y: 0,
  }));
  const updateActivePage = useCallback(
    (x: number) => {
      const nextPage = nearestOffsetIndex(offsets, x);
      if (activePageIndexRef.current !== nextPage) {
        activePageIndexRef.current = nextPage;
        setActivePageIndex(nextPage);
      }
      return nextPage;
    },
    [offsets],
  );
  /** スマホでは、メニューを画面の上端まで広げるため、カンバンの上にヘッダーの高さの空きを作る */
  const headerOffset = pane ? BOARD.headerHeight : 0;
  // スマホ Web ではヘッダー／フッターを ScrollView 内の sticky レイヤーに置く。
  // メニュー開閉時は実スクロールに同期して移動し、カンバン横移動中は左端に固定する。
  const webInlineChrome = Platform.OS === 'web' && mode === 'compact' && pane && !!header;
  const menuVisible = pane && scrollX < closedX - GESTURE.menuEdgeTolerancePx;
  const pagerOpacity = useMemo(
    () =>
      scrollAnim.interpolate({
        inputRange: [0, Math.max(1, closedX)],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [scrollAnim, closedX],
  );
  const closedXRef = useRef(closedX);
  closedXRef.current = closedX;
  const finishPendingMenuClose = useCallback((x: number) => {
    if (
      !pendingMenuCloseRef.current ||
      x < closedXRef.current - GESTURE.menuEdgeTolerancePx ||
      pendingMenuCloseFrameRef.current !== null
    ) {
      return;
    }
    // 閉じ位置に着いた次のフレームで遷移する。操作が入ったら、このフレームも取消可能にする。
    pendingMenuCloseFrameRef.current = requestAnimationFrame(() => {
      pendingMenuCloseFrameRef.current = null;
      if (
        !pendingMenuCloseRef.current ||
        scrollXRef.current < closedXRef.current - GESTURE.menuEdgeTolerancePx
      ) {
        return;
      }
      const afterClose = pendingMenuCloseRef.current;
      pendingMenuCloseRef.current = null;
      afterClose();
    });
  }, []);
  const scrollUiSnapshotRef = useRef<ScrollUiSnapshot | null>(null);
  // メニューとカンバンの境界線をつなぐ幅。Web では sticky レイヤー内の線に使う。
  const menuEdgeWidth = Math.max(
    0,
    closedX - menuWidth + (Platform.OS === 'web' && customOuterBorder ? lineWidth : 0),
  );
  // メニューを開いているときだけ、ヘッダー下線をメニュー右端からつなぐ。
  const menuBridgeOpacity = useMemo(
    () =>
      pagerOpacity.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      }),
    [pagerOpacity],
  );

  const scrollToX = useCallback((x: number, animated = true) => {
    const target = Math.max(0, x);
    // Web では目標位置を先に state へ入れず、実際の scroll イベントに追従させる。
    // 先に setScrollX(target) すると、ヘッダー／ドロワーがスクロール開始前に跳ねる。
    scrollRef.current?.scrollTo({ x: target, animated });
  }, []);

  // 描画後に開始した自動クローズ中にユーザーが操作したら、現在位置で止めて操作を優先する。
  const interruptAutomaticMenuClose = useCallback(() => {
    if (automaticMenuCloseTokenRef.current === null) return;
    const x = Math.max(0, scrollXRef.current);
    scrollRef.current?.scrollTo({ x, y: 0, animated: false });
    scrollXRef.current = x;
    setScrollX(x);
    if (pendingMenuCloseFrameRef.current !== null) {
      cancelAnimationFrame(pendingMenuCloseFrameRef.current);
      pendingMenuCloseFrameRef.current = null;
    }
    pendingMenuCloseRef.current = null;
    menuTargetRef.current = null;
    menuGestureStartXRef.current = null;
    menuIconTransitionRef.current = null;
    automaticMenuCloseTokenRef.current = null;
    const opened = pane && x < closedXRef.current - GESTURE.menuEdgeTolerancePx;
    useUiStore.setState({ menuVisible: opened, menuIconOpen: opened });
  }, [pane]);

  const scheduleAutomaticMenuClose = useCallback(
    (token: number) => {
      scheduleDrawerCloseAfterRender(
        token,
        () => scrollXRef.current >= closedXRef.current - GESTURE.menuEdgeTolerancePx,
        () => {
          automaticMenuCloseTokenRef.current = token;
          closeMenuImplRef.current?.();
        },
        interruptAutomaticMenuClose,
      );
    },
    [interruptAutomaticMenuClose],
  );

  // ユーザーのタッチ／ドラッグは、進行中の自動クローズや古い遷移要求より優先する。
  const cancelMenuControlForUser = useCallback(() => {
    const shouldStopNativeMotion =
      menuTargetRef.current !== null ||
      automaticMenuCloseTokenRef.current !== null ||
      pendingMenuCloseRef.current !== null ||
      pendingMenuCloseFrameRef.current !== null;
    cancelDrawerCloseTransition();
    if (pendingMenuCloseFrameRef.current !== null) {
      cancelAnimationFrame(pendingMenuCloseFrameRef.current);
      pendingMenuCloseFrameRef.current = null;
    }
    pendingMenuCloseRef.current = null;
    automaticMenuCloseTokenRef.current = null;
    if (!shouldStopNativeMotion) return;

    const x = Math.max(0, Math.min(closedXRef.current, scrollXRef.current));
    scrollRef.current?.scrollTo({ x, y: 0, animated: false });
    scrollXRef.current = x;
    setScrollX(x);
    menuTargetRef.current = null;
    menuGestureStartXRef.current = null;
    menuIconTransitionRef.current = null;
    const opened = pane && x < closedXRef.current - GESTURE.menuEdgeTolerancePx;
    useUiStore.setState({ menuVisible: opened, menuIconOpen: opened });
  }, [pane]);

  /** 指定のカンバンが見える位置までスクロールする */
  const scrollToColumn = useCallback(
    (index: number) => {
      const current = nearestOffsetIndex(offsets, scrollXRef.current);
      if (geo.compact) return scrollToX(offsets[Math.min(index, offsets.length - 1)] ?? 0);
      if (index < current) scrollToX(offsets[index] ?? 0);
      else if (index > current + geo.visible - 1)
        scrollToX(offsets[Math.min(index - geo.visible + 1, offsets.length - 1)] ?? 0);
    },
    [geo, offsets, scrollToX],
  );

  useImperativeHandle(ref, () => ({ scrollToColumn }), [scrollToColumn]);

  // メニューの開閉は、このスクロール位置だけで決まる（メニューが開いている = 左端付近）
  useEffect(() => {
    if (!pane) return;

    const clearPendingCloseCallback = () => {
      if (pendingMenuCloseFrameRef.current !== null) {
        cancelAnimationFrame(pendingMenuCloseFrameRef.current);
        pendingMenuCloseFrameRef.current = null;
      }
      pendingMenuCloseRef.current = null;
    };

    const open = () => {
      // 手動の開閉要求は、描画後に予定されている自動クローズより優先する。
      cancelDrawerCloseTransition();
      clearPendingCloseCallback();
      menuGestureStartXRef.current = null;
      menuIconTransitionRef.current = null;
      menuTargetRef.current = true;
      useUiStore.setState({ menuVisible: true, menuIconOpen: true });
      scrollToX(0);
    };

    const applyClose = () => {
      clearPendingCloseCallback();
      menuGestureStartXRef.current = null;
      menuIconTransitionRef.current = null;
      menuTargetRef.current = false;
      useUiStore.setState({ menuVisible: false, menuIconOpen: false });
      scrollToX(closedXRef.current);
    };

    const close = () => {
      // 明示的な閉じる操作は、古い自動クローズをキャンセルしてから開始する。
      cancelDrawerCloseTransition();
      applyClose();
    };

    const closeAfterRender = () => {
      // 共通スケジューラ自身が起動したクローズでは、active transition を再キャンセルしない。
      applyClose();
    };

    const closeAndThen = (afterClose: () => void) => {
      close();
      pendingMenuCloseRef.current = afterClose;
      // すでに閉じ位置にある場合は scroll イベントを待たずに続行する。
      if (scrollXRef.current >= closedXRef.current - GESTURE.menuEdgeTolerancePx) {
        pendingMenuCloseRef.current = null;
        afterClose();
      }
    };

    closeMenuImplRef.current = closeAfterRender;
    const unregister = registerBoardMenu({
      open,
      close,
      closeAndThen,
      toggle: () => (useUiStore.getState().menuIconOpen ? close() : open()),
    });
    return () => {
      if (closeMenuImplRef.current === close) closeMenuImplRef.current = null;
      unregister();
    };
  }, [pane, menuWidth, scrollToX]);

  useEffect(() => {
    if (!pane) {
      menuGestureStartXRef.current = null;
      menuIconTransitionRef.current = null;
      useUiStore.setState({ menuVisible: false, menuIconOpen: false });
    }
  }, [pane]);

  // 初回表示と同一プロジェクト内のレイアウト変更を処理する。
  // プロジェクトID変更は下の専用effectだけに任せ、同時に2回スクロールを指示しない。
  useEffect(() => {
    if (!pane || size.width === 0 || lastResetKeyRef.current !== props.resetKey) return;
    if (menuTargetRef.current !== null || menuGestureStartXRef.current !== null) return;

    const isInitialPlacement = !didInitialPlacementRef.current;
    const resetKey = props.resetKey;
    const frame = requestAnimationFrame(() => {
      // 描画待ちの間にプロジェクトやユーザー操作が変わった場合、古い初期化を適用しない。
      if (
        lastResetKeyRef.current !== resetKey ||
        menuTargetRef.current !== null ||
        menuGestureStartXRef.current !== null
      ) {
        return;
      }
      const keepMenuOpen = useUiStore.getState().menuVisible;
      const initialX = keepMenuOpen ? 0 : closedXRef.current;
      scrollRef.current?.scrollTo({ x: initialX, y: 0, animated: false });
      scrollXRef.current = initialX;
      setScrollX(initialX);
      const initialPage = nearestOffsetIndex(offsets, initialX);
      activePageIndexRef.current = initialPage;
      setActivePageIndex(initialPage);
      scrollUiSnapshotRef.current = {
        page: initialPage,
        menuVisible: keepMenuOpen,
        canScrollLeft: initialX > (offsets[0] ?? 0) + UI_METRICS.scroll.positionTolerancePx,
        canScrollRight: initialX < maxOffset - UI_METRICS.scroll.positionTolerancePx,
      };
      scrollAnim.setValue(initialX);
      useUiStore.setState({ menuVisible: keepMenuOpen, menuIconOpen: keepMenuOpen });
      didInitialPlacementRef.current = true;
      if (isInitialPlacement) {
        const closeToken = consumeBoardMenuCloseAfterProjectRender(props.resetKey);
        if (closeToken !== null) scheduleAutomaticMenuClose(closeToken);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    pane,
    size.width,
    menuWidth,
    offsets,
    maxOffset,
    scrollAnim,
    props.resetKey,
    scheduleAutomaticMenuClose,
  ]);

  // プロジェクトID変更時の位置更新はここだけで行う。
  // メニューが開いている場合、ネイティブスクロールを0へ再指示せず、現在の開いた位置と
  // 進行中の指操作を維持する。閉じている場合だけ新プロジェクトの最初のカンバン位置へ合わせる。
  useEffect(() => {
    if (lastResetKeyRef.current === props.resetKey) return;
    lastResetKeyRef.current = props.resetKey;
    didInitialPlacementRef.current = true;

    const keepMenuOpen = pane && useUiStore.getState().menuVisible;
    let resetX = pane ? (keepMenuOpen ? scrollXRef.current : closedXRef.current) : 0;
    resetX = Math.max(0, Math.min(maxOffset, resetX));

    if (!keepMenuOpen) {
      menuTargetRef.current = null;
      menuGestureStartXRef.current = null;
      menuIconTransitionRef.current = null;
      automaticMenuCloseTokenRef.current = null;
      scrollRef.current?.scrollTo({ x: resetX, y: 0, animated: false });
      scrollXRef.current = resetX;
      setScrollX(resetX);
      scrollAnim.setValue(resetX);
    }

    const resetPage = nearestOffsetIndex(offsets, resetX);
    activePageIndexRef.current = resetPage;
    setActivePageIndex(resetPage);
    scrollUiSnapshotRef.current = {
      page: resetPage,
      menuVisible: keepMenuOpen,
      canScrollLeft: resetX > (offsets[0] ?? 0) + UI_METRICS.scroll.positionTolerancePx,
      canScrollRight: resetX < maxOffset - UI_METRICS.scroll.positionTolerancePx,
    };
    useUiStore.setState({ menuVisible: keepMenuOpen, menuIconOpen: keepMenuOpen });

    const closeToken = consumeBoardMenuCloseAfterProjectRender(props.resetKey);
    if (closeToken !== null) scheduleAutomaticMenuClose(closeToken);
  }, [props.resetKey, pane, offsets, maxOffset, scrollAnim, scheduleAutomaticMenuClose]);

  // キーボードのカーソルが画面外のカンバンに移ったら、そこまでスクロールする
  useEffect(() => {
    if (cursor && size.width > 0) scrollToColumn(cursor.columnIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor?.columnIndex, size.width]);

  const blurInputs = () => {
    Keyboard.dismiss();
    setBlurSignal((n) => n + 1);
  };

  const onScrollEvent = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const previousX = scrollXRef.current;
    const target = menuTargetRef.current;

    // 反対方向の古いスクロール通知が新しい開閉指示の状態を上書きしないようにする。
    // プログラムで開くときはxが減り、閉じるときはxが増えるイベントだけを受け付ける。
    if (
      target !== null &&
      (target
        ? x > previousX + UI_METRICS.scroll.positionTolerancePx
        : x < previousX - UI_METRICS.scroll.positionTolerancePx)
    ) {
      return;
    }
    if (Platform.OS === 'web') scrollAnim.setValue(x);

    if (pane && menuGestureStartXRef.current !== null) {
      const startX = menuGestureStartXRef.current;
      const transition = menuIconTransitionRef.current;
      if (transition === 'opening' && x >= startX - GESTURE.menuIconRollbackTolerancePx) {
        useUiStore.setState({ menuIconOpen: false });
        menuIconTransitionRef.current = null;
      } else if (transition === 'closing' && x <= startX + GESTURE.menuIconRollbackTolerancePx) {
        useUiStore.setState({ menuIconOpen: true });
        menuIconTransitionRef.current = null;
      } else if (transition === null) {
        const iconOpen = useUiStore.getState().menuIconOpen;
        const delta = x - previousX;
        if (!iconOpen && startX >= closedXRef.current - GESTURE.menuEdgeTolerancePx && delta < 0) {
          menuIconTransitionRef.current = 'opening';
          useUiStore.setState({ menuIconOpen: true });
        } else if (iconOpen && startX <= GESTURE.menuEdgeTolerancePx && delta > 0) {
          menuIconTransitionRef.current = 'closing';
          useUiStore.setState({ menuIconOpen: false });
        }
      }
    }

    scrollXRef.current = x;
    finishPendingMenuClose(x);
    // ページ番号はスクロール中に独立して更新し、フッター表示をカンバン移動に即時追従させる。
    const nextPage = updateActivePage(x);

    // アニメーション自体は Animated.Value で毎フレーム追従させ、React の再描画は
    // ページ・メニュー開閉・前後ボタンの表示が切り替わるときだけに限定する。
    const nextMenuVisible = pane && x < closedXRef.current - GESTURE.menuEdgeTolerancePx;
    const nextSnapshot: ScrollUiSnapshot = {
      page: nextPage,
      menuVisible: nextMenuVisible,
      canScrollLeft: x > (offsets[0] ?? 0) + UI_METRICS.scroll.positionTolerancePx,
      canScrollRight: x < maxOffset - UI_METRICS.scroll.positionTolerancePx,
    };
    const previousSnapshot = scrollUiSnapshotRef.current;
    const uiChanged =
      !previousSnapshot ||
      previousSnapshot.page !== nextSnapshot.page ||
      previousSnapshot.menuVisible !== nextSnapshot.menuVisible ||
      previousSnapshot.canScrollLeft !== nextSnapshot.canScrollLeft ||
      previousSnapshot.canScrollRight !== nextSnapshot.canScrollRight;
    scrollUiSnapshotRef.current = nextSnapshot;
    if (uiChanged) setScrollX(x);

    const reachedTarget =
      target === true
        ? x <= GESTURE.menuEdgeTolerancePx
        : target === false
          ? x >= closedXRef.current - GESTURE.menuEdgeTolerancePx
          : false;
    // 到達しただけでは target を消さない。古い onScrollEnd が残っている可能性があるため、
    // 対象位置でスクロール終了イベントも確認してからプログラム操作を確定する。
    if (target === false && reachedTarget && automaticMenuCloseTokenRef.current !== null) {
      finishDrawerCloseAfterRender(automaticMenuCloseTokenRef.current);
      automaticMenuCloseTokenRef.current = null;
    }
    if (menuTargetRef.current === null && useUiStore.getState().menuVisible !== nextMenuVisible) {
      useUiStore.setState({ menuVisible: nextMenuVisible });
    }
  };
  // Web では Animated.event の値反映が描画フレームより遅れることがあるため、
  // 実際の scroll イベント内でヘッダー／フッター用の Animated.Value を同期する。
  // ネイティブは従来どおり native driver を使い、JS 再描画を毎フレーム発生させない。
  const onScroll =
    Platform.OS === 'web'
      ? (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          onScrollEvent(event);
        }
      : Animated.event([{ nativeEvent: { contentOffset: { x: scrollAnim } } }], {
          useNativeDriver: true,
          listener: onScrollEvent,
        });
  const onScrollEnd = (
    e: NativeSyntheticEvent<NativeScrollEvent>,
    finalizeMenuGesture: boolean,
  ) => {
    const x = e.nativeEvent.contentOffset.x;
    // 直前のスクロールの終了通知が遅れて届いても、現在の開閉指示を上書きしない。
    const target = menuTargetRef.current;
    const reachedTarget =
      target === true
        ? x <= GESTURE.menuEdgeTolerancePx
        : target === false
          ? x >= closedXRef.current - GESTURE.menuEdgeTolerancePx
          : false;
    if (target !== null && !reachedTarget) return;
    if (reachedTarget) menuTargetRef.current = null;
    scrollXRef.current = x;
    finishPendingMenuClose(x);
    if (
      x >= closedXRef.current - GESTURE.menuEdgeTolerancePx &&
      automaticMenuCloseTokenRef.current !== null
    ) {
      finishDrawerCloseAfterRender(automaticMenuCloseTokenRef.current);
      automaticMenuCloseTokenRef.current = null;
    }
    const nextPage = updateActivePage(x);
    const nextMenuVisible = pane && x < closedXRef.current - GESTURE.menuEdgeTolerancePx;
    // スクロール終了時にも snapshot を同期し、次のドラッグで誤って再描画が止まらないようにする。
    scrollUiSnapshotRef.current = {
      page: nextPage,
      menuVisible: nextMenuVisible,
      canScrollLeft: x > (offsets[0] ?? 0) + UI_METRICS.scroll.positionTolerancePx,
      canScrollRight: x < maxOffset - UI_METRICS.scroll.positionTolerancePx,
    };
    setScrollX(x);
    if (menuTargetRef.current === null && useUiStore.getState().menuVisible !== nextMenuVisible) {
      useUiStore.setState({ menuVisible: nextMenuVisible });
    }
    // スナップ位置に到達した時点で、アイコンを最終状態へ同期する。
    // ドラッグ開始時の即時切替は維持し、スナップが開始位置へ戻った場合も正しく戻す。
    const snapIndex = nearestOffsetIndex(snapOffsets, x);
    const snapX = snapOffsets[snapIndex] ?? x;
    if (
      menuTargetRef.current === null &&
      (finalizeMenuGesture || menuIconTransitionRef.current === null) &&
      Math.abs(snapX - x) <= GESTURE.menuSnapSettleTolerancePx
    ) {
      const iconOpen = pane && snapIndex === 0;
      if (useUiStore.getState().menuIconOpen !== iconOpen) {
        useUiStore.setState({ menuIconOpen: iconOpen });
      }
      menuGestureStartXRef.current = null;
      menuIconTransitionRef.current = null;
    }
  };

  const onScrollBeginDrag = () => {
    cancelMenuControlForUser();
    menuGestureStartXRef.current = scrollXRef.current;
    menuIconTransitionRef.current = null;
    blurInputs();
  };
  // メニューの開閉に合わせてヘッダー／フッターを移動する。
  // closedX より先のカンバン横スクロールでは補間値が 0 で固定される。
  const headerShift = useMemo(
    () =>
      scrollAnim.interpolate({
        inputRange: [0, Math.max(1, closedX)],
        outputRange: [closedX, 0],
        extrapolate: 'clamp',
      }),
    [scrollAnim, closedX],
  );

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  // ---- ドラッグ ----
  const updateHover = () => {
    const idx = columnIndexAt(
      pointer.current.x,
      scrollXRef.current,
      { ...geo, padding: geo.padding + menuShift },
      columns.length,
    );
    if (idx !== hoverRef.current) {
      hoverRef.current = idx;
      setHoverIndex(idx);
    }
  };

  const begin = (info: DragInfo, absX: number, absY: number) => {
    blurInputs();
    containerRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
      pointer.current = { x: absX - x, y: absY - y };
      pos.setValue({ x: absX - x, y: absY - y });
      updateHover();
    });
    dragRef.current = info;
    setDragInfo(info);
    if (isTouchWeb) document.addEventListener('touchmove', preventTouchMove, { passive: false });
    edge.current = { side: 0, since: 0 };
  };

  const move = (absX: number, absY: number) => {
    pointer.current = { x: absX - origin.current.x, y: absY - origin.current.y };
    pos.setValue(pointer.current);
    updateHover();
  };

  const end = async (cancelled: boolean) => {
    if (isTouchWeb) document.removeEventListener('touchmove', preventTouchMove);
    const info = dragRef.current;
    const idx = hoverRef.current;
    dragRef.current = null;
    hoverRef.current = null;
    setDragInfo(null);
    setHoverIndex(null);
    if (!info || cancelled || idx === null) return;
    const target = columns[idx];
    if (!target) return;
    if (info.kind === 'column') return props.onColumnDrop(info.column, idx);

    // 手動並び順では、同じカンバン内にドロップした位置へタスクを並べ替える。
    if (info.task.columnId === target.id && target.sortMode === 'manual') {
      const dropY = origin.current.y + pointer.current.y;
      const columnTasks = props.tasksOf(target.id);
      const groupTasks = columnTasks.filter(
        (task) => task.id !== info.task.id && task.isFavorite === info.task.isFavorite,
      );
      const centers = await Promise.all(
        groupTasks.map(
          (task) =>
            new Promise<number | null>((resolve) => {
              const node = taskNodeRefs.current.get(task.id);
              if (!node) {
                resolve(null);
                return;
              }
              node.measureInWindow((_x, y, _width, height) => resolve(y + height / 2));
            }),
        ),
      );
      const positionInGroup = centers.filter((center) => center !== null && center < dropY).length;
      const favoriteCount = columnTasks.filter(
        (task) => task.id !== info.task.id && task.isFavorite,
      ).length;
      const manualIndex = (info.task.isFavorite ? 0 : favoriteCount) + positionInGroup;
      props.onTaskDrop(info.task, target, manualIndex);
      return;
    }

    props.onTaskDrop(info.task, target);
  };

  // 画面の左右端に一定時間留まると、隣のカンバンへスクロールする
  useEffect(() => {
    if (!dragInfo) return;
    const timer = setInterval(() => {
      const x = pointer.current.x;
      const side = x < GESTURE.edgeZone ? -1 : x > size.width - GESTURE.edgeZone ? 1 : 0;
      const now = Date.now();
      if (side === 0) {
        edge.current = { side: 0, since: 0 };
        return;
      }
      if (edge.current.side !== side) {
        edge.current = { side, since: now };
        return;
      }
      if (now - edge.current.since >= GESTURE.edgeDwellMs) {
        const next = adjacentOffset(offsets, scrollXRef.current, side);
        if (next !== null) scrollToX(next);
        edge.current = { side, since: now };
        setTimeout(updateHover, GESTURE.edgeScrollSettleMs);
      }
    }, GESTURE.edgeScrollCheckIntervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragInfo, size.width, offsets]);

  const taskDragHandlers = (task: Task): DragHandlers => ({
    begin: (x, y, grab) => begin({ kind: 'task', task, grab }, x, y),
    move,
    end,
  });
  const columnDragHandlers = (column: KanbanColumn): DragHandlers => ({
    begin: (x, y, grab) => begin({ kind: 'column', column, grab }, x, y),
    move,
    end,
  });

  const page = activePageIndex;
  const showButtons = geo.peek > 0;
  // インジケーターのフッターを確保し、タスク一覧がその下に入り込まない高さにする。
  const pagerHeight = geo.compact && columns.length > 1 ? UI_METRICS.board.pagerReservedHeight : 0;
  const columnHeight = Math.max(0, size.height - headerOffset - pagerHeight);

  return (
    <View style={styles.fill}>
      {!pane ? (header?.(true) ?? null) : null}
      <View ref={containerRef} style={styles.fill} onLayout={onLayout} collapsable={false}>
        {columns.length === 0 && props.showEmptyState !== false && !pane ? (
          <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
        ) : size.width > 0 ? (
          <>
            <Animated.ScrollView
              ref={scrollRef}
              onTouchStart={cancelMenuControlForUser}
              contentOffset={initialContentOffset}
              horizontal
              snapToOffsets={
                Platform.OS === 'web' ? undefined : snapOffsets.length > 1 ? snapOffsets : undefined
              }
              decelerationRate="fast"
              disableIntervalMomentum={geo.compact}
              showsHorizontalScrollIndicator={!geo.compact}
              persistentScrollbar={!geo.compact}
              indicatorStyle={isDark ? 'white' : 'black'}
              onScroll={onScroll}
              onScrollEndDrag={(event) => onScrollEnd(event, false)}
              onMomentumScrollEnd={(event) => onScrollEnd(event, true)}
              onScrollBeginDrag={onScrollBeginDrag}
              scrollEventThrottle={TIMING.scrollEventThrottleMs}
              scrollEnabled={!dragInfo}
              style={[
                Platform.OS === 'web'
                  ? ({
                      touchAction: 'pan-x pan-y',
                      WebkitOverflowScrolling: 'touch',
                      overscrollBehaviorX: 'contain',
                      scrollSnapType: geo.compact ? 'x mandatory' : undefined,
                      WebkitScrollSnapType: geo.compact ? 'x mandatory' : undefined,
                    } as never)
                  : undefined,
              ]}
              contentContainerStyle={{
                // 横スクロールの内容領域を viewport の高さに固定し、ルート切替直後の
                // size.height 再計測でメニューのフッターが上下するのを防ぐ。
                height: '100%',
                // ヘッダー分の縦位置は各カンバンのページ側で確保する。
                // コンテナーに paddingTop を置くと、100% 高さのメニュー領域がその分縮む。
                paddingTop: 0,
                paddingBottom: 0,
                paddingHorizontal: geo.padding,
                gap: BOARD.columnGap,
              }}
            >
              {pane ? (
                <View
                  style={[
                    styles.menuPane,
                    {
                      width: menuWidth,
                      height: '100%',
                      marginLeft: -geo.padding,
                      marginRight: Platform.OS === 'web' ? -BOARD.columnGap / 2 : undefined,
                      marginTop: 0,
                    },
                    Platform.OS === 'web' && geo.compact
                      ? ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as never)
                      : undefined,
                  ]}
                >
                  <Sidebar
                    width={menuWidth}
                    showMenuIcon={false}
                    onToggle={closeBoardMenu}
                    onSwipeClose={closeBoardMenu}
                  />
                </View>
              ) : null}
              {pane && columns.length === 0 && props.showEmptyState === false ? (
                // 削除済みプロジェクトでは右側を空にするが、横スクロールのページ幅は
                // 保持し、メニューを開閉できるようにする。
                <View
                  key="empty-deleted-project-page"
                  pointerEvents="none"
                  style={{ width: geo.columnWidth, height: size.height, flexShrink: 0 }}
                />
              ) : null}
              {Platform.OS === 'web' && webInlineChrome && header ? (
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.webChromeSticky,
                    {
                      width: size.width,
                      height: size.height,
                      // ScrollView の中で、最初のカンバンが始まる座標に置く。
                      // position: sticky により、メニューの開閉は横スクロールと同時に動き、
                      // カンバンを次へ横スクロールしても左端に固定される。
                      marginLeft: closedX - menuWidth - BOARD.columnGap / 2,
                      marginRight: menuWidth - closedX - size.width - BOARD.columnGap / 2,
                    } as never,
                  ]}
                >
                  <View
                    style={[
                      styles.headerOverlay,
                      {
                        left: 0,
                        width: size.width,
                        height: BOARD.headerHeight,
                      },
                    ]}
                  >
                    {header?.(true) ?? null}
                  </View>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.headerLineBridge,
                      {
                        left: menuWidth - closedX,
                        width: menuEdgeWidth,
                        top: BOARD.headerHeight - lineWidth,
                        height: lineWidth,
                        backgroundColor: lineColor,
                        opacity: menuBridgeOpacity,
                      },
                    ]}
                  />
                  {pagerHeight > 0 ? (
                    <>
                      <Animated.View
                        pointerEvents={menuVisible ? 'none' : 'auto'}
                        style={[
                          styles.pagerFooter,
                          {
                            left: 0,
                            right: 0,
                            height: pagerHeight,
                            opacity: pagerOpacity,
                            backgroundColor: colors.bg,
                            borderTopWidth: BORDER_WIDTH_NONE,
                          },
                        ]}
                      >
                        <View style={styles.dots}>
                          {columns.map((c, i) => (
                            <Pressable
                              key={c.id}
                              accessibilityRole="button"
                              accessibilityLabel={c.title}
                              onPress={() => scrollToX(offsets[i] ?? 0)}
                              hitSlop={HIT_SLOP.control}
                            >
                              <View
                                style={[
                                  styles.dot,
                                  { backgroundColor: i === page ? colors.text : colors.border },
                                ]}
                              />
                            </Pressable>
                          ))}
                          <AppText variant="caption" muted style={styles.pageText}>
                            {t('board.pageIndicator', { index: page + 1, total: columns.length })}
                          </AppText>
                        </View>
                      </Animated.View>
                      {/* フッター本体はメニュー表示中に隠すが、境界線は独立させて残す。 */}
                      <View
                        pointerEvents="none"
                        style={[
                          styles.footerLineOverlay,
                          {
                            left: 0,
                            right: 0,
                            bottom: pagerHeight - lineWidth,
                            height: lineWidth,
                            backgroundColor: lineColor,
                          },
                        ]}
                      />
                      <View
                        pointerEvents="none"
                        style={[
                          styles.footerLineBridge,
                          {
                            left: menuWidth - closedX,
                            width: menuEdgeWidth,
                            bottom: pagerHeight - lineWidth,
                            height: lineWidth,
                            backgroundColor: lineColor,
                            opacity: menuBridgeOpacity,
                          },
                        ]}
                      />
                    </>
                  ) : null}
                </View>
              ) : null}
              {columns.length === 0 && props.showEmptyState !== false ? (
                webInlineChrome ? (
                  <View
                    key="web-empty-page"
                    style={[styles.webColumnPage, { width: geo.columnWidth, height: size.height }]}
                  >
                    <View
                      pointerEvents="none"
                      style={[
                        styles.webPageHeader,
                        { width: geo.columnWidth, height: headerOffset },
                      ]}
                    />
                    <View
                      style={{
                        width: geo.columnWidth,
                        height: columnHeight,
                        justifyContent: 'center',
                      }}
                    >
                      <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
                    </View>
                    {pagerHeight > 0 ? <View style={{ height: pagerHeight }} /> : null}
                  </View>
                ) : (
                  <View
                    style={{
                      width: geo.columnWidth,
                      height: columnHeight,
                      marginTop: pane ? headerOffset : 0,
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
                  </View>
                )
              ) : null}
              {columns.map((column, index) => {
                const snapAlign =
                  Platform.OS === 'web' && geo.compact
                    ? index === 0
                      ? 'start'
                      : 'center'
                    : undefined;
                const columnView = (
                  <ColumnView
                    key={column.id}
                    column={column}
                    tasks={tasksOf(column.id)}
                    index={index}
                    count={columns.length}
                    width={geo.columnWidth}
                    height={columnHeight}
                    webSnapAlign={webInlineChrome ? undefined : snapAlign}
                    webSnapPadding={geo.padding}
                    boardEdgePadding={geo.padding}
                    compactCards={props.compactCards}
                    detailedCards={props.detailedCards}
                    showTaskDescription={props.showTaskDescription}
                    showTaskDueDate={props.showTaskDueDate}
                    showTaskUpdatedAt={props.showTaskUpdatedAt}
                    showTaskMetadataIcons={showTaskMetadataIcons}
                    cursorTaskIndex={
                      cursor && cursor.columnIndex === index ? cursor.taskIndex : null
                    }
                    grabbed={!!cursor?.grabbed}
                    dropTarget={
                      dragInfo !== null &&
                      hoverIndex === index &&
                      !(dragInfo.kind === 'column' && dragInfo.column.id === column.id)
                    }
                    draggingTaskId={dragInfo?.kind === 'task' ? dragInfo.task.id : null}
                    draggingColumn={dragInfo?.kind === 'column' && dragInfo.column.id === column.id}
                    menuItems={props.menuItemsFor(column, index)}
                    taskMenu={props.taskMenuFor}
                    onAdvance={props.onAdvance}
                    onAddTask={() => props.onAddTask(column)}
                    onCopyTitle={props.onCopyTitle}
                    onCopyDescription={props.onCopyDescription}
                    connectHeaderLineToMenu={pane && index === 0}
                    onTaskMeasure={(taskId, node) => {
                      if (node) taskNodeRefs.current.set(taskId, node);
                      else taskNodeRefs.current.delete(taskId);
                    }}
                    taskDrag={taskDragHandlers}
                    columnDrag={columnDragHandlers(column)}
                    blurSignal={blurSignal}
                    onRefresh={props.onRefresh}
                  />
                );

                if (!webInlineChrome) {
                  if (!pane || headerOffset === 0) return columnView;
                  // native / medium web ではコンテンツだけをヘッダーの下へ置き、
                  // ScrollView 全体の高さや左の Sidebar の高さは変えない。
                  return (
                    <View
                      key={`column-page-${column.id}`}
                      style={{
                        width: geo.columnWidth,
                        height: columnHeight,
                        marginTop: headerOffset,
                        flexShrink: 0,
                      }}
                    >
                      {columnView}
                    </View>
                  );
                }

                return (
                  <View
                    key={`web-page-${column.id}`}
                    style={[
                      styles.webColumnPage,
                      { width: geo.columnWidth, height: size.height },
                      snapAlign
                        ? ({
                            scrollSnapAlign: snapAlign,
                            scrollSnapStop: 'always',
                            scrollMarginLeft: snapAlign === 'start' ? geo.padding : 0,
                          } as never)
                        : undefined,
                    ]}
                  >
                    <View
                      pointerEvents="none"
                      style={[
                        styles.webPageHeader,
                        {
                          width: geo.columnWidth,
                          height: headerOffset,
                        },
                      ]}
                    />
                    {columnView}
                    {pagerHeight > 0 ? (
                      <View pointerEvents="none" style={{ height: pagerHeight }} />
                    ) : null}
                  </View>
                );
              })}
              {Platform.OS === 'web' && pane && header && !webInlineChrome ? (
                <>
                  <View
                    style={[
                      styles.headerOverlay,
                      { left: closedX, width: size.width, height: BOARD.headerHeight },
                    ]}
                  >
                    {header?.(true) ?? null}
                  </View>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.headerLineBridge,
                      {
                        left: menuWidth,
                        width: Math.max(0, closedX - menuWidth),
                        top: BOARD.headerHeight - lineWidth,
                        height: lineWidth,
                        backgroundColor: lineColor,
                      },
                    ]}
                  />
                </>
              ) : null}
              {Platform.OS === 'web' && pagerHeight > 0 && !webInlineChrome ? (
                <Animated.View
                  pointerEvents={menuVisible ? 'none' : 'auto'}
                  style={[
                    styles.pagerFooter,
                    {
                      opacity: pagerOpacity,
                      height: pagerHeight,
                      left: menuWidth,
                      width: Math.max(0, size.width + closedX - menuWidth),
                      backgroundColor: colors.bg,
                      borderTopColor: lineColor,
                      borderTopWidth: lineWidth,
                    },
                  ]}
                >
                  <View style={styles.dots}>
                    {columns.map((c, i) => (
                      <Pressable
                        key={c.id}
                        accessibilityRole="button"
                        accessibilityLabel={c.title}
                        onPress={() => scrollToX(offsets[i] ?? 0)}
                        hitSlop={HIT_SLOP.control}
                      >
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: i === page ? colors.text : colors.border },
                          ]}
                        />
                      </Pressable>
                    ))}
                    <AppText variant="caption" muted style={styles.pageText}>
                      {t('board.pageIndicator', { index: page + 1, total: columns.length })}
                    </AppText>
                  </View>
                </Animated.View>
              ) : null}
            </Animated.ScrollView>

            {showButtons ? (
              <>
                {scrollX > (offsets[0] ?? 0) + UI_METRICS.scroll.positionTolerancePx ? (
                  <View
                    pointerEvents="box-none"
                    style={[styles.navBtn, styles.navLeft, { width: geo.peek }]}
                  >
                    <IconButton
                      icon="left"
                      label={t('board.prev')}
                      box={ICON_BUTTON_BOX.navigation}
                      onPress={() =>
                        scrollToX(adjacentOffset(offsets, scrollXRef.current, -1) ?? 0)
                      }
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: controlLineWidth,
                        borderColor: controlLineColor,
                      }}
                    />
                  </View>
                ) : null}
                {scrollX < maxOffset - UI_METRICS.scroll.positionTolerancePx ? (
                  <View
                    pointerEvents="box-none"
                    style={[styles.navBtn, styles.navRight, { width: geo.peek }]}
                  >
                    <IconButton
                      icon="right"
                      label={t('board.next')}
                      box={ICON_BUTTON_BOX.navigation}
                      onPress={() =>
                        scrollToX(adjacentOffset(offsets, scrollXRef.current, 1) ?? maxOffset)
                      }
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: controlLineWidth,
                        borderColor: controlLineColor,
                      }}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            {Platform.OS !== 'web' && pagerHeight > 0 ? (
              <Animated.View
                pointerEvents={menuVisible ? 'none' : 'auto'}
                style={[
                  styles.pagerFooter,
                  {
                    opacity: pagerOpacity,
                    height: pagerHeight,
                    left: 0,
                    right: 0,
                    backgroundColor: colors.bg,
                    transform: [{ translateX: pane ? headerShift : 0 }],
                  },
                ]}
              >
                <View style={styles.dots}>
                  {columns.map((c, i) => (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      accessibilityLabel={c.title}
                      onPress={() => scrollToX(offsets[i] ?? 0)}
                      hitSlop={HIT_SLOP.control}
                    >
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: i === page ? colors.text : colors.border },
                        ]}
                      />
                    </Pressable>
                  ))}
                  <AppText variant="caption" muted style={styles.pageText}>
                    {t('board.pageIndicator', { index: page + 1, total: columns.length })}
                  </AppText>
                </View>
              </Animated.View>
            ) : null}
          </>
        ) : null}

        {dragInfo ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ghost,
              SHADOW.float,
              {
                width: dragInfo.grab?.w ?? UI_METRICS.board.dragPreviewWidth,
                minHeight: dragInfo.grab?.h ?? UI_METRICS.board.dragPreviewDefaultHeight,
                backgroundColor: colors.surface,
                borderColor: colors.accent,
                // つかんだ位置が指の下になるよう、カードの左上から見た指の位置ぶんずらす
                transform: [
                  {
                    translateX: Animated.subtract(
                      pos.x,
                      dragInfo.grab?.ox ?? UI_METRICS.board.dragPreviewOffsetX,
                    ),
                  },
                  {
                    translateY: Animated.subtract(
                      pos.y,
                      dragInfo.grab?.oy ?? UI_METRICS.board.dragPreviewOffsetY,
                    ),
                  },
                ],
              },
            ]}
          >
            <AppText bold numberOfLines={UI_METRICS.text.previewLines}>
              {dragInfo.kind === 'task' ? dragInfo.task.title : dragInfo.column.title}
            </AppText>
          </Animated.View>
        ) : null}

        {Platform.OS !== 'web' && pane && header ? (
          <>
            <Animated.View
              style={[
                styles.headerOverlay,
                {
                  left: 0,
                  right: 0,
                  height: BOARD.headerHeight,
                  transform: [{ translateX: headerShift }],
                },
              ]}
            >
              {header?.(true) ?? null}
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.headerLineBridge,
                {
                  left: menuWidth - closedX,
                  width: menuEdgeWidth,
                  top: BOARD.headerHeight - lineWidth,
                  height: lineWidth,
                  backgroundColor: lineColor,
                  transform: [{ translateX: headerShift }],
                },
              ]}
            />
          </>
        ) : null}

        {Platform.OS !== 'web' && pane && pagerHeight > 0 ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.footerLineOverlay,
                {
                  left: 0,
                  right: 0,
                  bottom: pagerHeight - lineWidth,
                  height: lineWidth,
                  backgroundColor: lineColor,
                  transform: [{ translateX: headerShift }],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.footerLineBridge,
                {
                  left: menuWidth - closedX,
                  width: menuEdgeWidth,
                  bottom: pagerHeight - lineWidth,
                  height: lineWidth,
                  backgroundColor: lineColor,
                  transform: [{ translateX: headerShift }],
                },
              ]}
            />
          </>
        ) : null}
      </View>
      {Platform.OS === 'web' && mode === 'compact' && customOuterBorder ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.columnHeaderGlobalBridge,
            {
              // Sidebar 内ではなく BoardView 直下に描画し、次のカンバンやサイドバーの縁マスクに覆われないようにする。
              // 縦線の内側からカンバン側へ 2px 重ね、線幅設定にかかわらず隙間を作らない。
              left: menuWidth - lineWidth,
              top: BOARD.headerHeight + BOARD.touchTarget - lineWidth,
              width: lineWidth + 2,
              height: lineWidth,
              backgroundColor: lineColor,
              opacity: menuBridgeOpacity,
            },
          ]}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menuPane: { flexDirection: 'row' },
  webChromeSticky: {
    position: 'sticky',
    left: 0,
    top: 0,
    zIndex: LAYER.boardChrome,
    flexShrink: 0,
    overflow: 'visible',
  } as never,
  webColumnPage: {
    position: 'relative',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'visible',
  },
  webPageHeader: { flexShrink: 0, alignSelf: 'flex-start', zIndex: LAYER.boardChrome },
  headerOverlay: { position: 'absolute', top: 0, zIndex: LAYER.boardChrome },
  headerLineBridge: { position: 'absolute', zIndex: LAYER.boardChrome },
  footerLineOverlay: { position: 'absolute', zIndex: LAYER.boardChrome },
  footerLineBridge: { position: 'absolute', zIndex: LAYER.boardChrome },
  columnHeaderGlobalBridge: { position: 'absolute', zIndex: LAYER.sidebarEdge + 1 },
  navBtn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navLeft: { left: UI_METRICS.board.navigationButtonInset },
  navRight: { right: UI_METRICS.board.navigationButtonInset },
  pagerFooter: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: LAYER.boardFooter,
  },
  dots: {
    height: UI_METRICS.board.pagerHeight,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  dot: {
    width: UI_METRICS.board.pagerDotSize,
    height: UI_METRICS.board.pagerDotSize,
    borderRadius: UI_METRICS.board.pagerDotSize / 2,
  },
  pageText: { marginLeft: SPACING.sm },
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: BORDER_WIDTH_EMPHASIS,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    zIndex: LAYER.dragPreview,
  },
});
