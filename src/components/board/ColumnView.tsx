import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { BOARD, GESTURE, UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import {
  BORDER_WIDTH_EMPHASIS,
  RADIUS,
  SPACING,
  useTheme,
  ICON_SIZE,
  ICON_BUTTON_BOX,
  LAYER,
  OPACITY,
} from '@/theme';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { TaskCard } from './TaskCard';
import { BORDER_WIDTH_NONE, SEPARATOR_WIDTH } from '@/theme/tokens';
import { canHover } from '@/lib/hover';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

export interface ColumnViewProps {
  column: KanbanColumn;
  tasks: Task[];
  index: number;
  count: number;
  width: number;
  height: number;
  /** Web のスマホ表示で、この列を ScrollView のスナップ位置にする */
  webSnapAlign?: 'start' | 'center';
  webSnapPadding?: number;
  compactCards: boolean;
  detailedCards: boolean;
  showTaskDescription: boolean;
  showTaskDueDate: boolean;
  showTaskUpdatedAt: boolean;
  /** キーボードのカーソル: 自分のカンバンなら taskIndex（-1 はヘッダー）、それ以外は null */
  cursorTaskIndex: number | null;
  grabbed: boolean;
  /** ドラッグ中にこのカンバンが落とし先として強調されるか */
  dropTarget: boolean;
  draggingTaskId: string | null;
  draggingColumn: boolean;
  menuItems: MenuItem[];
  taskMenu: (task: Task) => MenuItem[];
  onAdvance: (task: Task) => void;
  /** 「タスクを追加」を押したとき（作成ダイアログを開く） */
  onAddTask: () => void;
  onCopyTitle: (task: Task) => void;
  /** メニュー右端と先頭カンバンのヘッダー下線を接続する */
  connectHeaderLineToMenu?: boolean;
  /** 手動並び替えでタスクの画面位置を測るための参照登録 */
  onTaskMeasure: (taskId: string, node: View | null) => void;
  taskDrag: (task: Task) => DragHandlers;
  columnDrag: DragHandlers;
  /** 横スクロールなど他の操作が始まったら増える。入力欄のフォーカスを外す合図 */
  blurSignal: number;
  onRefresh?: () => Promise<void>;
}

/** 1つのカンバン（列）: ヘッダー、縦スクロールのタスク一覧（お気に入りは上、横線で区切る）、末尾の「タスクを追加」。 */
export function ColumnView(p: ColumnViewProps) {
  const { colors, taskColor, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // Web ではカードの本文・更新日時などから始めたタッチでも縦スクロールできるよう補助する。
  // 縦方向だけ一覧を動かし、横方向のスワイプは外側のカンバンに任せる。
  const listRef = useWebWheelScroll({
    touchScroll: true,
    touchAction: 'pan-x pan-y',
    touchLongPressMs: GESTURE.longPressMs,
  });
  const listViewportRef = useRef<View>(null);
  const listOffset = useRef(0);
  const taskRefs = useRef(new Map<string, View>());
  const headerGesture = useDragGesture({
    ...p.columnDrag,
    begin: (x, y) => {
      if (!headerRef.current) return p.columnDrag.begin(x, y);
      headerRef.current.measureInWindow((cx, cy, w, h) =>
        p.columnDrag.begin(x, y, { ox: x - cx, oy: y - cy, w, h }),
      );
    },
  });
  const headerRef = useRef<View>(null);

  const favorites = p.tasks.filter((x) => x.isFavorite);
  const others = p.tasks.filter((x) => !x.isFavorite);
  const taskIndexById = useMemo(
    () => new Map(p.tasks.map((task, index) => [task.id, index] as const)),
    [p.tasks],
  );
  const showDivider = favorites.length > 0 && others.length > 0;

  // キーボード操作で選択されたタスクが画面外へ出たら、一覧を必要な分だけスクロールする。
  useEffect(() => {
    if (p.cursorTaskIndex === null || p.cursorTaskIndex < 0) return;
    const current = p.tasks[p.cursorTaskIndex];
    const node = current ? taskRefs.current.get(current.id) : undefined;
    const list = listRef.current;
    const listViewport = listViewportRef.current;
    if (!node || !list || !listViewport) return;
    const frame = requestAnimationFrame(() => {
      node.measureInWindow((_x, taskY, _w, taskHeight) => {
        listViewport.measureInWindow((_lx, listY, _lw, listHeight) => {
          const top = listY + UI_METRICS.board.cursorScrollMargin;
          const bottom = listY + listHeight - UI_METRICS.board.cursorScrollMargin;
          if (taskY < top) {
            list.scrollTo({ y: Math.max(0, listOffset.current - (top - taskY)), animated: true });
          } else if (taskY + taskHeight > bottom) {
            list.scrollTo({ y: listOffset.current + taskY + taskHeight - bottom, animated: true });
          }
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [p.cursorTaskIndex, p.tasks, p.height, listRef]);

  const card = (task: Task) => {
    const i = taskIndexById.get(task.id) ?? -1;
    return (
      <TaskCard
        key={task.id}
        task={task}
        done={p.column.isDoneColumn}
        compact={p.compactCards}
        detailed={p.detailedCards}
        showDescription={p.showTaskDescription}
        showDueDate={p.showTaskDueDate}
        showUpdatedAt={p.showTaskUpdatedAt}
        isLast={p.index === p.count - 1}
        canAdvance={p.count > 1}
        focused={p.cursorTaskIndex === i}
        grabbed={p.grabbed && p.cursorTaskIndex === i}
        dragging={p.draggingTaskId === task.id}
        menuItems={p.taskMenu(task)}
        onAdvance={() => p.onAdvance(task)}
        onCopyTitle={() => p.onCopyTitle(task)}
        onMeasure={(id, node) => {
          if (node) taskRefs.current.set(id, node);
          else taskRefs.current.delete(id);
          p.onTaskMeasure(id, node);
        }}
        drag={p.taskDrag(task)}
      />
    );
  };

  const headerFocused = p.cursorTaskIndex === -1;
  return (
    <View
      style={[
        styles.column,
        {
          width: p.width,
          height: p.height,
          backgroundColor: colors.column,
          opacity: p.draggingColumn ? OPACITY.draggingColumn : OPACITY.fullyVisible,
          borderRightWidth: BORDER_WIDTH_NONE,
        },
        Platform.OS === 'web' && p.webSnapAlign
          ? ({
              scrollSnapAlign: p.webSnapAlign,
              scrollSnapStop: 'always',
              scrollMarginLeft: p.webSnapAlign === 'start' ? (p.webSnapPadding ?? 0) : 0,
            } as never)
          : undefined,
      ]}
    >
      <View
        style={[
          styles.header,
          headerFocused && { borderColor: colors.focus, borderWidth: BORDER_WIDTH_EMPHASIS },
          p.grabbed && headerFocused && { backgroundColor: colors.border },
        ]}
      >
        <GestureDetector
          gesture={headerGesture}
          touchAction="manipulation"
          enableContextMenu={false}
        >
          <View ref={headerRef} collapsable={false} style={styles.titleWrap}>
            {p.column.color ? (
              <View style={[styles.dot, { backgroundColor: taskColor(p.column.color) }]} />
            ) : null}
            <AppText bold numberOfLines={UI_METRICS.text.singleLineMax} style={styles.title}>
              {p.column.title}
            </AppText>
            <AppText variant="caption" muted bold>
              {t('column.taskCount', { count: p.tasks.length })}
            </AppText>
            {p.column.isDoneColumn ? (
              <Icon name="doneMode" size={ICON_SIZE.xxl} color={colors.textMuted} />
            ) : null}
          </View>
        </GestureDetector>
        <IconButton
          icon="add"
          label={t('task.add')}
          onPress={p.onAddTask}
          box={ICON_BUTTON_BOX.large}
          size={ICON_SIZE.xxl}
        />
        <DropdownMenu
          items={p.menuItems}
          trigger={(open) => (
            <IconButton
              icon="more"
              label={p.column.title}
              onPress={open}
              box={ICON_BUTTON_BOX.large}
              size={ICON_SIZE.xxl}
            />
          )}
        />
        <View
          pointerEvents="none"
          style={[
            styles.headerUnderline,
            {
              left: p.connectHeaderLineToMenu ? -BOARD.columnGap : -(BOARD.columnGap / 2),
              backgroundColor: colors.divider,
            },
          ]}
        />
      </View>

      <View ref={listViewportRef} collapsable={false} style={styles.listViewport}>
        <ScrollView
          ref={listRef}
          style={[styles.list, Platform.OS === 'web' ? styles.webList : undefined]}
          onScroll={(event) => {
            listOffset.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={TIMING.scrollEventThrottleMs}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          persistentScrollbar
          indicatorStyle={isDark ? 'white' : 'black'}
          refreshControl={
            p.onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  try {
                    await p.onRefresh?.();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />
            ) : undefined
          }
        >
          {favorites.map(card)}
          {showDivider ? (
            <View style={[styles.divider, { backgroundColor: colors.divider }]} />
          ) : null}
          {others.map(card)}

          <Pressable
            accessibilityRole="button"
            onPress={p.onAddTask}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.add,
              { backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent' },
            ]}
          >
            <Icon name="add" size={ICON_SIZE.xl} color={colors.textMuted} />
            <AppText muted>{t('task.add')}</AppText>
          </Pressable>
        </ScrollView>
      </View>
      {p.dropTarget ? (
        <View
          pointerEvents="none"
          style={[styles.dropTargetFrame, { borderColor: colors.accent }]}
        />
      ) : null}
      {p.index < p.count - 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.columnDivider,
            { right: -(BOARD.columnGap / 2), backgroundColor: colors.divider },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'relative', overflow: 'visible' },
  dropTargetFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: BORDER_WIDTH_EMPHASIS,
    borderRadius: RADIUS.sm,
    zIndex: LAYER.dragColumn,
  },
  columnDivider: { position: 'absolute', top: 0, bottom: 0, width: SEPARATOR_WIDTH },
  header: {
    // 上のヘッダー区切り線と下線の間で、タイトル行を縦方向の中央に配置する。
    position: 'relative',
    height: BOARD.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    paddingBottom: 0,
    overflow: 'visible',
  },
  headerUnderline: {
    position: 'absolute',
    left: -(BOARD.columnGap / 2),
    right: -(BOARD.columnGap / 2),
    bottom: 0,
    height: SEPARATOR_WIDTH,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: BOARD.touchTarget,
    cursor: 'grab',
  } as never,
  dot: {
    width: UI_METRICS.board.colorDotSize,
    height: UI_METRICS.board.colorDotSize,
    borderRadius: UI_METRICS.board.colorDotSize / 2,
  },
  title: { flexShrink: 1 },
  listViewport: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  webList: {
    overflowX: 'auto',
    touchAction: 'pan-x pan-y',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorX: 'auto',
    overscrollBehaviorY: 'contain',
  } as never,
  listContent: { padding: SPACING.sm, gap: SPACING.sm },
  divider: {
    height: SEPARATOR_WIDTH,
    minHeight: SEPARATOR_WIDTH,
    maxHeight: SEPARATOR_WIDTH,
    flexShrink: 0,
    marginVertical: SPACING.xs,
    marginHorizontal: SPACING.sm,
  },
  add: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
});
