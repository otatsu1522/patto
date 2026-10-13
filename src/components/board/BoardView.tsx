import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { BOARD, GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { registerBoardMenu, closeBoardMenu } from '@/hooks/boardMenu';
import { useUiStore } from '@/store/uiStore';
import { adjacentOffset, boardGeometry, columnIndexAt, nearestOffsetIndex, sidebarWidthFor, useLayoutMode } from '@/hooks/useLayout';
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

export interface BoardViewHandle {
  scrollToColumn: (index: number) => void;
}

interface Props {
  columns: KanbanColumn[];
  tasksOf: (columnId: string) => Task[];
  cursor: Cursor | null;
  compactCards: boolean;
  menuItemsFor: (column: KanbanColumn, index: number) => MenuItem[];
  taskMenuFor: (task: Task) => MenuItem[];
  onAdvance: (task: Task) => void;
  /** ドラッグで落としたとき（ピン留めの状態は移動先でも変わらない） */
  onTaskDrop: (task: Task, target: KanbanColumn) => void;
  onColumnDrop: (column: KanbanColumn, toIndex: number) => void;
  onAddTask: (column: KanbanColumn) => void;
  onRefresh?: () => Promise<void>;
  /**
   * 画面上部のバー。スマホではメニューと一緒に横へ動かす（メニューを開くと、画面全体が右へずれてメニューが現れる）。
   * PCでは、ボードの上にそのまま表示する。
   */
  header?: ReactNode;
  /** この値が変わったら（プロジェクトの切り替えなど）、スクロールを最初の位置に戻す */
  resetKey?: string;
}

type DragInfo = ({ kind: 'task'; task: Task } | { kind: 'column'; column: KanbanColumn }) & { grab?: GrabInfo };

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
  const origin = useRef({ x: 0, y: 0 });
  const scrollXRef = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const edge = useRef({ side: 0, since: 0 });
  const dragRef = useRef<DragInfo | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pos = useRef(new Animated.ValueXY()).current;

  const geo = useMemo(() => boardGeometry(size.width, mode, columns.length), [size.width, mode, columns.length]);

  // スマホ（PC以外）: メニューを「いちばん左のカンバンのさらに左」の1ページとして横スクロールの中に置く。
  // メニューの幅ぶん、カンバンが右へずれるので、カンバンの止まる位置もその分ずらす。
  const pane = mode !== 'expanded';
  const menuWidth = sidebarWidthFor(windowWidth, false);
  /** メニューのページが左端からはみ出す分（左の余白をメニューが使う）を引いた、カンバンのずれ */
  const menuShift = pane ? menuWidth + BOARD.columnGap - geo.padding : 0;
  /** カンバンごとの「止まる位置」（メニューを含む） */
  const offsets = useMemo(() => geo.offsets.map((o) => o + menuShift), [geo.offsets, menuShift]);
  /** 横スクロールが吸着する位置。メニューを開いた位置（0）も含める */
  const snapOffsets = useMemo(() => (pane ? [0, ...offsets] : offsets), [pane, offsets]);
  const closedX = offsets[0] ?? 0;
  /** スマホでは、メニューを画面の上端まで広げるため、カンバンの上にヘッダーの高さの空きを作る */
  const headerOffset = pane ? BOARD.headerHeight : 0;
  const menuVisible = pane && scrollX < closedX - 2;
  const closedXRef = useRef(closedX);
  closedXRef.current = closedX;

  const scrollToX = useCallback((x: number, animated = true) => {
    scrollRef.current?.scrollTo({ x: Math.max(0, x), animated });
  }, []);

  /** 指定のカンバンが見える位置までスクロールする */
  const scrollToColumn = useCallback(
    (index: number) => {
      const current = nearestOffsetIndex(offsets, scrollXRef.current);
      if (geo.compact) return scrollToX(offsets[Math.min(index, offsets.length - 1)] ?? 0);
      if (index < current) scrollToX(offsets[index] ?? 0);
      else if (index > current + geo.visible - 1) scrollToX(offsets[Math.min(index - geo.visible + 1, offsets.length - 1)] ?? 0);
    },
    [geo, offsets, scrollToX],
  );

  useImperativeHandle(ref, () => ({ scrollToColumn }), [scrollToColumn]);

  // メニューの開閉は、このスクロール位置だけで決まる（メニューが開いている = 左端付近）
  useEffect(() => {
    if (!pane) return;
    const isOpen = () => scrollXRef.current < menuWidth / 2;
    const open = () => scrollToX(0);
    const close = () => scrollToX(closedXRef.current);
    return registerBoardMenu({ open, close, toggle: () => (isOpen() ? close() : open()) });
  }, [pane, menuWidth, scrollToX]);

  // 最初は、メニューを閉じた位置（最初のカンバンが左に揃う位置）から始める。位置が決まるまで表示しない
  useEffect(() => {
    if (!pane) return setPositioned(true);
    if (size.width === 0) return;
    setPositioned(false);
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: closedXRef.current, animated: false });
      scrollXRef.current = closedXRef.current;
      setPositioned(true);
    });
    return () => cancelAnimationFrame(id);
  }, [pane, size.width, menuWidth]);

  // メニューが見えているかを、ヘッダーのメニューアイコンの表示に反映する
  useEffect(() => {
    useUiStore.setState({ menuVisible });
    return () => useUiStore.setState({ menuVisible: false });
  }, [menuVisible]);

  // プロジェクトが切り替わったら、最初の位置（メニューを閉じた位置）に戻す
  useEffect(() => {
    if (!positioned) return;
    scrollRef.current?.scrollTo({ x: pane ? closedXRef.current : 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetKey]);

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
    setScrollX(x);
  };
  // スクロール位置をアニメーション値に渡す（ヘッダーをカンバンと同じ動きで動かすため。ネイティブ側で処理するのでずれない）
  const onScroll = Animated.event( [{ nativeEvent: { contentOffset: { x: scrollAnim } } }], {useNativeDriver: Platform.OS !== 'web',listener: onScrollEvent,},);
  // メニューを開くほど（スクロール位置が左端に近いほど）、ヘッダーを右へずらす
  const headerShift = useMemo(
    () => scrollAnim.interpolate({ inputRange: [0, Math.max(1, closedX)], outputRange: [closedX, 0], extrapolate: 'clamp' }),
    [scrollAnim, closedX],
  );

  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  // ---- ドラッグ ----
  const updateHover = () => {
    const idx = columnIndexAt(pointer.current.x, scrollXRef.current, { ...geo, padding: geo.padding + menuShift }, columns.length);
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
    edge.current = { side: 0, since: 0 };
  };

  const move = (absX: number, absY: number) => {
    pointer.current = { x: absX - origin.current.x, y: absY - origin.current.y };
    pos.setValue(pointer.current);
    updateHover();
  };

  const end = async (cancelled: boolean) => {
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

  const taskDragHandlers = (task: Task): DragHandlers => ({ begin: (x, y, grab) => begin({ kind: 'task', task, grab }, x, y), move, end });
  const columnDragHandlers = (column: KanbanColumn): DragHandlers => ({ begin: (x, y, grab) => begin({ kind: 'column', column, grab }, x, y), move, end });

  const page = nearestOffsetIndex(offsets, scrollX);
  const showButtons = geo.peek > 0;
  const maxOffset = offsets[offsets.length - 1] ?? 0;
  const columnHeight = Math.max(0, size.height - headerOffset - (geo.compact && columns.length > 1 ? 32 : 0) - BOARD.boardPadding * 2);

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
            snapToOffsets={snapOffsets.length > 1 ? snapOffsets : undefined}
            decelerationRate="fast"
            disableIntervalMomentum={geo.compact}
            showsHorizontalScrollIndicator={!geo.compact}
            persistentScrollbar={!geo.compact}
            indicatorStyle={isDark ? 'white' : 'black'}
            onScroll={onScroll}
            onScrollBeginDrag={blurInputs}
            scrollEventThrottle={16}
            scrollEnabled={!dragInfo}
            style={{ opacity: positioned ? 1 : 0 }}
            contentContainerStyle={{ paddingTop: headerOffset + BOARD.boardPadding, paddingBottom: BOARD.boardPadding, paddingHorizontal: geo.padding, gap: BOARD.columnGap }}
          >
            {pane ? (
              <View style={[styles.menuPane, { width: menuWidth, height: size.height, marginLeft: -geo.padding, marginTop: -(headerOffset + BOARD.boardPadding), marginBottom: -BOARD.boardPadding }]}>
                <Sidebar width={menuWidth} showMenuIcon onToggle={closeBoardMenu} onNavigate={closeBoardMenu} />
              </View>
            ) : null}
            {columns.length === 0 ? (
              <View style={{ width: geo.columnWidth, height: columnHeight, justifyContent: 'center' }}>
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
                compactCards={props.compactCards}
                cursorTaskIndex={cursor && cursor.columnIndex === index ? cursor.taskIndex : null}
                grabbed={!!cursor?.grabbed}
                dropTarget={dragInfo !== null && hoverIndex === index && !(dragInfo.kind === 'column' && dragInfo.column.id === column.id)}
                draggingTaskId={dragInfo?.kind === 'task' ? dragInfo.task.id : null}
                draggingColumn={dragInfo?.kind === 'column' && dragInfo.column.id === column.id}
                menuItems={props.menuItemsFor(column, index)}
                taskMenu={props.taskMenuFor}
                onAdvance={props.onAdvance}
                onAddTask={() => props.onAddTask(column)}
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
                <View pointerEvents="box-none" style={[styles.navBtn, styles.navLeft, { width: geo.peek }]}>
                  <IconButton
                    icon="left"
                    label={t('board.prev')}
                    box={34}
                    onPress={() => scrollToX(adjacentOffset(offsets, scrollXRef.current, -1) ?? 0)}
                    style={{ backgroundColor: colors.surface, borderWidth: BORDER_WIDTH, borderColor: colors.border }}
                  />
                </View>
              ) : null}
              {scrollX < maxOffset - 1 ? (
                <View pointerEvents="box-none" style={[styles.navBtn, styles.navRight, { width: geo.peek }]}>
                  <IconButton
                    icon="right"
                    label={t('board.next')}
                    box={34}
                    onPress={() => scrollToX(adjacentOffset(offsets, scrollXRef.current, 1) ?? maxOffset)}
                    style={{ backgroundColor: colors.surface, borderWidth: BORDER_WIDTH, borderColor: colors.border }}
                  />
                </View>
              ) : null}
            </>
          ) : null}

          {geo.compact && columns.length > 1 && !menuVisible ? (
            <View style={styles.dots}>
              {columns.map((c, i) => (
                <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => scrollToX(offsets[i] ?? 0)} hitSlop={8}>
                  <View style={[styles.dot, { backgroundColor: i === page ? colors.text : colors.border }]} />
                </Pressable>
              ))}
              <AppText variant="caption" muted style={styles.pageText}>
                {t('board.pageIndicator', { index: page + 1, total: columns.length })}
              </AppText>
            </View>
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
              transform: [{ translateX: Animated.subtract(pos.x, dragInfo.grab?.ox ?? 70) }, { translateY: Animated.subtract(pos.y, dragInfo.grab?.oy ?? 20) }],
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
        <Animated.View style={[styles.headerOverlay, { height: BOARD.headerHeight, transform: [{ translateX: headerShift }] }]}>{header}</Animated.View>
      ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menuPane: { flexDirection: 'row' },
  headerOverlay: { position: 'absolute', left: 0, right: 0, top: 0 },
  navBtn: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  navLeft: { left: 2 },
  navRight: { right: 2 },
  dots: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, position: 'absolute', bottom: 0, left: 0, right: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pageText: { marginLeft: SPACING.sm },
  ghost: { position: 'absolute', left: 0, top: 0, borderWidth: 2, borderRadius: RADIUS.md, padding: SPACING.md, zIndex: 50 },
});
