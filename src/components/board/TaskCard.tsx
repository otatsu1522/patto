import { useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { GestureDetector } from 'react-native-gesture-handler';
import { dueState, formatDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { nowMs } from '@/lib/clock';
import { formatDateTime } from '@/lib/dates';
import { SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { BORDER_WIDTH } from '@/theme/tokens';
import { canHover } from '@/lib/hover';

interface Props {
  task: Task;
  done: boolean;
  compact: boolean;
  detailed: boolean;
  isLast: boolean;
  canAdvance: boolean;
  focused: boolean;
  grabbed: boolean;
  dragging: boolean;
  menuItems: MenuItem[];
  showDescription: boolean;
  showDueDate: boolean;
  showUpdatedAt: boolean;
  onAdvance: () => void;
  onCopyTitle: () => void;
  onMeasure?: (id: string, node: View | null) => void;
  drag: DragHandlers;
}

/** タスクカード。色丸の押下でタイトルをコピーし、右端のボタンで次のカンバンへ移動する。 */
export function TaskCard({
  task,
  done,
  compact,
  detailed,
  isLast,
  canAdvance,
  focused,
  grabbed,
  dragging,
  menuItems,
  showDescription,
  showDueDate,
  showUpdatedAt,
  onAdvance,
  onCopyTitle,
  onMeasure,
  drag,
}: Props) {
  const { colors, taskColor, isDark } = useTheme();
  const lastDragEnd = useRef(0);
  const cardRef = useRef<View>(null);
  const gesture = useDragGesture({
    ...drag,
    begin: (x, y) => {
      if (!cardRef.current) return drag.begin(x, y);
      cardRef.current.measureInWindow((cx, cy, w, h) =>
        drag.begin(x, y, { ox: x - cx, oy: y - cy, w, h }),
      );
    },
    end: (cancelled) => {
      lastDragEnd.current = Date.now();
      drag.end(cancelled);
    },
  });

  const due = task.dueAt !== null ? { dueAt: task.dueAt, dueHasTime: false } : null;
  const state = due ? dueState(due, nowMs()) : null;
  const dueColor =
    state === 'overdue'
      ? colors.danger
      : state === 'today'
        ? isDark
          ? '#FFB86B'
          : '#B54708'
        : state === 'tomorrow'
          ? isDark
            ? '#FDD663'
            : '#9A6700'
          : colors.textMuted;
  const dueStatus =
    state === 'overdue'
      ? t('task.dueStatusOverdue')
      : state === 'today'
        ? t('task.dueStatusToday')
        : state === 'tomorrow'
          ? t('task.dueStatusTomorrow')
          : '';
  const dueText = due
    ? `${t('task.due')}: ${formatDue(due)}${dueStatus ? ` ${dueStatus}` : ''}`
    : '';
  const strike = done ? styles.done : undefined;

  return (
    <View
      ref={(node) => {
        cardRef.current = node;
        onMeasure?.(task.id, node);
      }}
      collapsable={false}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('task.copyTitleAction')}
        onPress={async () => {
          try {
            const copied = await Clipboard.setStringAsync(task.title);
            if (copied) onCopyTitle();
          } catch {
            // クリップボードが利用できない環境では、タスク操作自体には影響させない。
          }
        }}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.colorButton,
          { backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent' },
        ]}
      >
        {task.color ? (
          <View style={[styles.dot, { backgroundColor: taskColor(task.color) }]} />
        ) : null}
      </Pressable>
      <DropdownMenu
        items={menuItems}
        anchorStyle={styles.anchor}
        trigger={(open) => (
          <GestureDetector gesture={gesture} touchAction="manipulation" enableContextMenu={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={task.title}
              onPress={() => {
                if (Date.now() - lastDragEnd.current > 300) open();
              }}
              style={[styles.body, compact && styles.compactBody]}
            >
              <View style={styles.titleRow}>
                <AppText
                  bold
                  numberOfLines={compact ? 2 : undefined}
                  ellipsizeMode="tail"
                  style={[styles.title, strike]}
                >
                  {task.title}
                </AppText>
              </View>
              {showDescription && task.description ? (
                <AppText
                  variant="caption"
                  muted
                  numberOfLines={detailed ? undefined : 2}
                  ellipsizeMode="tail"
                  style={strike}
                >
                  {task.description}
                </AppText>
              ) : null}
              {(showDueDate && due) || showUpdatedAt ? (
                <View style={styles.metadataList}>
                  {showDueDate && due ? (
                    <View style={styles.metadataItem}>
                      <Icon name="calendar" size={16} color={dueColor} />
                      <AppText
                        variant="caption"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        color={dueColor}
                        style={[styles.metadataText, strike]}
                      >
                        {dueText}
                      </AppText>
                    </View>
                  ) : null}
                  {showUpdatedAt ? (
                    <View style={styles.metadataItem}>
                      <Icon name="refresh" size={16} color={colors.textMuted} />
                      <AppText
                        variant="caption"
                        muted
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[styles.metadataText, strike]}
                      >
                        {`${t('task.updatedShort')}: ${formatDateTime(task.updatedAt)}`}
                      </AppText>
                    </View>
                  ) : null}
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
            { backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent' },
          ]}
        >
          <Icon name={isLast ? 'uturn' : 'forward'} size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 高さは本文の内容に合わせる。固定の minHeight は1行タイトルの下に空白を作るため指定しない。
  card: { flexDirection: 'row', alignItems: 'stretch' },
  colorButton: { width: 36, alignItems: 'center', justifyContent: 'center' },
  anchor: { flex: 1, minWidth: 0 },
  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: 0,
    gap: SPACING.xs + 2,
    cursor: 'grab',
  } as never,
  compactBody: { paddingVertical: SPACING.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  title: { flexShrink: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  metadataList: { flexDirection: 'column', alignItems: 'stretch', gap: SPACING.xs, minWidth: 0 },
  metadataItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, minWidth: 0 },
  metadataText: { flex: 1, minWidth: 0 },
  advance: { width: 36, alignItems: 'center', justifyContent: 'center' },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
});
