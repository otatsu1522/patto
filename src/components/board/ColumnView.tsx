import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { GESTURE } from '@/config/layout';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import { FONT, RADIUS, SPACING, useTheme } from '@/theme';
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
  /** いずれかのタスクをドラッグ中（お気に入りの置き場を表示する） */
  taskDragActive: boolean;
  draggingColumn: boolean;
  menuItems: MenuItem[];
  taskMenu: (task: Task) => MenuItem[];
  onAdvance: (task: Task) => void;
  onAddTask: (title: string) => void;
  taskDrag: (task: Task) => DragHandlers;
  columnDrag: DragHandlers;
  /** お気に入りとそれ以外の境目の画面上のY座標を調べる関数を登録する（ドロップ判定用） */
  registerDivider: (columnId: string, measure: (() => Promise<number | null>) | null) => void;
  /** 横スクロールなど他の操作が始まったら増える。入力欄のフォーカスを外す合図 */
  blurSignal: number;
  onRefresh?: () => Promise<void>;
}

/** 1つのカンバン（列）: ヘッダー、縦スクロールのタスク一覧（お気に入りは上、横線で区切る）、末尾の「タスクを追加」。 */
export function ColumnView(p: ColumnViewProps) {
  const { colors, fs, taskColor, isDark } = useTheme();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const headerGesture = useDragGesture(p.columnDrag);
  const input = useRef<TextInput>(null);
  const divider = useRef<View>(null);

  const favorites = p.tasks.filter((x) => x.isFavorite);
  const others = p.tasks.filter((x) => !x.isFavorite);
  const showDivider = favorites.length > 0 && (others.length > 0 || p.taskDragActive);
  const showZone = favorites.length === 0 && p.taskDragActive;

  const { registerDivider, column } = p;
  useEffect(() => {
    registerDivider(
      column.id,
      () =>
        new Promise((resolve) => {
          if (!divider.current) return resolve(null);
          divider.current.measureInWindow((_x, y, _w, h) => resolve(y + h));
        }),
    );
    return () => registerDivider(column.id, null);
  }, [registerDivider, column.id]);

  // 他の操作（横スクロールなど）が始まったら、入力欄のフォーカスを外す
  useEffect(() => {
    if (p.blurSignal === 0) return;
    input.current?.blur();
    setAdding(false);
    setDraft('');
  }, [p.blurSignal]);

  const submit = () => {
    const title = draft.trim();
    if (title) p.onAddTask(title);
    setDraft('');
    if (!title) setAdding(false);
    else setTimeout(() => input.current?.focus(), 0);
  };

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
      style={[
        styles.column,
        {
          width: p.width,
          height: p.height,
          backgroundColor: colors.column,
          borderColor: p.dropTarget ? colors.accent : 'transparent',
          opacity: p.draggingColumn ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.header, headerFocused && { borderColor: colors.focus, borderWidth: 2 }, p.grabbed && headerFocused && { backgroundColor: colors.border }]}>
        <GestureDetector gesture={headerGesture}>
          <View style={styles.titleWrap}>
            {p.column.color ? <View style={[styles.dot, { backgroundColor: taskColor(p.column.color) }]} /> : null}
            <AppText bold numberOfLines={1} style={styles.title}>
              {p.column.title}
            </AppText>
            <AppText variant="caption" muted>
              {t('column.taskCount', { count: p.tasks.length })}
            </AppText>
            {p.column.isDoneColumn ? <Icon name="doneMode" size={22} color={colors.success} /> : null}
          </View>
        </GestureDetector>
        <DropdownMenu
          items={p.menuItems}
          trigger={(open) => <IconButton icon="more" label={p.column.title} onPress={open} box={40} size={22} />}
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
        {showZone ? (
          <View ref={divider} style={[styles.zone, { borderColor: colors.textMuted }]}>
            <AppText variant="caption" muted>
              {t('board.favoriteZone')}
            </AppText>
          </View>
        ) : null}
        {favorites.map(card)}
        {showDivider ? <View ref={divider} style={[styles.divider, { backgroundColor: colors.textMuted }]} /> : null}
        {others.map(card)}

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
            style={[styles.input, { borderBottomColor: colors.text, color: colors.text, fontSize: fs(FONT.body) }]}
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
            <Icon name="add" size={20} color={colors.textMuted} />
            <AppText muted>{t('task.add')}</AppText>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { borderRadius: RADIUS.lg, borderWidth: 2, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: SPACING.md, paddingRight: SPACING.xs, margin: 2 },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: GESTURE.edgeZone, cursor: 'grab' } as never,
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { flexShrink: 1 },
  list: { flex: 1 },
  listContent: { padding: SPACING.sm, gap: SPACING.sm },
  divider: { height: 2, marginVertical: SPACING.xs },
  zone: { minHeight: 36, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
  input: { borderBottomWidth: 2, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, minHeight: 48, backgroundColor: 'transparent', outlineStyle: 'none' } as never,
});
