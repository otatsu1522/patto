import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { BOARD, GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { boardGeometry, columnIndexAt, useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import type { Cursor } from '@/shortcuts/cursor';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import type { MenuItem } from '../ui/DropdownMenu';
import { ColumnView } from './ColumnView';
import type { DragHandlers } from './dragGesture';

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
  /** ドラッグで落としたとき。favorite は落とした位置（お気に入りの横線の上か下か） */
  onTaskDrop: (task: Task, target: KanbanColumn, favorite: boolean) => void;
  onColumnDrop: (column: KanbanColumn, toIndex: number) => void;
  onAddTask: (column: KanbanColumn, title: string) => void;
  onRefresh?: () => Promise<void>;
}

type DragInfo = { kind: 'task'; task: Task } | { kind: 'column'; column: KanbanColumn };

/**
 * カンバンを横に並べるボード。
 * - スマホ縦: 前後のカンバンが見える幅で、1つずつ吸着しながらスクロール
 * - それ以外: 3列表示、4つ以上は横スクロール＋前後ボタン（動かせる方向のボタンだけ表示）
 * - 長押し（PCはドラッグ）でタスク・カンバンをつかんで移動。画面端に寄せると隣へスクロール
 */
export const BoardView = forwardRef<BoardViewHandle, Props>(function BoardView(props, ref) {
  const { columns, tasksOf, cursor } = props;
  const { colors, isDark } = useTheme();
  const { mode } = useLayoutMode();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [blurSignal, setBlurSignal] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const scrollXRef = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const edge = useRef({ side: 0, since: 0 });
  const dragRef = useRef<DragInfo | null>(null);
  const hoverRef = useRef<number | null>(null);
  const dividers = useRef(new Map<string, () => Promise<number | null>>());
  const pos = useRef(new Animated.ValueXY()).current;

  const geo = useMemo(() => boardGeometry(size.width, mode), [size.width, mode]);
  const contentWidth = geo.padding * 2 + geo.columnWidth * columns.length + BOARD.columnGap * Math.max(0, columns.length - 1);
  const maxScroll = Math.max(0, contentWidth - size.width);

  const registerDivider = useCallback((columnId: string, measure: (() => Promise<number | null>) | null) => {
    if (measure) dividers.current.set(columnId, measure);
    else dividers.current.delete(columnId);
  }, []);

  const scrollToX = useCallback(
    (x: number) => {
      scrollRef.current?.scrollTo({ x: Math.max(0, Math.min(x, maxScroll)), animated: true });
    },
    [maxScroll],
  );

  const scrollToColumn = useCallback(
    (index: number) => {
      if (geo.snap) return scrollToX(index * geo.step);
      const left = geo.padding + index * geo.step;
      const right = left + geo.columnWidth;
      if (left < scrollXRef.current) scrollToX(left - geo.padding);
      else if (right > scrollXRef.current + size.width) scrollToX(right - size.width + geo.padding);
    },
    [geo, scrollToX, size.width],
  );

  useImperativeHandle(ref, () => ({ scrollToColumn }), [scrollToColumn]);

  // キーボードのカーソルが画面外のカンバンに移ったら、そこまでスクロールする
  useEffect(() => {
    if (cursor && size.width > 0) scrollToColumn(cursor.columnIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor?.columnIndex, size.width]);

  const blurInputs = () => {
    Keyboard.dismiss();
    setBlurSignal((n) => n + 1);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
    setScrollX(e.nativeEvent.contentOffset.x);
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  // ---- ドラッグ ----
  const updateHover = () => {
    const idx = columnIndexAt(pointer.current.x, scrollXRef.current, geo, columns.length);
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
    const pointerY = origin.current.y + pointer.current.y;
    dragRef.current = null;
    hoverRef.current = null;
    setDragInfo(null);
    setHoverIndex(null);
    if (!info || cancelled || idx === null) return;
    const target = columns[idx];
    if (!target) return;
    if (info.kind === 'column') return props.onColumnDrop(info.column, idx);
    // お気に入りの横線より上に落としたらお気に入り、下ならお気に入りから外す
    const dividerY = await dividers.current.get(target.id)?.();
    const favorite = dividerY === null || dividerY === undefined ? info.task.isFavorite && target.id === info.task.columnId : pointerY < dividerY;
    props.onTaskDrop(info.task, target, favorite);
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
        scrollToX(scrollXRef.current + side * geo.step);
        edge.current = { side, since: now };
        setTimeout(updateHover, 350);
      }
    }, 100);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragInfo, size.width, geo.step]);

  const taskDragHandlers = (task: Task): DragHandlers => ({ begin: (x, y) => begin({ kind: 'task', task }, x, y), move, end });
  const columnDragHandlers = (column: KanbanColumn): DragHandlers => ({ begin: (x, y) => begin({ kind: 'column', column }, x, y), move, end });

  const page = geo.snap && geo.step > 0 ? Math.round(scrollX / geo.step) : 0;
  const showButtons = !geo.snap && columns.length > geo.visible;
  const columnHeight = Math.max(0, size.height - (geo.snap && columns.length > 1 ? 32 : 0) - BOARD.boardPadding * 2);

  return (
    <View ref={containerRef} style={styles.fill} onLayout={onLayout} collapsable={false}>
      {columns.length === 0 ? (
        <EmptyState title={t('column.empty')} hint={t('column.emptyHint')} />
      ) : size.width > 0 ? (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            snapToInterval={geo.snap ? geo.step : undefined}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={geo.snap}
            showsHorizontalScrollIndicator={!geo.snap}
            persistentScrollbar={!geo.snap}
            indicatorStyle={isDark ? 'white' : 'black'}
            onScroll={onScroll}
            onScrollBeginDrag={blurInputs}
            scrollEventThrottle={16}
            scrollEnabled={!dragInfo}
            contentContainerStyle={{ paddingVertical: BOARD.boardPadding, paddingHorizontal: geo.padding, gap: BOARD.columnGap }}
          >
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
                taskDragActive={dragInfo?.kind === 'task'}
                draggingColumn={dragInfo?.kind === 'column' && dragInfo.column.id === column.id}
                menuItems={props.menuItemsFor(column, index)}
                taskMenu={props.taskMenuFor}
                onAdvance={props.onAdvance}
                onAddTask={(title) => props.onAddTask(column, title)}
                taskDrag={taskDragHandlers}
                columnDrag={columnDragHandlers(column)}
                registerDivider={registerDivider}
                blurSignal={blurSignal}
                onRefresh={props.onRefresh}
              />
            ))}
          </ScrollView>

          {showButtons ? (
            <>
              {scrollX > 1 ? (
                <View pointerEvents="box-none" style={[styles.navBtn, styles.navLeft]}>
                  <IconButton icon="left" label={t('board.prev')} onPress={() => scrollToX(scrollXRef.current - geo.step)} style={{ ...SHADOW.float, backgroundColor: colors.surface }} />
                </View>
              ) : null}
              {scrollX < maxScroll - 1 ? (
                <View pointerEvents="box-none" style={[styles.navBtn, styles.navRight]}>
                  <IconButton icon="right" label={t('board.next')} onPress={() => scrollToX(scrollXRef.current + geo.step)} style={{ ...SHADOW.float, backgroundColor: colors.surface }} />
                </View>
              ) : null}
            </>
          ) : null}

          {geo.snap && columns.length > 1 ? (
            <View style={styles.dots}>
              {columns.map((c, i) => (
                <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => scrollToX(i * geo.step)} hitSlop={8}>
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
            { backgroundColor: colors.surface, borderColor: colors.accent, transform: [{ translateX: Animated.subtract(pos.x, 70) }, { translateY: Animated.subtract(pos.y, 20) }] },
          ]}
        >
          <AppText bold numberOfLines={2}>
            {dragInfo.kind === 'task' ? dragInfo.task.title : dragInfo.column.title}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  navBtn: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  navLeft: { left: 2 },
  navRight: { right: 2 },
  dots: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, position: 'absolute', bottom: 0, left: 0, right: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pageText: { marginLeft: SPACING.sm },
  ghost: { position: 'absolute', left: 0, top: 0, width: 140, borderWidth: 2, borderRadius: RADIUS.md, padding: SPACING.sm, zIndex: 50 },
});
