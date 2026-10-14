import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { TaskCard } from './TaskCard';
import { BORDER_WIDTH } from '@/theme/tokens';
import { canHover } from '@/lib/hover';

export interface ColumnViewProps {
  column: KanbanColumn;
  tasks: Task[];
  index: number;
  count: number;
  width: number;
  height: number;
  compactCards: boolean;
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
  taskDrag: (task: Task) => DragHandlers;
  columnDrag: DragHandlers;
  /** 横スクロールなど他の操作が始まったら増える。入力欄のフォーカスを外す合図 */
  blurSignal: number;
  /** スマホのWeb版で列内からの横スワイプをボードへ転送する */
  onColumnTouchStart?: (x: number, y: number) => void;
  onRefresh?: () => Promise<void>;
}

/** 1つのカンバン（列）: ヘッダー、縦スクロールのタスク一覧（お気に入りは上、横線で区切る）、末尾の「タスクを追加」。 */
export function ColumnView(p: ColumnViewProps) {
  const { colors, taskColor, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
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
  const showDivider = favorites.length > 0 && others.length > 0;

  const card = (task: Task) => {
    const i = p.tasks.indexOf(task);
    return (
      <TaskCard
        key={task.id}
        task={task}
        done={p.column.isDoneColumn}
        compact={p.compactCards}
        isLast={p.index === p.count - 1}
        canAdvance={p.count > 1}
        focused={p.cursorTaskIndex === i}
        grabbed={p.grabbed && p.cursorTaskIndex === i}
        dragging={p.draggingTaskId === task.id}
        menuItems={p.taskMenu(task)}
        onAdvance={() => p.onAdvance(task)}
        drag={p.taskDrag(task)}
      />
    );
  };

  const headerFocused = p.cursorTaskIndex === -1;
  return (
    <View
      onTouchStart={(event) => {
        const touch = event.nativeEvent.touches[0];
        if (!touch) return;

        p.onColumnTouchStart?.(touch.pageX, touch.pageY);
      }}
      style={[
        styles.column,
        {
          width: p.width,
          height: p.height,
          backgroundColor: colors.column,
          borderColor: p.dropTarget ? colors.accent : colors.border,
          opacity: p.draggingColumn ? 0.5 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          headerFocused && { borderColor: colors.focus, borderWidth: 2 },
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
            <AppText bold numberOfLines={1} style={styles.title}>
              {p.column.title}
            </AppText>
            <AppText variant="caption" muted>
              {t('column.taskCount', { count: p.tasks.length })}
            </AppText>
            {p.column.isDoneColumn ? (
              <Icon name="doneMode" size={22} color={colors.success} />
            ) : null}
          </View>
        </GestureDetector>
        <DropdownMenu
          items={p.menuItems}
          trigger={(open) => (
            <IconButton icon="more" label={p.column.title} onPress={open} box={40} size={22} />
          )}
        />
      </View>

      <ScrollView
        style={styles.list}
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
          <Icon name="add" size={20} color={colors.textMuted} />
          <AppText muted>{t('task.add')}</AppText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { borderRadius: RADIUS.lg, borderWidth: BORDER_WIDTH, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    margin: 2,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: GESTURE.edgeZone,
    cursor: 'grab',
  } as never,
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: SPACING.sm, gap: SPACING.sm },
  divider: { height: BORDER_WIDTH, marginVertical: SPACING.xs, marginHorizontal: SPACING.xs },
  add: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
});
