import { Redirect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/auth/authStore';
import { ArchiveDialog } from '@/components/board/ArchiveDialog';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView, type BoardViewHandle } from '@/components/board/BoardView';
import { EmptyState } from '@/components/ui/EmptyState';
import { ColumnDialog } from '@/components/board/NameDialogs';
import { RecordDetailsDialog } from '@/components/board/RecordDetailsDialog';
import { CalendarDialog } from '@/components/ui/CalendarDialog';
import { TaskDialog, type TaskFormValues } from '@/components/board/TaskDialog';
import { AppText } from '@/components/ui/AppText';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { DropdownMenu, type MenuItem } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import { isSupabaseConfigured } from '@/config/env';
import { LIMITS } from '@/config/limits';
import { columnsOf, isActive, tasksOf } from '@/domain/selectors';
import type { ColumnSortBaseMode, KanbanColumn, Task } from '@/domain/types';
import { sortBaseMode, sortDirection, withSortDirection } from '@/domain/ordering';
import { UserActionError } from '@/domain/operationError';
import { useBoardActions } from '@/features/useBoardActions';
import { showUndoToast } from '@/features/undo';
import { useManualSync } from '@/hooks/useManualSync';
import { refreshProjectHiddenRecords } from '@/sync/controller';
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
import { SHADOW, SPACING, useTheme } from '@/theme';

type TaskDialogState =
  { mode: 'create'; columnId: string } | { mode: 'edit'; taskId: string } | null;
type TaskEditablePatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'color'
    | 'dueAt'
    | 'dueHasTime'
    | 'isFavorite'
    | 'sortKey'
    | 'completedAt'
  >
