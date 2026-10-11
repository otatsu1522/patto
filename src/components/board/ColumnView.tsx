import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { TASK_COLORS } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { TaskCard } from './TaskCard';

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
  onTaskPress: (task: Task) => void;
  onTaskMove: (task: Task, direction: -1 | 1) => void;
  onAddTask: (title: string) => void;
  taskDrag: (task: Task) => DragHandlers;
  columnDrag: DragHandlers;
  onRefresh?: () => Promise<void>;
}

/** 1つのカンバン（列）: ヘッダー、縦スクロールのタスク一覧、末尾の「タスクを追加」。 */
export function ColumnView(p: ColumnViewProps) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const headerGesture = useDragGesture(p.columnDrag);
  const input = useRef<TextInput>(null);

  const submit = () => {
    const title = draft.trim();
    if (title) p.onAddTask(title);
    setDraft('');
    if (!title) setAdding(false);
    else setTimeout(() => input.current?.focus(), 0);
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
          borderColor: p.dropTarget ? colors.primary : 'transparent',
          opacity: p.draggingColumn ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.header, headerFocused && { borderColor: colors.focus, borderWidth: 2 }, p.grabbed && headerFocused && { backgroundColor: colors.border }]}>
        <GestureDetector gesture={headerGesture}>
          <View style={styles.titleWrap}>
            {p.column.color ? <View style={[styles.dot, { backgroundColor: TASK_COLORS[p.column.color] }]} /> : null}
            <AppText bold numberOfLines={1} style={styles.title}>
              {p.column.title}
            </AppText>
            {p.column.isDoneColumn ? <Icon name="check" size={16} color={colors.success} /> : null}
            <AppText variant="caption" muted>
              {t('column.taskCount', { count: p.tasks.length })}
            </AppText>
          </View>
        </GestureDetector>
        <DropdownMenu
          items={p.menuItems}
          trigger={(open) => <IconButton icon="more" label={p.column.title} onPress={open} box={36} size={20} />}
        />
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
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
        {p.tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            task={task}
            compact={p.compactCards}
            hasLeft={p.index > 0}
            hasRight={p.index < p.count - 1}
            focused={p.cursorTaskIndex === i}
            grabbed={p.grabbed && p.cursorTaskIndex === i}
            dragging={p.draggingTaskId === task.id}
            onPress={() => p.onTaskPress(task)}
            onMoveLeft={() => p.onTaskMove(task, -1)}
            onMoveRight={() => p.onTaskMove(task, 1)}
            drag={p.taskDrag(task)}
          />
        ))}

        {adding ? (
          <TextInput
            ref={input}
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
            placeholder={t('task.addPlaceholder')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            blurOnSubmit={false}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.primary, color: colors.text }]}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdding(true)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.add,
              { backgroundColor: pressed || hovered ? colors.border : 'transparent' },
            ]}
          >
            <Icon name="add" size={18} color={colors.textMuted} />
            <AppText muted>{t('task.add')}</AppText>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { borderRadius: RADIUS.lg, borderWidth: 2, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: SPACING.md, paddingRight: SPACING.xs, borderRadius: RADIUS.md, margin: 2 },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: GESTURE.edgeZone - 4, cursor: 'grab' } as never,
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { flexShrink: 1 },
  list: { flex: 1 },
  listContent: { padding: SPACING.sm, gap: SPACING.sm },
  add: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md },
  input: { borderWidth: 2, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, minHeight: 44, outlineStyle: 'none' } as never,
});
