import {
  useCallback,
  useRef,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View, type ViewProps } from 'react-native';
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

type WebClickableViewProps = ViewProps & {
  onClick?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  tabIndex?: 0 | -1;
};
const WebClickableView = View as ComponentType<WebClickableViewProps>;

function CardBodyTrigger({ onActivate, ...props }: ViewProps & { onActivate: () => void }) {
  if (Platform.OS === 'web') {
    return (
      <WebClickableView
        {...props}
        accessibilityRole={undefined}
        role="group"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
          }
        }}
      />
    );
  }
  return <Pressable {...props} onPress={onActivate} />;
}

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
  showMetadataIcons: boolean;
  onAdvance: () => void;
  onCopyTitle: () => void;
  onCopyDescription: () => void;
  onMeasure?: (id: string, node: View | null) => void;
  drag: DragHandlers;
}

/** タスクカード。タイトル・説明のコピーと次のカンバンへの移動を操作する。 */
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
  showMetadataIcons,
  onAdvance,
  onCopyTitle,
  onCopyDescription,
  onMeasure,
  drag,
}: Props) {
  const { colors, taskColor, isDark, lineWidth, lineColor, fs } = useTheme();
  const lastDragEnd = useRef(0);
  const cardRef = useRef<View>(null);
  const registerCardRef = useCallback(
    (node: View | null) => {
      cardRef.current = node;
      onMeasure?.(task.id, node);
    },
    [onMeasure, task.id],
  );
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
  const descriptionVisible = showDescription && task.description.trim().length > 0;
  const metadataIconsVisible = showMetadataIcons;

  const copyText = async (value: string, onCopied: () => void) => {
    try {
      await Clipboard.setStringAsync(value);
      onCopied();
    } catch {
      // クリップボードが利用できない環境では、タスク操作自体には影響させない。
    }
  };
  const bodyVerticalPadding = compact
    ? SPACING.sm
    : SPACING.md + UI_METRICS.board.taskContentPaddingAdjustment;
  const bodyGap = SPACING.xs + UI_METRICS.board.taskContentGapAdjustment;
  const metadata =
    (showDueDate && due) || showUpdatedAt ? (
      <View style={styles.metadataList}>
        {showDueDate && due ? (
          <View style={styles.metadataItem}>
            {metadataIconsVisible ? (
              <Icon name="calendar" size={ICON_SIZE.md} color={dueColor} />
            ) : null}
            <AppText
              variant="caption"
              numberOfLines={2}
              ellipsizeMode="tail"
              color={dueColor}
              style={[styles.metadataText, { fontSize: fs(11) }, strike]}
            >
              {dueText}
            </AppText>
          </View>
        ) : null}
        {showUpdatedAt ? (
          <View style={styles.metadataItem}>
            {metadataIconsVisible ? (
              <Icon name="refresh" size={ICON_SIZE.md} color={colors.textMuted} />
            ) : null}
            <AppText
              variant="caption"
              muted
              numberOfLines={2}
              ellipsizeMode="tail"
              style={[styles.metadataText, { fontSize: fs(11) }, strike]}
            >
              {`${t('task.updatedShort')}: ${formatDateTime(task.updatedAt)}`}
            </AppText>
          </View>
        ) : null}
      </View>
    ) : null;

  return (
    <View
      ref={registerCardRef}
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
      {!descriptionVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('task.copyTitleAction')}
          onPress={() => void copyText(task.title, onCopyTitle)}
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
      ) : null}
      <DropdownMenu
        items={menuItems}
        anchorStyle={styles.anchor}
        trigger={(open) => (
          <GestureDetector
            gesture={gesture}
            touchAction={Platform.OS === 'web' && isTouchWeb ? 'auto' : 'manipulation'}
            enableContextMenu={false}
          >
            <CardBodyTrigger
              accessibilityRole="button"
              accessibilityLabel={task.title}
              onActivate={() => {
                if (Date.now() - lastDragEnd.current > TIMING.taskClickAfterDragGuardMs) open();
              }}
              style={[
                styles.body,
                compact && styles.compactBody,
                descriptionVisible && styles.bodyWithDescription,
              ]}
            >
              <View style={[styles.titleRow, descriptionVisible && { gap: 0 }]}>
                {descriptionVisible ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('task.copyTitleAction')}
                    onPress={(event) => {
                      event.stopPropagation();
                      void copyText(task.title, onCopyTitle);
                    }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.inlineAction,
                      {
                        paddingTop: bodyVerticalPadding,
                        paddingBottom: bodyGap,
                      },
                      {
                        backgroundColor:
                          pressed || (hovered && canHover) ? colors.hover : 'transparent',
                      },
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
                ) : null}
                <AppText
                  bold
                  numberOfLines={compact ? UI_METRICS.text.previewLines : undefined}
                  ellipsizeMode="tail"
                  style={[
                    styles.title,
                    strike,
                    descriptionVisible && {
                      paddingTop: bodyVerticalPadding,
                      paddingBottom: bodyGap,
                    },
                  ]}
                >
                  {task.title}
                </AppText>
              </View>
              {descriptionVisible ? (
                <View style={styles.descriptionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('task.copyDescriptionAction')}
                    onPress={(event) => {
                      event.stopPropagation();
                      void copyText(task.description, onCopyDescription);
                    }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.inlineAction,
                      { paddingBottom: bodyVerticalPadding },
                      {
                        backgroundColor:
                          pressed || (hovered && canHover) ? colors.hover : 'transparent',
                      },
                    ]}
                  >
                    <Icon name="document" size={ICON_SIZE.md} color={colors.textMuted} />
                  </Pressable>
                  <View style={[styles.descriptionContent, { paddingBottom: bodyVerticalPadding }]}>
                    <AppText
                      variant="caption"
                      muted
                      numberOfLines={detailed ? undefined : UI_METRICS.text.previewLines}
                      ellipsizeMode="tail"
                      style={[styles.descriptionText, strike]}
                    >
                      {task.description}
                    </AppText>
                    {metadata}
                  </View>
                </View>
              ) : null}
              {!descriptionVisible ? metadata : null}
            </CardBodyTrigger>
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
  bodyWithDescription: { paddingVertical: 0, gap: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'stretch' },
  descriptionRow: { flexDirection: 'row', alignItems: 'stretch' },
  descriptionContent: {
    flex: 1,
    minWidth: 0,
    gap: SPACING.xs + UI_METRICS.board.taskContentGapAdjustment,
  },
  inlineAction: {
    width: UI_METRICS.board.taskActionWidth,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { flexShrink: 1, minWidth: 0 },
  descriptionText: { flexShrink: 1, minWidth: 0 },
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
