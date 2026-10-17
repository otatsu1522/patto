import { useRef } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { GestureDetector } from 'react-native-gesture-handler';
import { UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import { dueState, formatDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { nowMs } from '@/lib/clock';
import { formatDateTime } from '@/lib/dates';
import { SHADOW, SPACING, useTheme, ICON_SIZE, OPACITY } from '@/theme';
import { TASK_DUE_STATUS_COLORS } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { BORDER_WIDTH_EMPHASIS } from '@/theme/tokens';
import { canHover, isTouchWeb } from '@/lib/hover';

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
  const { colors, taskColor, isDark, lineWidth, lineColor } = useTheme();
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
          ? TASK_DUE_STATUS_COLORS.dark.today
          : TASK_DUE_STATUS_COLORS.light.today
        : state === 'tomorrow'
          ? isDark
            ? TASK_DUE_STATUS_COLORS.dark.tomorrow
            : TASK_DUE_STATUS_COLORS.light.tomorrow
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
          borderColor: focused ? colors.focus : lineColor,
          borderWidth: focused ? BORDER_WIDTH_EMPHASIS : lineWidth,
          opacity: dragging ? OPACITY.draggingTask : OPACITY.fullyVisible,
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
        ) : (
          <View
            style={[
              styles.dot,
              styles.emptyDot,
              { borderColor: colors.border, borderWidth: lineWidth },
            ]}
          />
        )}
      </Pressable>
      <DropdownMenu
        items={menuItems}
        anchorStyle={styles.anchor}
        trigger={(open) => (
          <GestureDetector
            gesture={gesture}
            touchAction={Platform.OS === 'web' && isTouchWeb ? 'auto' : 'manipulation'}
            enableContextMenu={false}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={task.title}
              onPress={() => {
                if (Date.now() - lastDragEnd.current > TIMING.taskClickAfterDragGuardMs) open();
              }}
              style={[styles.body, compact && styles.compactBody]}
            >
              <View style={styles.titleRow}>
                <AppText
                  bold
                  numberOfLines={compact ? UI_METRICS.text.previewLines : undefined}
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
                  numberOfLines={detailed ? undefined : UI_METRICS.text.previewLines}
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
                      <Icon name="calendar" size={ICON_SIZE.md} color={dueColor} />
                      <AppText
                        variant="caption"
                        numberOfLines={UI_METRICS.text.singleLineMax}
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
                      <Icon name="refresh" size={ICON_SIZE.md} color={colors.textMuted} />
                      <AppText
                        variant="caption"
                        muted
                        numberOfLines={UI_METRICS.text.singleLineMax}
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
          <Icon name={isLast ? 'uturn' : 'forward'} size={ICON_SIZE.xl} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 高さは本文の内容に合わせる。固定の minHeight は1行タイトルの下に空白を作るため指定しない。
  card: { flexDirection: 'row', alignItems: 'stretch' },
  colorButton: {
    width: UI_METRICS.board.taskActionWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchor: { flex: 1, minWidth: 0 },
  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: SPACING.md + UI_METRICS.board.taskContentPaddingAdjustment,
    paddingHorizontal: 0,
    gap: SPACING.xs + UI_METRICS.board.taskContentGapAdjustment,
    cursor: 'grab',
  } as never,
  compactBody: { paddingVertical: SPACING.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  title: { flexShrink: 1 },
  dot: {
    width: UI_METRICS.board.colorDotSize,
    height: UI_METRICS.board.colorDotSize,
    borderRadius: UI_METRICS.board.colorDotSize / 2,
  },
  emptyDot: { backgroundColor: 'transparent' },
  metadataList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: SPACING.md,
    rowGap: SPACING.xs,
    minWidth: 0,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 0,
  },
  metadataText: { flexShrink: 1, minWidth: 0 },
  advance: {
    width: UI_METRICS.board.taskActionWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { textDecorationLine: 'line-through', opacity: OPACITY.completed },
});
