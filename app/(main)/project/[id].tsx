import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { ArchiveDialog } from '@/components/board/ArchiveDialog';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView, type BoardViewHandle } from '@/components/board/BoardView';
import { ColumnDialog } from '@/components/board/NameDialogs';
import { TaskDialog, type TaskFormValues } from '@/components/board/TaskDialog';
import { AppText } from '@/components/ui/AppText';
import { DropdownMenu, type MenuItem } from '@/components/ui/DropdownMenu';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { isSupabaseConfigured } from '@/config/env';
import { FONT } from '@/theme/tokens';
import { LIMITS } from '@/config/limits';
import { columnsOf, isActive, searchTasks, tasksOf } from '@/domain/selectors';
import type { ColumnSortMode, KanbanColumn, Task } from '@/domain/types';
import { useBoardActions } from '@/features/useBoardActions';
import { popUndo } from '@/features/undo';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { clampCursor, initialCursor, moveCursor, type Cursor, type Direction } from '@/shortcuts/cursor';
import { useEscape, useShortcuts } from '@/shortcuts/useShortcuts';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { syncNow } from '@/sync/controller';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';

type TaskDialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; taskId: string } | null;

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, fs } = useTheme();
  const { mode } = useLayoutMode();
  const { confirm } = useFeedback();
  const boardRef = useRef<BoardViewHandle>(null);

  const ready = useDataStore((s) => s.ready);
  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const density = useSettingsStore((s) => s.settings.cardDensity);
  const syncMode = useSettingsStore((s) => s.settings.syncMode);
  const identity = useAuthStore((s) => s.identity);
  const searchTick = useUiStore((s) => s.boardSearchFocusTick);

  const project = projects.find((p) => p.id === id);
  const cols = useMemo(() => (id ? columnsOf(columns, id) : []), [columns, id]);
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const c of cols) map.set(c.id, tasksOf(tasks, c.id, c.sortMode));
    return map;
  }, [cols, tasks]);
  const counts = cols.map((c) => tasksByColumn.get(c.id)?.length ?? 0);

  const actions = useBoardActions(id ?? '');
  const store = useDataStore.getState();

  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [columnDialog, setColumnDialog] = useState<{ column: KanbanColumn | null } | null>(null);
  const [archiveKind, setArchiveKind] = useState<'archive' | 'trash' | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const follow = useRef<string | null>(null);

  useEffect(() => {
    if (project && isActive(project) && id) useSettingsStore.getState().update({ lastProjectId: id });
  }, [project, id]);

  // 検索ショートカット（/）で検索欄を開く
  useEffect(() => {
    if (searchTick === 0) return;
    setSearchOpen(true);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [searchTick]);

  // つかんで動かしたタスクにキーボードのカーソルを追従させる
  useEffect(() => {
    const taskId = follow.current;
    if (!taskId) return;
    follow.current = null;
    cols.forEach((c, columnIndex) => {
      const taskIndex = (tasksByColumn.get(c.id) ?? []).findIndex((x) => x.id === taskId);
      if (taskIndex >= 0) setCursor((prev) => ({ ...(prev ?? initialCursor()), columnIndex, taskIndex }));
    });
  }, [tasksByColumn, cols]);

  const results = useMemo(
    () => (id && query.trim() ? searchTasks({ projects, columns, tasks }, query, id) : []),
    [projects, columns, tasks, query, id],
  );

  const syncEnabled = !!identity && !identity.local && isSupabaseConfigured && syncMode !== 'off';

  // ---- キーボード操作 ----
  const current = (): Cursor => clampCursor(cursor ?? initialCursor(), counts);
  const cursorColumn = (): KanbanColumn | undefined => cols[current().columnIndex];
  const cursorTask = (): Task | undefined => {
    const c = current();
    const col = cols[c.columnIndex];
    return col && c.taskIndex >= 0 ? tasksByColumn.get(col.id)?.[c.taskIndex] : undefined;
  };
  const update = (fn: (c: Cursor) => Cursor) => setCursor(clampCursor(fn(current()), counts));

  const navigate = async (dir: Direction) => {
    const c = current();
    if (!c.grabbed) return update((x) => moveCursor(x, dir, counts));
    const col = cols[c.columnIndex];
    if (!col) return;
    const horizontal = dir === 'left' || dir === 'right';
    const step = dir === 'left' || dir === 'up' ? -1 : 1;
    const task = cursorTask();
    if (task) {
      if (horizontal) {
        const target = cols[c.columnIndex + step];
        if (target) {
          follow.current = task.id;
          await actions.moveTask(task, target);
        }
      } else if (col.sortMode === 'manual') {
        await store.reorderTask(task.id, c.taskIndex + step);
        update((x) => ({ ...x, taskIndex: x.taskIndex + step }));
      }
    } else if (horizontal && cols[c.columnIndex + step]) {
      await store.moveColumn(col.id, c.columnIndex + step);
      update((x) => ({ ...x, columnIndex: x.columnIndex + step }));
    }
  };

  const openCreateTask = (columnId?: string) => {
    const col = columnId ?? cursorColumn()?.id ?? cols[0]?.id;
    if (col) setTaskDialog({ mode: 'create', columnId: col });
  };

  useShortcuts({
    cursorLeft: () => void navigate('left'),
    cursorRight: () => void navigate('right'),
    cursorUp: () => void navigate('up'),
    cursorDown: () => void navigate('down'),
    grab: () => cols.length > 0 && update((c) => ({ ...c, grabbed: !c.grabbed })),
    edit: () => {
      const task = cursorTask();
      if (task) setTaskDialog({ mode: 'edit', taskId: task.id });
      else if (cols.length > 0) setColumnDialog({ column: cursorColumn() ?? null });
    },
    delete: () => {
      const task = cursorTask();
      if (task) void actions.deleteTask(task);
      else if (cursorColumn()) void actions.deleteColumn(cursorColumn()!);
    },
    newTask: () => openCreateTask(),
    newColumn: () => setColumnDialog({ column: null }),
    toggleFavorite: () => {
      const task = cursorTask();
      if (task) void store.updateTask(task.id, { isFavorite: !task.isFavorite });
    },
    archiveTask: () => {
      const task = cursorTask();
      if (task) void actions.archiveTask(task);
    },
    archiveDone: () => void actions.archiveDone(),
    duplicate: () => {
      const task = cursorTask();
      if (task) void store.duplicateTask(task.id);
      else if (cursorColumn()) void store.duplicateColumn(cursorColumn()!.id);
    },
    moveColumnLeft: () => moveColumnBy(-1),
    moveColumnRight: () => moveColumnBy(1),
    undo: () => void popUndo(),
  });

  useEscape(() => {
    if (cursor?.grabbed) update((c) => ({ ...c, grabbed: false }));
    else if (searchOpen) closeSearch();
    else if (cursor) setCursor(null);
  });

  function moveColumnBy(step: -1 | 1) {
    const c = current();
    const col = cols[c.columnIndex];
    if (!col || !cols[c.columnIndex + step]) return;
    void store.moveColumn(col.id, c.columnIndex + step);
    update((x) => ({ ...x, columnIndex: x.columnIndex + step }));
  }

  function closeSearch() {
    setQuery('');
    setSearchOpen(false);
  }

  if (!ready) return null;
  if (!project || !isActive(project)) return <Redirect href="/home" />;

  // ---- メニュー ----
  const boardMenu: MenuItem[] = [
    { label: t('column.new'), icon: 'add', disabled: cols.length >= LIMITS.maxColumnsPerProject, onPress: () => setColumnDialog({ column: null }) },
    { label: t('board.archiveDone'), icon: 'check', onPress: () => void actions.archiveDone() },
    { label: t('board.openArchive'), icon: 'archive', separator: true, onPress: () => setArchiveKind('archive') },
    { label: t('board.clearArchive'), icon: 'trash', destructive: true, onPress: () => void actions.clear('archive') },
    { label: t('board.openTrash'), icon: 'trash', separator: true, onPress: () => setArchiveKind('trash') },
    { label: t('board.clearTrash'), icon: 'trash', destructive: true, onPress: () => void actions.clear('trash') },
  ];

  const sortLabel = (m: ColumnSortMode) => `${t('column.sortMode')}: ${t(m === 'updated' ? 'column.sort.updated' : m === 'manual' ? 'column.sort.manual' : 'column.sort.due')}`;
  const columnMenu = (column: KanbanColumn, index: number): MenuItem[] => [
    { label: t('column.rename'), icon: 'edit', onPress: () => setColumnDialog({ column }) },
    { label: t('column.moveLeft'), icon: 'left', disabled: index === 0, onPress: () => void store.moveColumn(column.id, index - 1) },
    { label: t('column.moveRight'), icon: 'right', disabled: index === cols.length - 1, onPress: () => void store.moveColumn(column.id, index + 1) },
    ...(['updated', 'manual', 'due'] as ColumnSortMode[]).map((m, i) => ({
      label: sortLabel(m),
      icon: (column.sortMode === m ? 'check' : undefined) as MenuItem['icon'],
      separator: i === 0,
      onPress: () => void store.updateColumn(column.id, { sortMode: m }),
    })),
    { label: column.isDoneColumn ? t('column.unsetDone') : t('column.setDone'), icon: 'check', separator: true, onPress: () => void store.updateColumn(column.id, { isDoneColumn: !column.isDoneColumn }) },
    { label: t('common.duplicate'), icon: 'copy', onPress: () => void store.duplicateColumn(column.id) },
    { label: t('common.delete'), icon: 'trash', destructive: true, separator: true, onPress: () => void actions.deleteColumn(column) },
  ];

  const editingTask = taskDialog?.mode === 'edit' ? tasks.find((x) => x.id === taskDialog.taskId) ?? null : null;

  const submitTask = async (v: TaskFormValues) => {
    const dialog = taskDialog;
    setTaskDialog(null);
    if (!dialog) return;
    if (dialog.mode === 'edit') await store.updateTask(dialog.taskId, v);
    else await store.createTask({ projectId: project.id, columnId: dialog.columnId, ...v });
  };

  const searchField = (
    <View style={[styles.search, { backgroundColor: colors.column, borderColor: colors.border }]}>
      <Icon name="search" size={16} color={colors.textMuted} />
      <TextInput
        ref={searchRef}
        value={query}
        onChangeText={setQuery}
        placeholder={t('board.search')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('board.search')}
        style={[styles.searchInput, { color: colors.text, fontSize: fs(FONT.body) }]}
      />
      <IconButton icon="close" label={t('common.close')} onPress={closeSearch} box={30} size={16} />
    </View>
  );

  return (
    <View style={styles.fill}>
      <BoardHeader
        title={project.title}
        right={
          <>
            {searchOpen || mode === 'expanded' ? (
              <View style={mode === 'expanded' ? styles.searchWide : styles.searchNarrow}>{searchField}</View>
            ) : (
              <IconButton icon="search" label={t('board.search')} onPress={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }} />
            )}
            <DropdownMenu items={boardMenu} trigger={(open) => <IconButton icon="more" label={t('board.menu')} onPress={open} />} />
          </>
        }
      />

      <View style={styles.fill}>
        <BoardView
          ref={boardRef}
          columns={cols}
          tasksOf={(columnId) => tasksByColumn.get(columnId) ?? []}
          cursor={cursor}
          compactCards={density === 'compact'}
          menuItemsFor={columnMenu}
          onTaskPress={(task) => setTaskDialog({ mode: 'edit', taskId: task.id })}
          onTaskMove={(task, dir) => void actions.moveTaskBy(task, dir)}
          onTaskDrop={(task, target) => void actions.moveTask(task, target)}
          onColumnDrop={(column, toIndex) => void store.moveColumn(column.id, toIndex)}
          onAddTask={(column, title) => void store.createTask({ projectId: project.id, columnId: column.id, title })}
          onRefresh={syncEnabled ? async () => void (await syncNow()) : undefined}
        />

        {cursor?.grabbed ? (
          <View pointerEvents="none" style={[styles.banner, SHADOW.float, { backgroundColor: colors.primary }]}>
            <AppText bold color={colors.onPrimary}>
              {t('task.grabbed')}
            </AppText>
          </View>
        ) : null}

        {query.trim() ? (
          <View style={[styles.results, SHADOW.float, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.length === 0 ? (
                <AppText muted style={styles.resultItem}>
                  {t('board.searchEmpty')}
                </AppText>
              ) : (
                results.map((task) => (
                  <Pressable
                    key={task.id}
                    accessibilityRole="button"
                    onPress={() => {
                      closeSearch();
                      setTaskDialog({ mode: 'edit', taskId: task.id });
                    }}
                    style={styles.resultItem}
                  >
                    <AppText numberOfLines={1}>{task.title}</AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {cols.find((c) => c.id === task.columnId)?.title}
                    </AppText>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <TaskDialog
        visible={taskDialog !== null}
        task={editingTask}
        onClose={() => setTaskDialog(null)}
        onSubmit={submitTask}
        onDelete={editingTask ? async () => ((await actions.deleteTask(editingTask)) ? setTaskDialog(null) : undefined) : undefined}
        onDuplicate={editingTask ? () => { void store.duplicateTask(editingTask.id); setTaskDialog(null); } : undefined}
        onArchive={editingTask ? () => { void actions.archiveTask(editingTask); setTaskDialog(null); } : undefined}
      />
      <ColumnDialog
        visible={columnDialog !== null}
        column={columnDialog?.column ?? null}
        onClose={() => setColumnDialog(null)}
        onSubmit={async (v) => {
          const target = columnDialog?.column;
          setColumnDialog(null);
          if (target) await store.updateColumn(target.id, v);
          else await store.createColumn({ projectId: project.id, ...v });
        }}
      />
      <ArchiveDialog
        kind={archiveKind}
        projectId={project.id}
        onClose={() => setArchiveKind(null)}
        onClear={async () => {
          const kind = archiveKind;
          setArchiveKind(null);
          if (kind) await actions.clear(kind);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingLeft: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 38 },
  searchInput: { flex: 1, paddingVertical: SPACING.xs, outlineStyle: 'none' } as never,
  searchWide: { width: 260 },
  searchNarrow: { flex: 1 },
  banner: { position: 'absolute', top: SPACING.md, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill },
  results: { position: 'absolute', top: SPACING.xs, right: SPACING.md, left: SPACING.md, maxHeight: 320, maxWidth: 520, alignSelf: 'flex-end', borderRadius: RADIUS.md, borderWidth: 1, overflow: 'hidden' },
  resultItem: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, minHeight: 44, justifyContent: 'center' },
});
