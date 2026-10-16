import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { ArchiveDialog } from '@/components/board/ArchiveDialog';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView, type BoardViewHandle } from '@/components/board/BoardView';
import { ColumnDialog } from '@/components/board/NameDialogs';
import { RecordDetailsDialog } from '@/components/board/RecordDetailsDialog';
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
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { t } from '@/i18n';
import {
  clampCursor,
  initialCursor,
  moveCursor,
  type Cursor,
  type Direction,
} from '@/shortcuts/cursor';
import { useEscape, useShortcuts } from '@/shortcuts/useShortcuts';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { syncNow } from '@/sync/controller';
import { SHADOW, SPACING, useTheme } from '@/theme';

type TaskDialogState =
  { mode: 'create'; columnId: string } | { mode: 'edit'; taskId: string } | null;

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const boardRef = useRef<BoardViewHandle>(null);
  const { toast } = useFeedback();

  const ready = useDataStore((s) => s.ready);
  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const density = useSettingsStore((s) => s.settings.cardDensity);
  const showTaskDescription = useSettingsStore((s) => s.settings.showTaskDescription);
  const showTaskDueDate = useSettingsStore((s) => s.settings.showTaskDueDate);
  const showTaskUpdatedAt = useSettingsStore((s) => s.settings.showTaskUpdatedAt);
  const syncMode = useSettingsStore((s) => s.settings.syncMode);
  const identity = useAuthStore((s) => s.identity);
  const searchTick = useUiStore((s) => s.boardSearchFocusTick);
  const pendingTaskDetail = useUiStore((s) => s.pendingTaskDetail);

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
  const [taskDetails, setTaskDetails] = useState<Task | null>(null);
  const [archiveKind, setArchiveKind] = useState<'archive' | 'trash' | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [query, setQuery] = useState('');
  const searchResultsScrollRef = useWebWheelScroll({ touchScroll: true, touchAction: 'pan-y' });
  const [searching, setSearching] = useState(false);
  const follow = useRef<string | null>(null);

  useEffect(() => {
    if (project && isActive(project) && id)
      useSettingsStore.getState().update({ lastProjectId: id });
  }, [project, id]);

  // プロジェクトが切り替わったら、操作中の状態（カーソル・検索・ダイアログ）をリセットする
  /* eslint-disable react-hooks/set-state-in-effect -- 画面（BoardView）を作り直さずに中身だけ入れ替えるため、状態は手で戻す */
  useEffect(() => {
    setCursor(null);
    setQuery('');
    setSearching(false);
    setTaskDialog(null);
    setColumnDialog(null);
    setTaskDetails(null);
    setArchiveKind(null);
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // サイドバーの全体検索から別プロジェクトへ移動した場合、移動先で対象タスクの詳細を開く。
  /* eslint-disable react-hooks/set-state-in-effect -- 外部ストアの遷移要求を消費し、移動先データが準備できた時点でローカルダイアログを開く。 */
  useEffect(() => {
    if (!ready || !id || pendingTaskDetail?.projectId !== id) return;
    const taskId = useUiStore.getState().consumePendingTaskDetail(id);
    if (!taskId) return;
    const selected = tasks.find((task) => task.id === taskId && task.projectId === id);
    if (selected) {
      setQuery('');
      setSearching(false);
      setTaskDetails(selected);
    }
  }, [ready, id, pendingTaskDetail, tasks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 検索ショートカット（/）で検索を開く
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ショートカットの合図を受けて検索を開く
    if (searchTick > 0) setSearching(true);
  }, [searchTick]);

  // つかんで動かしたタスクにキーボードのカーソルを追従させる
  useEffect(() => {
    const taskId = follow.current;
    if (!taskId) return;
    follow.current = null;
    cols.forEach((c, columnIndex) => {
      const taskIndex = (tasksByColumn.get(c.id) ?? []).findIndex((x) => x.id === taskId);
      if (taskIndex >= 0)
        setCursor((prev) => ({ ...(prev ?? initialCursor()), columnIndex, taskIndex }));
    });
  }, [tasksByColumn, cols]);

  const results = useMemo(
    () =>
      id && searching && query.trim() ? searchTasks({ projects, columns, tasks }, query, id) : [],
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
    const validColumns = cols.filter((column) => column.projectId === project?.id);
    if (validColumns.length === 0) return;
    const preferred = columnId ? validColumns.find((column) => column.id === columnId) : undefined;
    const cursorCol = validColumns.find((column) => column.id === cursorColumn()?.id);
    const target = preferred ?? cursorCol ?? validColumns[0]!;
    setTaskDialog({ mode: 'create', columnId: target.id });
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
    {
      label: t('column.new'),
      icon: 'add',
      disabled: cols.length >= LIMITS.maxColumnsPerProject,
      onPress: () => setColumnDialog({ column: null }),
    },
    {
      label: t('board.search'),
      icon: 'search',
      onPress: () => useUiStore.getState().setGlobalSearchOpen(true, id ?? null),
    },
    {
      label: t('board.archiveDone'),
      icon: 'archive',
      separator: true,
      onPress: () => void actions.archiveDone(),
    },
    { label: t('board.openArchive'), icon: 'eye', onPress: () => setArchiveKind('archive') },
    {
      label: t('board.clearArchive'),
      icon: 'trash',
      destructive: true,
      onPress: () => void actions.clear('archive'),
    },
    {
      label: t('board.openTrash'),
      icon: 'eye',
      separator: true,
      onPress: () => setArchiveKind('trash'),
    },
    {
      label: t('board.clearTrash'),
      icon: 'trash',
      destructive: true,
      onPress: () => void actions.clear('trash'),
    },
  ];

  const sortLabel = (m: ColumnSortMode) => {
    const label =
      m === 'updated'
        ? t('column.sort.updated')
        : m === 'created'
          ? t('column.sort.created')
          : m === 'due'
            ? t('column.sort.due')
            : m === 'color'
              ? t('column.sort.color')
              : t('column.sort.manual');
    return `${t('column.sortMode')}: ${label}`;
  };
  const columnMenu = (column: KanbanColumn, index: number): MenuItem[] => [
    { label: t('column.rename'), icon: 'edit', onPress: () => setColumnDialog({ column }) },
    {
      label: t('column.moveLeft'),
      icon: 'left',
      disabled: index === 0,
      onPress: () => void store.moveColumn(column.id, index - 1),
    },
    {
      label: t('column.moveRight'),
      icon: 'right',
      disabled: index === cols.length - 1,
      onPress: () => void store.moveColumn(column.id, index + 1),
    },
    ...(['updated', 'created', 'due', 'color'] as ColumnSortMode[]).map((m, i) => ({
      label: sortLabel(m),
      icon: (column.sortMode === m ? 'check' : undefined) as MenuItem['icon'],
      separator: i === 0,
      onPress: () => void store.updateColumn(column.id, { sortMode: m }),
    })),
    {
      label: column.isDoneColumn ? t('column.unsetDone') : t('column.setDone'),
      icon: column.isDoneColumn ? 'doneModeOutline' : 'doneMode',
      separator: true,
      onPress: () => void store.updateColumn(column.id, { isDoneColumn: !column.isDoneColumn }),
    },
    {
      label: t('common.duplicate'),
      icon: 'copy',
      onPress: () => {
        void store.duplicateColumn(column.id);
        toast(t('toast.duplicated'));
      },
    },
    {
      label: t('common.delete'),
      icon: 'trash',
      destructive: true,
      separator: true,
      onPress: () => void actions.deleteColumn(column),
    },
  ];

  /** タスクをタップしたときのメニュー */
  const taskMenu = (task: Task): MenuItem[] => {
    const currentIndex = cols.findIndex((column) => column.id === task.columnId);
    const columnCount = cols.length;
    const taskColumn = cols[currentIndex];
    const columnTasks = tasksByColumn.get(task.columnId) ?? [];
    const taskIndex = columnTasks.findIndex((item) => item.id === task.id);
    const previousTask = taskIndex > 0 ? columnTasks[taskIndex - 1] : undefined;
    const nextTask =
      taskIndex >= 0 && taskIndex < columnTasks.length - 1 ? columnTasks[taskIndex + 1] : undefined;
    // ピン留めタスクは常に先頭グループなので、手動並び替えでもグループ境界を越えない。
    const canMoveTaskUp =
      taskColumn?.sortMode === 'manual' &&
      !!previousTask &&
      previousTask.isFavorite === task.isFavorite;
    const canMoveTaskDown =
      taskColumn?.sortMode === 'manual' && !!nextTask && nextTask.isFavorite === task.isFavorite;
    const leftColumn =
      columnCount > 0 ? cols[(currentIndex - 1 + columnCount) % columnCount] : undefined;
    const rightColumn = columnCount > 0 ? cols[(currentIndex + 1) % columnCount] : undefined;
    return [
      { label: t('task.detailsMenu'), icon: 'eye', onPress: () => setTaskDetails(task) },
      {
        label: t('task.edit'),
        icon: 'edit',
        onPress: () => setTaskDialog({ mode: 'edit', taskId: task.id }),
      },
      {
        label: task.isFavorite ? t('common.unfavorite') : t('common.favorite'),
        icon: task.isFavorite ? 'unpin' : 'pin',
        onPress: () => {
          void store.updateTask(task.id, { isFavorite: !task.isFavorite });
          toast(t(task.isFavorite ? 'toast.unpinned' : 'toast.pinned'));
        },
      },
      ...(taskColumn?.sortMode === 'manual'
        ? [
            {
              label: t('task.moveUpInColumn'),
              icon: 'up' as MenuItem['icon'],
              separator: true,
              disabled: !canMoveTaskUp,
              onPress: () => {
                if (canMoveTaskUp && taskIndex >= 0) {
                  void store.reorderTask(task.id, taskIndex - 1);
                }
              },
            },
            {
              label: t('task.moveDownInColumn'),
              icon: 'down' as MenuItem['icon'],
              disabled: !canMoveTaskDown,
              onPress: () => {
                if (canMoveTaskDown && taskIndex >= 0) {
                  void store.reorderTask(task.id, taskIndex + 1);
                }
              },
            },
          ]
        : []),
      {
        label: leftColumn
          ? currentIndex === 0
            ? t('task.moveToLast')
            : t('task.moveLeftTo')
          : t('task.moveLeft'),
        icon: 'left',
        separator: true,
        disabled: !leftColumn || columnCount < 2,
        onPress: () => {
          if (leftColumn) void actions.moveTask(task, leftColumn);
        },
      },
      {
        label: rightColumn
          ? currentIndex === columnCount - 1
            ? t('task.moveToFirst')
            : t('task.moveRightTo')
          : t('task.moveRight'),
        icon: 'right',
        disabled: !rightColumn || columnCount < 2,
        onPress: () => {
          if (rightColumn) void actions.moveTask(task, rightColumn);
        },
      },
      {
        label: t('common.duplicate'),
        icon: 'copy',
        separator: true,
        onPress: () => {
          void store.duplicateTask(task.id);
          toast(t('toast.duplicated'));
        },
      },
      {
        label: t('common.archive'),
        icon: 'archive',
        onPress: () => void actions.archiveTask(task),
      },
      {
        label: t('common.delete'),
        icon: 'trash',
        destructive: true,
        separator: true,
        onPress: () => void actions.deleteTask(task),
      },
    ];
  };

  const editingTask =
    taskDialog?.mode === 'edit' ? (tasks.find((x) => x.id === taskDialog.taskId) ?? null) : null;

  const submitTask = async (v: TaskFormValues) => {
    const dialog = taskDialog;
    setTaskDialog(null);
    if (!dialog) return;
    const fields = {
      title: v.title,
      description: v.description,
      color: v.color,
      dueAt: v.dueAt,
      dueHasTime: false,
    };
    if (dialog.mode === 'edit') {
      await store.updateTask(dialog.taskId, fields);
      const task = tasks.find((x) => x.id === dialog.taskId);
      const target = cols.find((c) => c.id === v.columnId);
      if (task && target && task.columnId !== target.id) await store.moveTask(task.id, target.id);
      toast(t('toast.taskUpdated'));
    } else {
      const targetColumn =
        cols.find((column) => column.id === v.columnId && column.projectId === project.id) ??
        cols.find((column) => column.projectId === project.id);
      if (!targetColumn) {
        toast(t('column.emptyHint'), undefined, { force: true });
        return;
      }
      await store.createTask({ projectId: project.id, columnId: targetColumn.id, ...fields });
      toast(t('toast.taskCreated'));
    }
  };

  const header = (active: boolean) => (
    <BoardHeader
      active={active}
      title={project.title}
      search={searching ? { value: query, onChange: setQuery, onClose: closeSearch } : null}
      right={
        <DropdownMenu
          items={boardMenu}
          trigger={(open) => <IconButton icon="more" label={t('board.menu')} onPress={open} />}
        />
      }
    />
  );

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>
        <BoardView
          key={id}
          header={header}
          resetKey={id}
          ref={boardRef}
          columns={cols}
          tasksOf={(columnId) => tasksByColumn.get(columnId) ?? []}
          cursor={cursor}
          compactCards={density === 'compact'}
          detailedCards={density === 'detailed'}
          showTaskDescription={showTaskDescription}
          showTaskDueDate={showTaskDueDate}
          showTaskUpdatedAt={showTaskUpdatedAt}
          menuItemsFor={columnMenu}
          taskMenuFor={taskMenu}
          onAdvance={(task) => void actions.advance(task)}
          onTaskDrop={(task, target, manualIndex) => {
            if (task.columnId === target.id && manualIndex !== undefined) {
              void store.reorderTask(task.id, manualIndex);
            } else {
              void actions.moveTask(task, target);
            }
          }}
          onColumnDrop={(column, toIndex) => void store.moveColumn(column.id, toIndex)}
          onAddTask={(column) => openCreateTask(column.id)}
          onCopyTitle={() => toast(t('task.copyTitle'))}
          onRefresh={syncEnabled ? async () => void (await syncNow()) : undefined}
        />

        {cursor?.grabbed ? (
          <View
            pointerEvents="none"
            style={[styles.banner, SHADOW.float, { backgroundColor: colors.primary }]}
          >
            <AppText bold color={colors.onPrimary}>
              {t('task.grabbed')}
            </AppText>
          </View>
        ) : null}

        {searching && query.trim() ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { top: BOARD.headerHeight, backgroundColor: colors.surface },
            ]}
          >
            <ScrollView
              ref={searchResultsScrollRef}
              style={[
                styles.searchResultsScroll,
                Platform.OS === 'web'
                  ? ({ overflowY: 'auto', overscrollBehaviorY: 'contain' } as never)
                  : undefined,
              ]}
              contentContainerStyle={styles.searchResultsContent}
              keyboardShouldPersistTaps="handled"
              persistentScrollbar
            >
              <SearchResults
                results={results}
                projects={projects}
                columns={columns}
                onPress={(task) => {
                  closeSearch();
                  setTaskDetails(task);
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
        defaultColumnId={taskDialog?.mode === 'create' ? taskDialog.columnId : (cols[0]?.id ?? '')}
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
      <RecordDetailsDialog
        record={taskDetails}
        onClose={() => setTaskDetails(null)}
        onEdit={(task) => {
          setTaskDetails(null);
          // Native Modal の閉じる処理を先に開始し、詳細ダイアログが消えてから編集を開く。
          setTimeout(() => setTaskDialog({ mode: 'edit', taskId: task.id }), 220);
        }}
        projectName={project.title}
        columnName={
          taskDetails ? cols.find((column) => column.id === taskDetails.columnId)?.title : undefined
        }
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
  searchResultsScroll: { flex: 1, minHeight: 0 },
  searchResultsContent: { flexGrow: 1 },
  banner: {
    position: 'absolute',
    top: SPACING.md,
    alignSelf: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
});
