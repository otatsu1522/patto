import { Redirect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/auth/authStore';
import { ArchiveDialog } from '@/components/board/ArchiveDialog';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView, type BoardViewHandle } from '@/components/board/BoardView';
import { ProjectSelectionEmptyState } from '@/components/shell/ProjectSelectionEmptyState';
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
import type { KanbanColumn, Task } from '@/domain/types';
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
  const projectActive = project ? isActive(project) && project.archivedAt === null : false;
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

  // Keyboard/drag callbacks intentionally fire without awaiting from React Native event handlers.
  // Route every asynchronous mutation through one rejection handler so database errors are visible.
  const runBoardAction = (operation: () => Promise<unknown>) => {
    void Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        alert(
          t('common.error'),
          error instanceof UserActionError ? error.message : t('operation.saveFailed'),
        );
      });
  };

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
    // 最後に開いたプロジェクトには、通常画面で利用可能なプロジェクトだけを記録する。
    if (projectActive && id) void useSettingsStore.getState().update({ lastProjectId: id });
  }, [projectActive, id]);

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
      } else if (cols.length > 0) {
        // タスクがないボードでも、カンバン見出しを選択して操作できる。
        setCursor({ columnIndex: 0, taskIndex: -1, grabbed: false });
      }
      return;
    }
    const c = current();
    const col = cols[c.columnIndex];
    if (!col) return;

    // カンバン見出しを選択しているときは、h/l で見出し間を移動する。
    // g でつかんでいる間は、h/l でカンバン自体を移動する。
    if (c.taskIndex < 0) {
      if (c.grabbed) {
        if (dir !== 'left' && dir !== 'right') return;
        const nextIndex = c.columnIndex + (dir === 'left' ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= cols.length) return;
        await moveColumnWithUndo(col.id, nextIndex);
        update((x) => ({ ...x, columnIndex: nextIndex, taskIndex: -1, grabbed: true }));
        return;
      }
      update((x) => moveCursor(x, dir, counts));
      return;
    }

    if (!c.grabbed) return update((x) => moveCursor(x, dir, counts));
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
      update((x) => ({ ...x, taskIndex: c.taskIndex + step }));
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

  function moveSelectionBy(step: -1 | 1) {
    if (!cursor) return;
    const c = current();
    const col = cols[c.columnIndex];
    if (!col || cols.length <= 1) return;

    if (c.taskIndex >= 0) {
      const task = cursorTask();
      if (!task) return;
      // Shift+H/L は g でつかまずに、選択中のタスクを隣のカンバンへ直接移動する。
      // 端では反対側へ循環し、移動後も同じタスクを選択状態に保つ。
      follow.current = task.id;
      update((x) => ({ ...x, grabbed: false }));
      runBoardAction(() => (step < 0 ? actions.retreat(task) : actions.advance(task)));
      return;
    }

    // タスクではなくカンバン見出しを選択している場合は、カンバン自体を並べ替える。
    const nextIndex = (c.columnIndex + step + cols.length) % cols.length;
    runBoardAction(() => moveColumnWithUndo(col.id, nextIndex));
    update((x) => ({ ...x, columnIndex: nextIndex, grabbed: false }));
  }

  useShortcuts(
    {
      cursorLeft: () => runBoardAction(() => navigate('left')),
      cursorRight: () => runBoardAction(() => navigate('right')),
      cursorUp: () => runBoardAction(() => navigate('up')),
      cursorDown: () => runBoardAction(() => navigate('down')),
      copyTitle: () => void copySelectedTaskField('title'),
      copyDescription: () => void copySelectedTaskField('description'),
      grab: () => {
        const selected = current();
        // taskIndex=-1 はカンバン見出しの選択状態。タスクが空でも g でつかめる。
        if (cols[selected.columnIndex] && (selected.taskIndex < 0 || cursorTask())) {
          update((c) => ({ ...c, grabbed: !c.grabbed }));
        }
      },
      grabColumn: () => {
        const selected = current();
        // タスク選択中でも、現在位置のカンバン見出しへ切り替えてつかめる。
        if (cols[selected.columnIndex]) {
          update((c) => ({ ...c, taskIndex: -1, grabbed: true }));
        }
      },
      edit: () => {
        const task = cursorTask();
        if (task) setTaskDialog({ mode: 'edit', taskId: task.id });
      },
      delete: () => {
        const task = cursorTask();
        if (task) runBoardAction(() => actions.deleteTask(task));
      },
      newTask: () => openCreateTask(),
      newColumn: () => setColumnDialog({ column: null }),
      toggleFavorite: () => {
        const task = cursorTask();
        if (task) {
          const isFavorite = !task.isFavorite;
          runBoardAction(() =>
            updateTaskWithUndo(
              task.id,
              { isFavorite },
              t(isFavorite ? 'toast.pinned' : 'toast.unpinned'),
            ),
          );
        }
      },
      changeDueDate: () => {
        const task = cursorTask();
        if (task) setDueDialogTaskId(task.id);
      },
      archiveTask: () => {
        const task = cursorTask();
        if (task) runBoardAction(() => actions.archiveTask(task));
      },
      archiveDone: () => runBoardAction(() => actions.archiveDone()),
      duplicate: () => {
        const task = cursorTask();
        if (task) void duplicateTaskById(task.id);
      },
      moveColumnLeft: () => moveSelectionBy(-1),
      moveColumnRight: () => moveSelectionBy(1),
    },
    isFocused && projectActive,
  );

  useEscape(() => {
    if (cursor?.grabbed) update((c) => ({ ...c, grabbed: false }));
    else if (cursor) setCursor(null);
  }, isFocused && projectActive);

  if (!ready) return null;
  if (!project) return <Redirect href={{ pathname: '/home', params: { selection: 'empty' } }} />;
  // アーカイブ済みプロジェクトは通常画面として開かない。ホームの選択画面へ戻す。
  if (project.deletedAt === null && project.archivedAt !== null) {
    return <Redirect href={{ pathname: '/home', params: { selection: 'empty' } }} />;
  }
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
      onPress: () => actions.archiveDone(),
    },
    { label: t('board.openArchive'), icon: 'eye', onPress: () => openArchiveDialog('archive') },
    {
      label: t('board.clearArchive'),
      icon: 'delete',
      destructive: true,
      onPress: () => actions.clear('archive'),
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
      onPress: () => actions.clear('trash'),
    },
  ];

  // アコーディオンに表示する自動並び替え項目は、手動を除いた4種類。
  // 閉じた状態でも現在の並び順と方向が分かるよう、親行に選択状態を表示する。
  const sortMenuModes = ['updated', 'created', 'due', 'color'] as const;
  const sortLabel = (m: (typeof sortMenuModes)[number]) => {
    switch (m) {
      case 'updated':
        return t('column.sort.updated');
      case 'created':
        return t('column.sort.created');
      case 'due':
        return t('column.sort.due');
      case 'color':
        return t('column.sort.color');
    }
  };
  const columnMenu = (column: KanbanColumn, index: number): MenuItem[] => {
    const currentSort = sortBaseMode(column.sortMode);
    const currentSortLabel =
      currentSort === 'manual' ? t('column.sort.manual') : sortLabel(currentSort);
    const directionLabel =
      sortDirection(column.sortMode) === 'asc'
        ? t('column.sort.ascending')
        : t('column.sort.descending');
    const currentDirectionLabel = currentSort === 'manual' ? '' : ` (${directionLabel})`;

    return [
      { label: t('column.rename'), icon: 'edit', onPress: () => setColumnDialog({ column }) },
      {
        label: `${t('column.sortMode')}：${currentSortLabel}${currentDirectionLabel}`,
        icon: 'sort',
        accordionItems: sortMenuModes.map((m) => {
          const selected = currentSort === m;
          const direction = selected ? sortDirection(column.sortMode) : sortDirection(m);
          const nextDirection = direction === 'asc' ? 'desc' : 'asc';
          return {
            label: sortLabel(m),
            icon: (selected ? 'check' : undefined) as MenuItem['icon'],
            inlineIcon: direction === 'asc' ? ('sortAsc' as const) : ('sortDesc' as const),
            onPress: () =>
              updateColumnWithUndo(column.id, {
                sortMode: selected ? withSortDirection(m, nextDirection) : m,
              }),
          };
        }),
        // アコーディオン項目の選択後に、変更済みの並び順・方向とチェックを再読み込みする。
        refreshMenuItems: () => {
          const currentColumns = columnsOf(useDataStore.getState().columns, column.projectId);
          const currentColumn = currentColumns.find((item) => item.id === column.id);
          return currentColumn
            ? columnMenu(
                currentColumn,
                currentColumns.findIndex((item) => item.id === column.id),
              )
            : [];
        },
        onPress: () => undefined,
      },
      {
        label: index === 0 ? t('column.moveToLast') : t('column.moveLeft'),
        icon: 'left',
        disabled: cols.length <= 1,
        separator: true,
        onPress: () => moveColumnWithUndo(column.id, index === 0 ? cols.length - 1 : index - 1),
      },
      {
        label: index === cols.length - 1 ? t('column.moveToFirst') : t('column.moveRight'),
        icon: 'right',
        disabled: cols.length <= 1,
        onPress: () => moveColumnWithUndo(column.id, index === cols.length - 1 ? 0 : index + 1),
      },
      {
        label: column.isDoneColumn ? t('column.unsetDone') : t('column.setDone'),
        icon: column.isDoneColumn ? 'doneModeOutline' : 'doneMode',
        separator: true,
        onPress: () => updateColumnWithUndo(column.id, { isDoneColumn: !column.isDoneColumn }),
      },
      {
        label: t('common.duplicate'),
        icon: 'copy',
        onPress: () => duplicateColumnById(column.id),
      },
      {
        label: t('common.delete'),
        icon: 'trash',
        destructive: true,
        separator: true,
        onPress: () => actions.deleteColumn(column),
      },
    ];
  };

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
        onPress: async () => {
          const isFavorite = !task.isFavorite;
          await updateTaskWithUndo(
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
              onPress: async () => {
                if (canMoveTaskUp && taskIndex >= 0) {
                  await reorderTaskWithUndo(task.id, taskIndex - 1);
                }
              },
            },
            {
              label: t('task.moveDownInColumn'),
              icon: 'down' as MenuItem['icon'],
              disabled: !canMoveTaskDown,
              onPress: async () => {
                if (canMoveTaskDown && taskIndex >= 0) {
                  await reorderTaskWithUndo(task.id, taskIndex + 1);
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
        onPress: async () => {
          if (leftColumn) await actions.moveTask(task, leftColumn);
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
        onPress: async () => {
          if (rightColumn) await actions.moveTask(task, rightColumn);
        },
      },
      {
        label: t('common.duplicate'),
        icon: 'copy',
        separator: true,
        onPress: async () => {
          await duplicateTaskById(task.id);
        },
      },
      {
        label: t('common.archive'),
        icon: 'archive',
        onPress: async () => {
          await actions.archiveTask(task);
        },
      },
      {
        label: t('common.delete'),
        icon: 'trash',
        destructive: true,
        separator: true,
        onPress: async () => {
          await actions.deleteTask(task);
        },
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
    if (!dialog) return;
    const fields = {
      title: v.title,
      description: v.description,
      color: v.color,
      dueAt: v.dueAt,
      dueHasTime: false,
    };
    try {
      if (dialog.mode === 'edit') {
        const state = useDataStore.getState();
        const before = state.tasks.find((item) => item.id === dialog.taskId);
        const target = cols.find((column) => column.id === v.columnId);
        if (!before) {
          setTaskDialog(null);
          return;
        }
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
          setTaskDialog(null);
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
      setTaskDialog(null);
    } catch {
      alert(t('common.error'), t('operation.saveFailed'));
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

  if (ready && !projectActive) {
    return <Redirect href={{ pathname: '/home', params: { selection: 'empty' } }} />;
  }

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>
        <BoardView
          header={header}
          emptyContent={!projectActive ? <ProjectSelectionEmptyState /> : undefined}
          resetKey={id}
          ref={boardRef}
          columns={projectActive ? cols : []}
          showEmptyState={projectActive}
          tasksOf={(columnId) => tasksByColumn.get(columnId) ?? []}
          cursor={projectActive && cursor ? current() : null}
          compactCards={density === 'compact'}
          detailedCards={density === 'detailed'}
          showTaskDescription={showTaskDescription}
          showTaskDueDate={showTaskDueDate}
          showTaskUpdatedAt={showTaskUpdatedAt}
          menuItemsFor={columnMenu}
          taskMenuFor={taskMenu}
          onAdvance={(task) => runBoardAction(() => actions.advance(task))}
          onTaskDrop={(task, target, manualIndex) => {
            if (task.columnId === target.id && manualIndex !== undefined) {
              runBoardAction(() => reorderTaskWithUndo(task.id, manualIndex));
            } else {
              runBoardAction(() => actions.moveTask(task, target));
            }
          }}
          onColumnDrop={(column, toIndex) =>
            runBoardAction(() => moveColumnWithUndo(column.id, toIndex))
          }
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
          try {
            if (target) {
              const before = useDataStore
                .getState()
                .columns.find((column) => column.id === target.id);
              if (!before) {
                setColumnDialog(null);
                return;
              }
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
            setColumnDialog(null);
          } catch {
            alert(t('common.error'), t('operation.saveFailed'));
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
          ).catch(() => alert(t('common.error'), t('operation.saveFailed')));
        }}
        onSetDue={(task, dueAt) => {
          void updateTaskWithUndo(
            task.id,
            { dueAt, dueHasTime: false },
            t('toast.taskDueUpdated'),
          ).catch(() => alert(t('common.error'), t('operation.saveFailed')));
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
            ).catch(() => alert(t('common.error'), t('operation.saveFailed')));
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
          pendingArchiveClearRef.current = () => {
            void actions
              .clear(kind)
              .catch(() => alert(t('common.error'), t('operation.saveFailed')));
          };
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