>;

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isFocused = useIsFocused();
  const { colors } = useTheme();
  const boardRef = useRef<BoardViewHandle>(null);
  const { toast, alert } = useFeedback();
  const syncManually = useManualSync();

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
  const pendingTaskDetail = useUiStore((s) => s.pendingTaskDetail);

  const project = projects.find((p) => p.id === id);
  const projectActive = project ? isActive(project) : false;
  const cols = useMemo(() => (id ? columnsOf(columns, id) : []), [columns, id]);
  // 通常のボード再計算では、ローカルに残っているアーカイブ／ごみ箱のタスクを先に除外する。
  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.deletedAt === null && task.archivedAt === null),
    [tasks],
  );
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const c of cols) map.set(c.id, tasksOf(visibleTasks, c.id, c.sortMode));
    return map;
  }, [cols, visibleTasks]);
  const counts = cols.map((c) => tasksByColumn.get(c.id)?.length ?? 0);

  const actions = useBoardActions(id ?? '');
  const showClipboardToast = (key: 'task.copyTitle' | 'task.copyDescription') => {
    if (!useSettingsStore.getState().settings.clipboardToastEnabled) return;
    toast(t(key), undefined, { category: 'editing', bypassCategoryFilter: true });
  };

  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [columnDialog, setColumnDialog] = useState<{ column: KanbanColumn | null } | null>(null);
  const [taskDetails, setTaskDetails] = useState<Task | null>(null);
  const [taskDetailsVisible, setTaskDetailsVisible] = useState(false);
  const [archiveKind, setArchiveKind] = useState<'archive' | 'trash' | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveLoadError, setArchiveLoadError] = useState<string | null>(null);
  const archiveRequestId = useRef(0);
  const [dueDialogTaskId, setDueDialogTaskId] = useState<string | null>(null);
  const pendingArchiveClearRef = useRef<(() => void) | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const follow = useRef<string | null>(null);

  const openArchiveDialog = (kind: 'archive' | 'trash') => {
    const requestId = ++archiveRequestId.current;
    setArchiveKind(kind);
    setArchiveLoadError(null);
    const currentIdentity = useAuthStore.getState().identity;
    const currentSyncMode = useSettingsStore.getState().settings.syncMode;
    if (
      !currentIdentity ||
      currentIdentity.local ||
      !isSupabaseConfigured ||
      currentSyncMode !== 'auto'
    ) {
      setArchiveLoading(false);
      return;
    }

    setArchiveLoading(true);
    void refreshProjectHiddenRecords(id ?? '', kind)
      .catch(() => {
        if (archiveRequestId.current === requestId) {
          setArchiveLoadError(t('board.hiddenRefreshFailed'));
        }
      })
      .finally(() => {
        if (archiveRequestId.current === requestId) setArchiveLoading(false);
      });
  };

  const duplicateFailed = (error: unknown) =>
    alert(
      t('common.error'),
      error instanceof UserActionError ? error.message : t('operation.duplicateFailed'),
    );

  const duplicateTaskById = async (taskId: string) => {
    try {
      const copied = await useDataStore.getState().duplicateTask(taskId);
      if (copied) {
        showUndoToast(
          toast,
          t('toast.duplicated'),
          () => useDataStore.getState().deleteTask(copied.id),
          'editing',
        );
      }
    } catch (error) {
      duplicateFailed(error);
    }
  };

  const duplicateColumnById = async (columnId: string) => {
    try {
      const copied = await useDataStore.getState().duplicateColumn(columnId);
      if (copied) {
        showUndoToast(
          toast,
          t('toast.duplicated'),
          () => useDataStore.getState().deleteColumn(copied.id),
          'editing',
        );
      }
    } catch (error) {
      duplicateFailed(error);
    }
  };

  const updateTaskWithUndo = async (
    taskId: string,
    patch: TaskEditablePatch,
    message = t('toast.taskUpdated'),
    category: 'movement' | 'editing' = 'editing',
  ) => {
    const state = useDataStore.getState();
    const before = state.tasks.find((task) => task.id === taskId);
    if (!before) return;
    const previous: TaskEditablePatch = {};
    if ('title' in patch) previous.title = before.title;
    if ('description' in patch) previous.description = before.description;
    if ('color' in patch) previous.color = before.color;
    if ('dueAt' in patch) previous.dueAt = before.dueAt;
    if ('dueHasTime' in patch) previous.dueHasTime = before.dueHasTime;
    if ('isFavorite' in patch) previous.isFavorite = before.isFavorite;

    await state.updateTask(taskId, patch);
    setTaskDetails((current) => (current?.id === taskId ? { ...current, ...patch } : current));
    showUndoToast(
      toast,
      message,
      async () => {
        await useDataStore.getState().updateTask(taskId, previous);
        setTaskDetails((current) =>
          current?.id === taskId ? { ...current, ...previous } : current,
        );
      },
      category,
    );
  };

  useEffect(() => {
    if (project && isActive(project) && id)
      useSettingsStore.getState().update({ lastProjectId: id });
  }, [project, id]);

  // プロジェクトが切り替わったら、操作中の状態（カーソル・ダイアログ）をリセットする
  /* eslint-disable react-hooks/set-state-in-effect -- 画面（BoardView）を作り直さずに中身だけ入れ替えるため、状態は手で戻す */
  useEffect(() => {
    setCursor(null);
    setTaskDialog(null);
    setColumnDialog(null);
    setTaskDetails(null);
    setTaskDetailsVisible(false);
    archiveRequestId.current += 1;
    setArchiveKind(null);
    setArchiveLoading(false);
    setArchiveLoadError(null);
    setDueDialogTaskId(null);
  }, [id, projectActive]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // サイドバーの全体検索から別プロジェクトへ移動した場合、移動先で対象タスクの詳細を開く。
  /* eslint-disable react-hooks/set-state-in-effect -- 外部ストアの遷移要求を消費し、移動先データが準備できた時点でローカルダイアログを開く。 */
  useEffect(() => {
    if (!ready || !id || pendingTaskDetail?.projectId !== id) return;
    const taskId = useUiStore.getState().consumePendingTaskDetail(id);
    if (!taskId) return;
    const selected = tasks.find((task) => task.id === taskId && task.projectId === id);
    if (selected) {
      setTaskDetails(selected);
      setTaskDetailsVisible(true);
    }
  }, [ready, id, pendingTaskDetail, tasks]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const syncEnabled = !!identity && !identity.local && isSupabaseConfigured && syncMode !== 'off';

  // ---- キーボード操作 ----
  const current = (): Cursor => clampCursor(cursor ?? initialCursor(), counts);
  const cursorColumn = (): KanbanColumn | undefined =>
    cursor ? cols[current().columnIndex] : undefined;
  const cursorTask = (): Task | undefined => {
    if (!cursor) return undefined;
    const c = current();
    const col = cols[c.columnIndex];
    return col && c.taskIndex >= 0 ? tasksByColumn.get(col.id)?.[c.taskIndex] : undefined;
  };
  const update = (fn: (c: Cursor) => Cursor) => setCursor(clampCursor(fn(current()), counts));

  const reorderTaskWithUndo = async (taskId: string, toIndex: number) => {
    const state = useDataStore.getState();
    const task = state.tasks.find((item) => item.id === taskId);
    const column = task && state.columns.find((item) => item.id === task.columnId);
    if (!task || !column || column.sortMode !== 'manual') return;
    const beforeIndex = tasksOf(state.tasks, column.id, column.sortMode).findIndex(
      (item) => item.id === taskId,
    );
    if (beforeIndex < 0 || beforeIndex === toIndex) return;
    const beforeSortKey = task.sortKey;
    await state.reorderTask(taskId, toIndex);
    showUndoToast(
      toast,
      t('board.taskReordered'),
      () => useDataStore.getState().updateTask(taskId, { sortKey: beforeSortKey }),
      'movement',
    );
  };

  const moveColumnWithUndo = async (columnId: string, toIndex: number) => {
    const state = useDataStore.getState();
    const column = state.columns.find((item) => item.id === columnId);
    if (!column) return;
    const beforeColumns = columnsOf(state.columns, column.projectId);
    const beforeIndex = beforeColumns.findIndex((item) => item.id === columnId);
    if (beforeIndex < 0 || beforeIndex === toIndex || beforeColumns.length < 2) return;
    await state.moveColumn(columnId, toIndex);
    showUndoToast(
      toast,
      t('board.columnMoved'),
      async () => {
        const currentState = useDataStore.getState();
        const currentColumns = columnsOf(currentState.columns, column.projectId);
        if (currentColumns.some((item) => item.id === columnId)) {
          await currentState.moveColumn(columnId, beforeIndex);
        }
      },
      'movement',
    );
  };

  const updateColumnWithUndo = async (
    columnId: string,
    patch: Partial<Pick<KanbanColumn, 'title' | 'color' | 'sortMode' | 'isDoneColumn'>>,
    message = t('toast.columnUpdated'),
  ) => {
    const state = useDataStore.getState();
    const before = state.columns.find((item) => item.id === columnId);
    if (!before) return;
    const previous: Partial<Pick<KanbanColumn, 'title' | 'color' | 'sortMode' | 'isDoneColumn'>> =
      {};
    if ('title' in patch) previous.title = before.title;
    if ('color' in patch) previous.color = before.color;
    if ('sortMode' in patch) previous.sortMode = before.sortMode;
    if ('isDoneColumn' in patch) previous.isDoneColumn = before.isDoneColumn;
    const taskStateById = new Map<
      string,
      { id: string; sortKey?: string; completedAt?: number | null }
    >();
    if ('sortMode' in patch && patch.sortMode !== before.sortMode) {
      for (const task of tasksOf(state.tasks, columnId, before.sortMode)) {
        taskStateById.set(task.id, { id: task.id, sortKey: task.sortKey });
      }
    }
    if ('isDoneColumn' in patch && patch.isDoneColumn !== before.isDoneColumn) {
      for (const task of state.tasks.filter(
        (item) => item.columnId === columnId && item.deletedAt === null,
      )) {
        const saved = taskStateById.get(task.id) ?? { id: task.id };
        saved.completedAt = task.completedAt;
        taskStateById.set(task.id, saved);
      }
    }
    const taskUndoState = [...taskStateById.values()];
    const changed = Object.keys(previous).some((key) => {
      const field = key as keyof typeof previous;
      return !Object.is(before[field], patch[field]);
    });
    if (!changed) return;
    await state.updateColumn(columnId, patch);
    showUndoToast(
      toast,
      message,
      () =>
        taskUndoState.length > 0
          ? useDataStore.getState().restoreColumnEdit(columnId, previous, taskUndoState)
          : useDataStore.getState().updateColumn(columnId, previous),
      'editing',
    );
  };

  const copySelectedTaskField = async (field: 'title' | 'description') => {
    const task = cursorTask();
    if (!task) return;
    try {
      await Clipboard.setStringAsync(field === 'title' ? task.title : task.description);
      showClipboardToast(field === 'title' ? 'task.copyTitle' : 'task.copyDescription');
    } catch {
      // クリップボードが利用できない環境では、選択状態やタスク操作に影響させない。
    }
  };

  const navigate = async (dir: Direction) => {
    if (!cursor) {
      const firstColumnIndex = counts.findIndex((count) => count > 0);
      if (firstColumnIndex >= 0) {
        setCursor({ columnIndex: firstColumnIndex, taskIndex: 0, grabbed: false });
      }
      return;
    }
    const c = current();
    if (!c.grabbed) return update((x) => moveCursor(x, dir, counts));
    const col = cols[c.columnIndex];
    if (!col) return;
    const horizontal = dir === 'left' || dir === 'right';
    const step = dir === 'left' || dir === 'up' ? -1 : 1;
    const task = cursorTask();
    if (!task) return;
    if (horizontal) {
      const target = cols[c.columnIndex + step];
      if (target) {
        follow.current = task.id;
        await actions.moveTask(task, target);
      }
    } else if (col.sortMode === 'manual') {
      await reorderTaskWithUndo(task.id, c.taskIndex + step);
      update((x) => ({ ...x, taskIndex: x.taskIndex + step }));
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
    if (!cursor) return;
    const c = current();
    const col = cols[c.columnIndex];
    if (!col || cols.length <= 1) return;
    const nextIndex = (c.columnIndex + step + cols.length) % cols.length;
    void moveColumnWithUndo(col.id, nextIndex);
    update((x) => ({ ...x, columnIndex: nextIndex }));
  }

  useShortcuts(
    {
      cursorLeft: () => void navigate('left'),
      cursorRight: () => void navigate('right'),
      cursorUp: () => void navigate('up'),
      cursorDown: () => void navigate('down'),
      copyTitle: () => void copySelectedTaskField('title'),
      copyDescription: () => void copySelectedTaskField('description'),
      advanceTask: () => {
        const task = cursorTask();
        if (task && cols.length > 1) {
          follow.current = task.id;
          void actions.advance(task);
        }
      },
      retreatTask: () => {
        const task = cursorTask();
        if (task && cols.length > 1) {
          follow.current = task.id;
          void actions.retreat(task);
        }
      },
      grab: () => {
        if (cursorTask()) update((c) => ({ ...c, grabbed: !c.grabbed }));
      },
      edit: () => {
        const task = cursorTask();
        if (task) setTaskDialog({ mode: 'edit', taskId: task.id });
      },
      delete: () => {
        const task = cursorTask();
        if (task) void actions.deleteTask(task);
      },
      newTask: () => openCreateTask(),
      newColumn: () => setColumnDialog({ column: null }),
      toggleFavorite: () => {
        const task = cursorTask();
        if (task) {
          const isFavorite = !task.isFavorite;
          void updateTaskWithUndo(
            task.id,
            { isFavorite },
            t(isFavorite ? 'toast.pinned' : 'toast.unpinned'),
          );
        }
      },
      changeDueDate: () => {
        const task = cursorTask();
        if (task) setDueDialogTaskId(task.id);
      },
      archiveTask: () => {
        const task = cursorTask();
        if (task) void actions.archiveTask(task);
      },
      archiveDone: () => void actions.archiveDone(),
      duplicate: () => {
        const task = cursorTask();
        if (task) void duplicateTaskById(task.id);
      },
      moveColumnLeft: () => moveColumnBy(-1),
      moveColumnRight: () => moveColumnBy(1),
    },
    isFocused && projectActive,
  );

  useEscape(() => {
    if (cursor?.grabbed) update((c) => ({ ...c, grabbed: false }));
    else if (cursor) setCursor(null);
  }, isFocused && projectActive);

  if (!ready) return null;
  if (!project) return <Redirect href="/home" />;
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
    { label: t('board.openArchive'), icon: 'eye', onPress: () => openArchiveDialog('archive') },
    {
      label: t('board.clearArchive'),
      icon: 'delete',
      destructive: true,
      onPress: () => void actions.clear('archive'),
    },
    {
      label: t('board.openTrash'),
      icon: 'eye',
      separator: true,
      onPress: () => openArchiveDialog('trash'),
    },
    {
      label: t('board.clearTrash'),
      icon: 'deleteForever',
      destructive: true,
      onPress: () => void actions.clear('trash'),
    },
  ];

  const sortLabel = (m: ColumnSortBaseMode) => {
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
      label: index === 0 ? t('column.moveToLast') : t('column.moveLeft'),
      icon: 'left',
      disabled: cols.length <= 1,
      onPress: () => void moveColumnWithUndo(column.id, index === 0 ? cols.length - 1 : index - 1),
    },
    {
      label: index === cols.length - 1 ? t('column.moveToFirst') : t('column.moveRight'),
      icon: 'right',
      disabled: cols.length <= 1,
      onPress: () => void moveColumnWithUndo(column.id, index === cols.length - 1 ? 0 : index + 1),
    },
    ...(['updated', 'created', 'due', 'color'] as const).map((m, i) => {
      const selected = sortBaseMode(column.sortMode) === m;
      const direction = selected ? sortDirection(column.sortMode) : sortDirection(m);
      const nextDirection = direction === 'asc' ? 'desc' : 'asc';
      return {
        label: sortLabel(m),
        icon: (selected ? 'check' : undefined) as MenuItem['icon'],
        inlineIcon: direction === 'asc' ? ('sortAsc' as const) : ('sortDesc' as const),
        separator: i === 0,
        onPress: () =>
          void updateColumnWithUndo(column.id, {
            sortMode: selected ? withSortDirection(m, nextDirection) : m,
          }),
      };
    }),
    {
      label: column.isDoneColumn ? t('column.unsetDone') : t('column.setDone'),
      icon: column.isDoneColumn ? 'doneModeOutline' : 'doneMode',
      separator: true,
      onPress: () => void updateColumnWithUndo(column.id, { isDoneColumn: !column.isDoneColumn }),
    },
    {
      label: t('common.duplicate'),
      icon: 'copy',
      onPress: () => void duplicateColumnById(column.id),
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
      {
        label: t('task.detailsMenu'),
        icon: 'eye',
        onPress: () => {
          setTaskDetails(task);
          setTaskDetailsVisible(true);
        },
      },
      {
        label: t('task.edit'),
        icon: 'edit',
        onPress: () => setTaskDialog({ mode: 'edit', taskId: task.id }),
      },
      {
        label: task.isFavorite ? t('common.unfavorite') : t('common.favorite'),
        icon: task.isFavorite ? 'unpin' : 'pin',
        onPress: () => {
          const isFavorite = !task.isFavorite;
          void updateTaskWithUndo(
            task.id,
            { isFavorite },
            t(isFavorite ? 'toast.pinned' : 'toast.unpinned'),
          );
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
                  void reorderTaskWithUndo(task.id, taskIndex - 1);
                }
              },
            },
            {
              label: t('task.moveDownInColumn'),
              icon: 'down' as MenuItem['icon'],
              disabled: !canMoveTaskDown,
              onPress: () => {
                if (canMoveTaskDown && taskIndex >= 0) {
                  void reorderTaskWithUndo(task.id, taskIndex + 1);
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
        onPress: () => void duplicateTaskById(task.id),
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
  const currentTaskDetails = taskDetails
    ? (tasks.find((task) => task.id === taskDetails.id) ?? taskDetails)
    : null;

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
      const state = useDataStore.getState();
      const before = state.tasks.find((item) => item.id === dialog.taskId);
      const target = cols.find((column) => column.id === v.columnId);
      if (!before) return;
      const moved = !!target && before.columnId !== target.id;
      await state.updateTask(dialog.taskId, fields);
      if (moved && target) await useDataStore.getState().moveTask(before.id, target.id);
      const previousFields: TaskEditablePatch = {
        title: before.title,
        description: before.description,
        color: before.color,
        dueAt: before.dueAt,
        dueHasTime: before.dueHasTime,
        sortKey: before.sortKey,
        completedAt: before.completedAt,
      };
      showUndoToast(
        toast,
        t('toast.taskUpdated'),
        async () => {
          const current = useDataStore.getState().tasks.find((item) => item.id === before.id);
          if (!current) return;
          if (current.columnId !== before.columnId) {
            await useDataStore.getState().moveTask(before.id, before.columnId);
          }
          await useDataStore.getState().updateTask(before.id, previousFields);
          setTaskDetails((currentTask) =>
            currentTask?.id === before.id
              ? { ...currentTask, ...previousFields, columnId: before.columnId }
              : currentTask,
          );
        },
        moved ? 'movement' : 'editing',
      );
    } else {
      const targetColumn =
        cols.find((column) => column.id === v.columnId && column.projectId === project.id) ??
        cols.find((column) => column.projectId === project.id);
      if (!targetColumn) {
        toast(t('column.emptyHint'), undefined, { category: 'system' });
        return;
      }
      const created = await useDataStore
        .getState()
        .createTask({ projectId: project.id, columnId: targetColumn.id, ...fields });
      if (created) {
        showUndoToast(
          toast,
          t('toast.taskCreated'),
          () => useDataStore.getState().deleteTask(created.id),
          'editing',
        );
      }
    }
  };

  const header = () =>
    projectActive ? (
      <BoardHeader
        title={project.title}
        right={
          <DropdownMenu
            items={boardMenu}
            trigger={(open) => <IconButton icon="more" label={t('board.menu')} onPress={open} />}
          />
        }
      />
    ) : (
      <BoardHeader menuOnly />
    );

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>
        <BoardView
          header={header}
          emptyContent={
            !projectActive ? (
              <EmptyState title={t('project.empty')} hint={t('project.emptyHint')} />
            ) : undefined
          }
          resetKey={id}
          ref={boardRef}
          columns={projectActive ? cols : []}
          showEmptyState={projectActive}
          tasksOf={(columnId) => tasksByColumn.get(columnId) ?? []}
          cursor={projectActive && counts.some((count) => count > 0) && cursor ? current() : null}
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
              void reorderTaskWithUndo(task.id, manualIndex);
            } else {
              void actions.moveTask(task, target);
            }
          }}
          onColumnDrop={(column, toIndex) => void moveColumnWithUndo(column.id, toIndex)}
          onAddTask={(column) => openCreateTask(column.id)}
          onCopyTitle={() => showClipboardToast('task.copyTitle')}
          onCopyDescription={() => showClipboardToast('task.copyDescription')}
          onRefresh={syncEnabled && syncMode === 'auto' ? syncManually : undefined}
        />

        {projectActive && cursor?.grabbed ? (
          <View
            pointerEvents="none"
            style={[styles.banner, SHADOW.float, { backgroundColor: colors.primary }]}
          >
            <AppText bold color={colors.onPrimary}>
              {t('task.grabbed')}
            </AppText>
          </View>
        ) : null}
      </View>

      <ColumnDialog
        visible={projectActive && columnDialog !== null}
        column={columnDialog?.column ?? null}
        onClose={() => setColumnDialog(null)}
        onSubmit={async (v) => {
          const target = columnDialog?.column;
          setColumnDialog(null);
          if (target) {
            const before = useDataStore
              .getState()
              .columns.find((column) => column.id === target.id);
            if (!before) return;
            await updateColumnWithUndo(target.id, v);
          } else {
            const created = await useDataStore
              .getState()
              .createColumn({ projectId: project.id, ...v });
            if (created) {
              showUndoToast(
                toast,
                t('toast.columnCreated'),
                () => useDataStore.getState().deleteColumn(created.id),
                'editing',
              );
            }
          }
        }}
      />
      <RecordDetailsDialog
        record={currentTaskDetails}
        visible={projectActive && taskDetailsVisible}
        onClose={() => setTaskDetailsVisible(false)}
        onDismiss={() => {
          setTaskDetails(null);
        }}
        onCopyTitle={() => showClipboardToast('task.copyTitle')}
        onCopyDescription={() => showClipboardToast('task.copyDescription')}
        onToggleFavorite={(task) => {
          const isFavorite = !task.isFavorite;
          void updateTaskWithUndo(
            task.id,
            { isFavorite },
            t(isFavorite ? 'toast.pinned' : 'toast.unpinned'),
          );
        }}
        onSetDue={(task, dueAt) => {
          void updateTaskWithUndo(task.id, { dueAt, dueHasTime: false }, t('toast.taskDueUpdated'));
        }}
        onEdit={(task) => {
          // 詳細を背面に残し、編集ダイアログを重ねて表示する。
          setTaskDialog({ mode: 'edit', taskId: task.id });
        }}
        projectName={project.title}
        columnName={
          currentTaskDetails
            ? cols.find((column) => column.id === currentTaskDetails.columnId)?.title
            : undefined
        }
      />
      <CalendarDialog
        visible={projectActive && dueDialogTaskId !== null}
        value={tasks.find((task) => task.id === dueDialogTaskId)?.dueAt ?? null}
        onClose={() => setDueDialogTaskId(null)}
        onSelect={(dueAt) => {
          if (dueDialogTaskId) {
            void updateTaskWithUndo(
              dueDialogTaskId,
              { dueAt, dueHasTime: false },
              t('toast.taskDueUpdated'),
            );
          }
          setDueDialogTaskId(null);
        }}
      />
      <TaskDialog
        visible={projectActive && taskDialog !== null}
        task={editingTask}
        columns={cols.map((c) => ({ id: c.id, title: c.title }))}
        defaultColumnId={taskDialog?.mode === 'create' ? taskDialog.columnId : (cols[0]?.id ?? '')}
        onClose={() => setTaskDialog(null)}
        onSubmit={submitTask}
      />
      <ArchiveDialog
        kind={projectActive ? archiveKind : null}
        refreshing={archiveLoading}
        refreshError={archiveLoadError}
        projectId={project.id}
        onClose={() => setArchiveKind(null)}
        onClear={() => {
          const kind = archiveKind;
          if (!kind) return;
          // 一覧の Modal が閉じてから確認 Modal を開き、二つの native Modal の
          // 表示・終了アニメーションが同時に走らないようにする。
          pendingArchiveClearRef.current = () => void actions.clear(kind);
          setArchiveKind(null);
        }}
        onDismiss={() => {
          const continueClear = pendingArchiveClearRef.current;
          pendingArchiveClearRef.current = null;
          continueClear?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: {
    position: 'absolute',
    top: SPACING.md,
    alignSelf: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
});
