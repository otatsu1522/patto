import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { BOARD } from '@/config/layout';
import { dueState, formatDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { nowMs } from '@/lib/clock';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { TASK_COLORS } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useDragGesture, type DragHandlers } from './dragGesture';

interface Props {
  task: Task;
  compact: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  focused: boolean;
  grabbed: boolean;
  dragging: boolean;
  onPress: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  drag: DragHandlers;
}

/** タスクのカード。左右の矢印で隣のカンバンへ移動、タップで編集、長押し（PCはドラッグ）で移動。 */
export function TaskCard({ task, compact, hasLeft, hasRight, focused, grabbed, dragging, onPress, onMoveLeft, onMoveRight, drag }: Props) {
  const { colors } = useTheme();
  const lastDragEnd = useRef(0);
  const gesture = useDragGesture({
    ...drag,
    end: (cancelled) => {
      lastDragEnd.current = Date.now();
      drag.end(cancelled);
    },
  });

  const due = task.dueAt !== null ? { dueAt: task.dueAt, dueHasTime: task.dueHasTime } : null;
  const state = due ? dueState(due, nowMs()) : null;
  const dueColor = state === 'overdue' ? colors.danger : state === 'today' ? colors.warning : colors.textMuted;
  const done = task.completedAt !== null;

  return (
    <View
      style={[
        styles.card,
        SHADOW.card,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.focus : colors.border,
          borderWidth: focused ? 2 : 1,
          opacity: dragging ? 0.35 : 1,
        },
        grabbed && { backgroundColor: colors.column, borderStyle: 'dashed' },
      ]}
    >
      <View style={styles.side}>
        {hasLeft ? <IconButton icon="left" label={t('task.moveLeft')} onPress={onMoveLeft} box={34} size={18} color={colors.textMuted} /> : null}
      </View>
      <GestureDetector gesture={gesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={task.title}
          onPress={() => {
            if (Date.now() - lastDragEnd.current > 300) onPress();
          }}
          style={styles.body}
        >
          {task.color ? <View style={[styles.bar, { backgroundColor: TASK_COLORS[task.color] }]} /> : null}
          <View style={styles.texts}>
            <AppText bold numberOfLines={compact ? 1 : 2} style={done ? styles.done : undefined}>
              {task.title}
            </AppText>
            {due || task.isFavorite || done ? (
              <View style={styles.meta}>
                {task.isFavorite ? <Icon name="star" size={14} color={colors.accent} /> : null}
                {done ? (
                  <View style={styles.metaItem}>
                    <Icon name="check" size={14} color={colors.success} />
                    <AppText variant="caption" color={colors.success}>
                      {t('task.completed')}
                    </AppText>
                  </View>
                ) : null}
                {due ? (
                  <View style={styles.metaItem}>
                    <Icon name="calendar" size={14} color={dueColor} />
                    <AppText variant="caption" bold={state !== 'upcoming'} color={dueColor}>
                      {state === 'overdue' ? `${t('task.overdue')} ` : state === 'today' ? `${t('task.today')} ` : ''}
                      {formatDue(due)}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
      </GestureDetector>
      <View style={styles.side}>
        {hasRight ? <IconButton icon="right" label={t('task.moveRight')} onPress={onMoveRight} box={34} size={18} color={colors.textMuted} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'stretch', borderRadius: RADIUS.md, minHeight: BOARD.touchTarget, overflow: 'hidden' },
  side: { width: 34, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, flexDirection: 'row', paddingVertical: SPACING.sm, gap: SPACING.sm, cursor: 'grab' } as never,
  bar: { width: 5, borderRadius: 3 },
  texts: { flex: 1, gap: SPACING.xs, justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  done: { textDecorationLine: 'line-through', opacity: 0.7 },
});
