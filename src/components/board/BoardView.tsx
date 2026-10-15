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
import { BOARD, GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { registerBoardMenu, closeBoardMenu } from '@/hooks/boardMenu';
import { isTouchWeb } from '@/lib/hover';
import { useUiStore } from '@/store/uiStore';
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
import { BORDER_WIDTH, RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
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
  onRefresh?: () => Promise<void>;
  /**
   * 画面上部のバー。スマホではメニューと一緒に横へ動かす（メニューを開くと、画面全体が右へずれてメニューが現れる）。
   * PCでは、ボードの上にそのまま表示する。
   */
  header?: ReactNode;
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
  const { colors, isDark } = useTheme();
  const { mode, width: windowWidth } = useLayoutMode();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [blurSignal, setBlurSignal] = useState(0);
  const [positioned, setPositioned] = useState(false);
  const scrollAnim = useRef(new Animated.Value(0)).current;

  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const taskNodeRefs = useRef(new Map<string, View>());
  const origin = useRef({ x: 0, y: 0 });
  const scrollXRef = useRef(0);
  // プログラム操作中は、スクロール完了まで意図した開閉状態を優先する。
  const menuTargetRef = useRef<boolean | null>(null);
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
  /** メニューの幅と列間のすき間を加え、閉じた位置で先頭カンバンの外側余白を維持する。 */
  const menuShift = pane ? menuWidth + BOARD.columnGap - geo.padding : 0;
  /** カンバンごとの「止まる位置」（メニューを含む） */
  const offsets = useMemo(() => geo.offsets.map((o) => o + menuShift), [geo.offsets, menuShift]);
  /** 横スクロールが吸着する位置。メニューを開いた位置（0）も含める */
  const snapOffsets = useMemo(() => (pane ? [0, ...offsets] : offsets), [pane, offsets]);
  const closedX = offsets[0] ?? 0;
  const maxOffset = offsets[offsets.length - 1] ?? 0;
  /** スマホでは、メニューを画面の上端まで広げるため、カンバンの上にヘッダーの高さの空きを作る */
  const headerOffset = pane ? BOARD.headerHeight : 0;
  const menuVisible = pane && scrollX < closedX - 2;
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
  const scrollUiSnapshotRef = useRef<ScrollUiSnapshot | null>(null);
  // メニュー右端の X 座標。スクロールと同時に動かし、ヘッダー／フッターの線を縦線へ接続する。
  const menuEdgeWidth = Math.max(0, closedX - menuWidth);
  const menuEdgeLeft = useMemo(
    () =>
      scrollAnim.interpolate({
        inputRange: [0, Math.max(1, closedX)],
        outputRange: [menuWidth, menuWidth - closedX],
        extrapolate: 'clamp',
      }),
    [scrollAnim, menuWidth, closedX],
  );

  const scrollToX = useCallback((x: number, animated = true) => {
    const target = Math.max(0, x);
    // Web では目標位置を先に state へ入れず、実際の scroll イベントに追従させる。
    // 先に setScrollX(target) すると、ヘッダー／ドロワーがスクロール開始前に跳ねる。
    scrollRef.current?.scrollTo({ x: target, animated });
  }, []);

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

    const open = () => {
      menuTargetRef.current = true;
      useUiStore.setState({ menuVisible: true });
      scrollToX(0);
    };

    const close = () => {
      menuTargetRef.current = false;
      useUiStore.setState({ menuVisible: false });
      scrollToX(closedXRef.current);
    };

    return registerBoardMenu({
      open,
      close,
      toggle: () => (useUiStore.getState().menuVisible ? close() : open()),
    });
  }, [pane, menuWidth, scrollToX]);

  useEffect(() => {
    useUiStore.setState({ menuVisible: false });
    return () => useUiStore.setState({ menuVisible: false });
  }, []);

  // 最初は、メニューを閉じた位置（最初のカンバンが左に揃う位置）から始める。位置が決まるまで表示しない
  useEffect(() => {
    if (!pane) return setPositioned(true);
    if (size.width === 0) return;
    setPositioned(false);
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: closedXRef.current, animated: false });
      scrollXRef.current = closedXRef.current;
      setScrollX(closedXRef.current);
      scrollUiSnapshotRef.current = {
        page: nearestOffsetIndex(offsets, closedXRef.current),
        menuVisible: false,
        canScrollLeft: closedXRef.current > (offsets[0] ?? 0) + 1,
        canScrollRight: closedXRef.current < maxOffset - 1,
      };
      scrollAnim.setValue(closedXRef.current);
      menuTargetRef.current = null;
      useUiStore.setState({ menuVisible: false });
      setPositioned(true);
    });
    return () => cancelAnimationFrame(id);
  }, [pane, size.width, menuWidth, offsets, maxOffset, scrollAnim]);

  // プロジェクトが切り替わったら、最初の位置（メニューを閉じた位置）に戻す
  useEffect(() => {
    if (!positioned) return;
    const resetX = pane ? closedXRef.current : 0;
    scrollRef.current?.scrollTo({ x: resetX, animated: false });
    scrollXRef.current = resetX;
    setScrollX(resetX);
    scrollUiSnapshotRef.current = {
      page: nearestOffsetIndex(offsets, resetX),
      menuVisible: false,
      canScrollLeft: resetX > (offsets[0] ?? 0) + 1,
      canScrollRight: resetX < maxOffset - 1,
    };
    menuTargetRef.current = null;
    useUiStore.setState({ menuVisible: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetKey, pane, offsets, maxOffset]);

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
    scrollXRef.current = x;

    // アニメーション自体は Animated.Value で毎フレーム追従させ、React の再描画は
    // ページ・メニュー開閉・前後ボタンの表示が切り替わるときだけに限定する。
    const nextMenuVisible = pane && x < closedXRef.current - 2;
    const nextSnapshot: ScrollUiSnapshot = {
      page: nearestOffsetIndex(offsets, x),
      menuVisible: nextMenuVisible,
      canScrollLeft: x > (offsets[0] ?? 0) + 1,
      canScrollRight: x < maxOffset - 1,
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

    const target = menuTargetRef.current;
    const reachedTarget =
      target === true ? x <= 2 : target === false ? x >= closedXRef.current - 2 : false;
    if (reachedTarget) menuTargetRef.current = null;
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
          scrollAnim.setValue(event.nativeEvent.contentOffset.x);
          onScrollEvent(event);
        }
      : Animated.event([{ nativeEvent: { contentOffset: { x: scrollAnim } } }], {
          useNativeDriver: true,
          listener: onScrollEvent,
        });
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    scrollXRef.current = x;
    const nextMenuVisible = pane && x < closedXRef.current - 2;
    // スクロール終了時にも snapshot を同期し、次のドラッグで誤って再描画が止まらないようにする。
    scrollUiSnapshotRef.current = {
      page: nearestOffsetIndex(offsets, x),
      menuVisible: nextMenuVisible,
      canScrollLeft: x > (offsets[0] ?? 0) + 1,
      canScrollRight: x < maxOffset - 1,
    };
    setScrollX(x);
    if (useUiStore.getState().menuVisible !== nextMenuVisible) {
      useUiStore.setState({ menuVisible: nextMenuVisible });
    }
    menuTargetRef.current = null;
  };
  // メニューを開くほど（スクロール位置が左端に近いほど）、ヘッダーを右へずらす
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
        setTimeout(updateHover, 350);
      }
    }, 100);
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

  const page = nearestOffsetIndex(offsets, scrollX);
  const showButtons = geo.peek > 0;
  // スマホ縦では、ページインジケーター用のフッターを確保し、
  // カンバン本体はその上端まで伸ばす。PC では下部に余白を残さない。
  const pagerHeight = geo.compact && columns.length > 1 ? 32 : 0;
  const columnHeight = Math.max(0, size.height - headerOffset - pagerHeight);

  return (
    <View style={styles.fill}>
      {!pane ? header : null}
      <View ref={containerRef} style={styles.fill} onLayout={onLayout} collapsable={false}>
        {columns.length === 0 && !pane ? (
          <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
        ) : size.width > 0 ? (
          <>
            <Animated.ScrollView
              ref={scrollRef}
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
              onScrollEndDrag={onScrollEnd}
              onMomentumScrollEnd={onScrollEnd}
              onScrollBeginDrag={blurInputs}
              scrollEventThrottle={16}
              scrollEnabled={!dragInfo}
              style={[
                { opacity: positioned ? 1 : 0 },
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
                paddingTop: headerOffset,
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
                      height: size.height,
                      marginLeft: -geo.padding,
                      marginTop: -headerOffset,
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
                    onNavigate={closeBoardMenu}
                    onSwipeClose={closeBoardMenu}
                  />
                </View>
              ) : null}
              {columns.length === 0 ? (
                <View
                  style={{ width: geo.columnWidth, height: columnHeight, justifyContent: 'center' }}
                >
                  <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
                </View>
              ) : null}
              {columns.map((column, index) => (
                <ColumnView
                  key={column.id}
                  column={column}
                  tasks={tasksOf(column.id)}
                  index={index}
                  count={columns.length}
                  width={geo.columnWidth}
                  height={columnHeight}
                  webSnapAlign={
                    Platform.OS === 'web' && geo.compact
                      ? index === 0
                        ? 'start'
                        : 'center'
                      : undefined
                  }
                  webSnapPadding={geo.padding}
                  compactCards={props.compactCards}
                  detailedCards={props.detailedCards}
                  showTaskDescription={props.showTaskDescription}
                  showTaskDueDate={props.showTaskDueDate}
                  showTaskUpdatedAt={props.showTaskUpdatedAt}
                  cursorTaskIndex={cursor && cursor.columnIndex === index ? cursor.taskIndex : null}
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
              ))}
            </Animated.ScrollView>

            {showButtons ? (
              <>
                {scrollX > (offsets[0] ?? 0) + 1 ? (
                  <View
                    pointerEvents="box-none"
                    style={[styles.navBtn, styles.navLeft, { width: geo.peek }]}
                  >
                    <IconButton
                      icon="left"
                      label={t('board.prev')}
                      box={34}
                      onPress={() =>
                        scrollToX(adjacentOffset(offsets, scrollXRef.current, -1) ?? 0)
                      }
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: BORDER_WIDTH,
                        borderColor: colors.border,
                      }}
                    />
                  </View>
                ) : null}
                {scrollX < maxOffset - 1 ? (
                  <View
                    pointerEvents="box-none"
                    style={[styles.navBtn, styles.navRight, { width: geo.peek }]}
                  >
                    <IconButton
                      icon="right"
                      label={t('board.next')}
                      box={34}
                      onPress={() =>
                        scrollToX(adjacentOffset(offsets, scrollXRef.current, 1) ?? maxOffset)
                      }
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: BORDER_WIDTH,
                        borderColor: colors.border,
                      }}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            {pagerHeight > 0 ? (
              <Animated.View
                pointerEvents={menuVisible ? 'none' : 'auto'}
                style={[
                  styles.pagerFooter,
                  {
                    opacity: pagerOpacity,
                    height: pagerHeight,
                    left: pane ? menuEdgeLeft : 0,
                    backgroundColor: colors.bg,
                    borderTopColor: colors.divider,
                    borderTopWidth: BORDER_WIDTH,
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
                      hitSlop={8}
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
                width: dragInfo.grab?.w ?? 140,
                minHeight: dragInfo.grab?.h ?? 44,
                backgroundColor: colors.surface,
                borderColor: colors.accent,
                // つかんだ位置が指の下になるよう、カードの左上から見た指の位置ぶんずらす
                transform: [
                  { translateX: Animated.subtract(pos.x, dragInfo.grab?.ox ?? 70) },
                  { translateY: Animated.subtract(pos.y, dragInfo.grab?.oy ?? 20) },
                ],
              },
            ]}
          >
            <AppText bold numberOfLines={2}>
              {dragInfo.kind === 'task' ? dragInfo.task.title : dragInfo.column.title}
            </AppText>
          </Animated.View>
        ) : null}

        {/* スマホ: ヘッダーは、メニューを開くと画面全体といっしょに右へずれる */}
        {pane && header ? (
          <>
            <Animated.View
              style={[
                styles.headerOverlay,
                { height: BOARD.headerHeight, transform: [{ translateX: headerShift }] },
              ]}
            >
              {header}
            </Animated.View>
            {/* ドロワー右端からヘッダー下線までの隙間を、スクロールに追従して埋める。 */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.headerLineBridge,
                {
                  left: menuEdgeLeft,
                  width: menuEdgeWidth,
                  top: BOARD.headerHeight - BORDER_WIDTH,
                  height: BORDER_WIDTH,
                  backgroundColor: colors.border,
                },
              ]}
            />
          </>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menuPane: { flexDirection: 'row' },
  headerOverlay: { position: 'absolute', left: 0, right: 0, top: 0 },
  headerLineBridge: { position: 'absolute', zIndex: 30 },
  navBtn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navLeft: { left: 2 },
  navRight: { right: 2 },
  pagerFooter: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  dots: {
    height: 31,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pageText: { marginLeft: SPACING.sm },
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: 2,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    zIndex: 50,
  },
});
