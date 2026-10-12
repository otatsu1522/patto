import { useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { dueState, formatDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { nowMs } from '@/lib/clock';
import { SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { BORDER_WIDTH } from '@/theme/tokens';

interface Props {
  task: Task;
  /** 所属カンバンが DONE モードか（横線で表示する） */
  done: boolean;
  /** 説明を隠してコンパクトに表示する */
  compact: boolean;
  /** いちばん右のカンバンか（右へ移動の代わりに、最初へ戻るUターンを出す） */
  isLast: boolean;
  /** カンバンが1つだけのとき、移動ボタンを出さない */
  canAdvance: boolean;
  focused: boolean;
  grabbed: boolean;
  dragging: boolean;
  menuItems: MenuItem[];
  onAdvance: () => void;
  drag: DragHandlers;
}

/** タスクのカード。タップでメニュー、右端のボタンで次のカンバンへ、長押し（PCはドラッグ）でつかんで移動。 */
export function TaskCard({ task, done, compact, isLast, canAdvance, focused, grabbed, dragging, menuItems, onAdvance, drag }: Props) {
  const { colors, taskColor } = useTheme();
  const lastDragEnd = useRef(0);
  const gesture = useDragGesture({
    ...drag,
    end: (cancelled) => {
      lastDragEnd.current = Date.now();
      drag.end(cancelled);
    },
  });

  const due = task.dueAt !== null ? { dueAt: task.dueAt, dueHasTime: false } : null;
  const state = due ? dueState(due, nowMs()) : null;
  const dueColor = state === 'overdue' ? colors.danger : state === 'today' ? colors.warning : colors.textMuted;
  const strike = done ? styles.done : undefined;

  return (
    <View
      style={[
        styles.card,
        SHADOW.card,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.focus : colors.border,
          borderWidth: focused ? 2 : BORDER_WIDTH,
          opacity: dragging ? 0.35 : 1,
        },
        grabbed && { backgroundColor: colors.hover, borderStyle: 'dashed' },
      ]}
    >
      <DropdownMenu
        items={menuItems}
        anchorStyle={styles.anchor}
        trigger={(open) => (
          <GestureDetector gesture={gesture}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={task.title}
              onPress={() => {
                if (Date.now() - lastDragEnd.current > 300) open();
              }}
              style={styles.body}
            >
              <View style={styles.titleRow}>
                {task.color ? <View style={[styles.dot, { backgroundColor: taskColor(task.color) }]} /> : null}
                <AppText bold numberOfLines={2} style={[styles.title, strike]}>
                  {task.title}
                </AppText>
              </View>
              {task.description && !compact ? (
                <AppText variant="caption" muted numberOfLines={2} style={strike}>
                  {task.description}
                </AppText>
              ) : null}
              {due ? (
                <View style={styles.meta}>
                  <Icon name="calendar" size={14} color={dueColor} />
                  <AppText variant="caption" bold={state !== 'upcoming'} color={dueColor} style={strike}>
                    {state === 'overdue' ? `${t('task.overdue')} ` : state === 'today' ? `${t('task.today')} ` : ''}
                    {formatDue(due)}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          </GestureDetector>
        )}
      />
      {canAdvance ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('task.moveFirst') : t('task.moveRight')}
          onPress={() => {
            Keyboard.dismiss();
            onAdvance();
          }}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.advance,
            { backgroundColor: pressed || hovered ? colors.hover : 'transparent' },
          ]}
        >
          <Icon name={isLast ? 'uturn' : 'forward'} size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'stretch', minHeight: 76 },
  anchor: { flex: 1 },
  body: { flex: 1, paddingVertical: SPACING.md + 2, paddingLeft: SPACING.lg, paddingRight: SPACING.sm, gap: SPACING.xs + 2, cursor: 'grab' } as never,
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  title: { flexShrink: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  advance: { width: 36, alignItems: 'center', justifyContent: 'center' },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
});
