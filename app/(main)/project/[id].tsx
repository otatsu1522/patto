import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { ArchiveDialog } from '@/components/board/ArchiveDialog';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView, type BoardViewHandle } from '@/components/board/BoardView';
import { ColumnDialog } from '@/components/board/NameDialogs';
import { SearchResults } from '@/components/board/SearchResults';
import { TaskDialog, type TaskFormValues } from '@/components/board/TaskDialog';
import { AppText } from '@/components/ui/AppText';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { DropdownMenu, type MenuItem } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import { isSupabaseConfigured } from '@/config/env';
import { BOARD } from '@/config/layout';
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
import { SHADOW, SPACING, useTheme } from '@/theme';

type TaskDialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; taskId: string } | null;

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const boardRef = useRef<BoardViewHandle>(null);
  const { toast } = useFeedback();
  const { mode } = useLayoutMode();
  const pane = mode !== 'expanded';

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
  const [searching, setSearching] = useState(false);
  const follow = useRef<string | null>(null);

  useEffect(() => {
    if (project && isActive(project) && id) useSettingsStore.getState().update({ lastProjectId: id });
  }, [project, id]);

  // プロジェクトが切り替わったら、操作中の状態（カーソル・検索・ダイアログ）をリセットする
  useEffect(() => {
    setCursor(null);
    setQuery('');
    setSearching(false);
    setTaskDialog(null);
    setColumnDialog(null);
    setArchiveKind(null);
  }, [id]);

  // 検索ショートカット（/）で検索を開く
  useEffect(() => {
    if (searchTick > 0) setSearching(true);
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
    () => (id && searching && query.trim() ? searchTasks({ projects, columns, tasks }, query, id) : []),
    [projects, columns, tasks, query, id, searching],
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

  function moveColumnBy(step: -1 | 1) {
    const c = current();
    const col = cols[c.columnIndex];
    if (!col || !cols[c.columnIndex + step]) return;
    void store.moveColumn(col.id, c.columnIndex + step);
    update((x) => ({ ...x, columnIndex: x.columnIndex + step }));
  }

  function closeSearch() {
    setQuery('');
    setSearching(false);
  }

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
    if (searching) closeSearch();
    else if (cursor?.grabbed) update((c) => ({ ...c, grabbed: false }));
    else if (cursor) setCursor(null);
  });

  if (!ready) return null;
  if (!project || !isActive(project)) return <Redirect href="/home" />;

  // ---- メニュー ----
  const boardMenu: MenuItem[] = [
    { label: t('column.new'), icon: 'add', disabled: cols.length >= LIMITS.maxColumnsPerProject, onPress: () => setColumnDialog({ column: null }) },
    { label: t('board.search'), icon: 'search', onPress: () => setSearching(true) },
    { label: t('board.archiveDone'), icon: 'doneMode', separator: true, onPress: () => void actions.archiveDone() },
    { label: t('board.openArchive'), icon: 'archive', onPress: () => setArchiveKind('archive') },
    { label: t('board.clearArchive'), icon: 'trash', destructive: true, onPress: () => void actions.clear('archive') },
    { label: t('board.openTrash'), icon: 'trash', separator: true, onPress: () => setArchiveKind('trash') },
    { label: t('board.clearTrash'), icon: 'trash', destructive: true, onPress: () => void actions.clear('trash') },
  ];

  const sortLabel = (m: ColumnSortMode) => `${t('column.sortMode')}: ${t(m === 'updated' ? 'column.sort.updated' : m === 'manual' ? 'column.sort.manual' : 'column.sort.due')}`;
  const columnMenu = (column: KanbanColumn, index: number): MenuItem[] => [
    { label: t('column.rename'), icon: 'edit', onPress: () => setColumnDialog({ column }) },
    { label: t('task.add'), icon: 'add', onPress: () => openCreateTask(column.id) },
    { label: t('column.moveLeft'), icon: 'left', disabled: index === 0, onPress: () => void store.moveColumn(column.id, index - 1) },
    { label: t('column.moveRight'), icon: 'right', disabled: index === cols.length - 1, onPress: () => void store.moveColumn(column.id, index + 1) },
    ...(['updated', 'manual', 'due'] as ColumnSortMode[]).map((m, i) => ({
      label: sortLabel(m),
      icon: (column.sortMode === m ? 'check' : undefined) as MenuItem['icon'],
      separator: i === 0,
      onPress: () => void store.updateColumn(column.id, { sortMode: m }),
    })),
    { label: column.isDoneColumn ? t('column.unsetDone') : t('column.setDone'), icon: 'doneMode', separator: true, onPress: () => void store.updateColumn(column.id, { isDoneColumn: !column.isDoneColumn }) },
    { label: t('common.duplicate'), icon: 'copy', onPress: () => { void store.duplicateColumn(column.id); toast(t('toast.duplicated')); } },
    { label: t('common.delete'), icon: 'trash', destructive: true, separator: true, onPress: () => void actions.deleteColumn(column) },
  ];

  /** タスクをタップしたときのメニュー */
  const taskMenu = (task: Task): MenuItem[] => [
    { label: t('task.edit'), icon: 'edit', onPress: () => setTaskDialog({ mode: 'edit', taskId: task.id }) },
    { label: task.isFavorite ? t('common.unfavorite') : t('common.favorite'), icon: task.isFavorite ? 'unpin' : 'pin', onPress: () => { void store.updateTask(task.id, { isFavorite: !task.isFavorite }); toast(t(task.isFavorite ? 'toast.unpinned' : 'toast.pinned')); } },
    { label: t('common.duplicate'), icon: 'copy', onPress: () => { void store.duplicateTask(task.id); toast(t('toast.duplicated')); } },
    { label: t('common.archive'), icon: 'archive', onPress: () => void actions.archiveTask(task) },
    { label: t('common.delete'), icon: 'trash', destructive: true, separator: true, onPress: () => void actions.deleteTask(task) },
  ];

  const editingTask = taskDialog?.mode === 'edit' ? tasks.find((x) => x.id === taskDialog.taskId) ?? null : null;

  const submitTask = async (v: TaskFormValues) => {
    const dialog = taskDialog;
    setTaskDialog(null);
    if (!dialog) return;
    const fields = { title: v.title, description: v.description, color: v.color, dueAt: v.dueAt, dueHasTime: false };
    if (dialog.mode === 'edit') {
      await store.updateTask(dialog.taskId, fields);
      const task = tasks.find((x) => x.id === dialog.taskId);
      const target = cols.find((c) => c.id === v.columnId);
      if (task && target && task.columnId !== target.id) await store.moveTask(task.id, target.id);
      toast(t('toast.taskUpdated'));
    } else {
      await store.createTask({ projectId: project.id, columnId: v.columnId, ...fields });
      toast(t('toast.taskCreated'));
    }
  };

  const header = (
    <BoardHeader
      title={project.title}
      search={searching ? { value: query, onChange: setQuery, onClose: closeSearch } : null}
      right={<DropdownMenu items={boardMenu} trigger={(open) => <IconButton icon="more" label={t('board.menu')} onPress={open} />} />}
    />
  );

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>
        <BoardView
          header={header}
          resetKey={id}
          ref={boardRef}
          columns={cols}
          tasksOf={(columnId) => tasksByColumn.get(columnId) ?? []}
          cursor={cursor}
          compactCards={density === 'compact'}
          menuItemsFor={columnMenu}
          taskMenuFor={taskMenu}
          onAdvance={(task) => void actions.advance(task)}
          onTaskDrop={(task, target) => void actions.moveTask(task, target)}
          onColumnDrop={(column, toIndex) => void store.moveColumn(column.id, toIndex)}
          onAddTask={(column) => openCreateTask(column.id)}
          onRefresh={syncEnabled ? async () => void (await syncNow()) : undefined}
        />

        {cursor?.grabbed ? (
          <View pointerEvents="none" style={[styles.banner, SHADOW.float, { backgroundColor: colors.primary }]}>
            <AppText bold color={colors.onPrimary}>
              {t('task.grabbed')}
            </AppText>
          </View>
        ) : null}

        {searching && query.trim() ? (
          <View style={[StyleSheet.absoluteFill, { top: pane ? BOARD.headerHeight : 0, backgroundColor: colors.surface }]}>
            <ScrollView keyboardShouldPersistTaps="handled" persistentScrollbar>
              <SearchResults
                results={results}
                projects={projects}
                columns={columns}
                onPress={(task) => {
                  closeSearch();
                  setTaskDialog({ mode: 'edit', taskId: task.id });
                }}
              />
            </ScrollView>
          </View>
        ) : null}
      </View>

      <TaskDialog
        visible={taskDialog !== null}
        task={editingTask}
        columns={cols.map((c) => ({ id: c.id, title: c.title }))}
        defaultColumnId={taskDialog?.mode === 'create' ? taskDialog.columnId : cols[0]?.id ?? ''}
        onClose={() => setTaskDialog(null)}
        onSubmit={submitTask}
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
          toast(t(target ? 'toast.columnUpdated' : 'toast.columnCreated'));
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
  banner: { position: 'absolute', top: SPACING.md, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
});
