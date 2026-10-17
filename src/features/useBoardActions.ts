import { useMemo } from 'react';
import { clearBucket, previewClear, type ClearKind } from '@/features/maintenance';
import { pushUndo } from '@/features/undo';
import { columnsOf, tasksOf } from '@/domain/selectors';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import type { ToastCategory } from '@/config/defaults';

/**
 * ボード画面の操作（確認ダイアログ・元に戻す通知つき）。
 * 画面のコンポーネントからデータ操作の詳細を切り離して、読みやすく・テストしやすくする。
 */
export function useBoardActions(projectId: string) {
  const { confirm, toast, alert } = useFeedback();

  return useMemo(() => {
    const store = () => useDataStore.getState();

    const withUndo = (message: string, undo: () => Promise<void>, category: ToastCategory) => {
      const fn = pushUndo(undo);
      toast(message, { label: t('common.undo'), onPress: () => void fn() }, { category });
    };

    return {
      async moveTask(task: Task, target: KanbanColumn) {
        if (task.columnId === target.id) return;
        const from = task.columnId;
        await store().moveTask(task.id, target.id);
        withUndo(t('board.undoMoved'), () => store().moveTask(task.id, from), 'movement');
      },

      /** 次（右）のカンバンへ。いちばん右のときは最初のカンバンへ戻す。 */
      async advance(task: Task) {
        const cols = columnsOf(store().columns, projectId);
        if (cols.length < 2) return;
        const i = cols.findIndex((c) => c.id === task.columnId);
        await this.moveTask(task, cols[i + 1] ?? cols[0]!);
      },

      async deleteTask(task: Task, askFirst = true) {
        if (askFirst) {
          const r = await confirm({
            title: t('task.deleteTitle'),
            message: t('task.deleteMessage', { name: task.title }),
            confirmLabel: t('common.delete'),
            destructive: true,
          });
          if (r !== 'confirm') return false;
        }
        await store().deleteTask(task.id);
        withUndo(t('board.undoDeleted'), () => store().restoreItem('task', task.id), 'other');
        return true;
      },

      async archiveTask(task: Task) {
        await store().archiveTask(task.id, true);
        withUndo(
          t('board.archiveDoneResult', { count: 1 }),
          () => store().archiveTask(task.id, false),
          'other',
        );
      },

      async archiveDone() {
        const before = columnsOf(store().columns, projectId)
          .filter((c) => c.isDoneColumn)
          .flatMap((c) => tasksOf(store().tasks, c.id, c.sortMode));
        if (before.length === 0) {
          toast(t('board.archiveDoneNone'), undefined, { category: 'other' });
          return;
        }
        const count = await store().archiveDoneTasks(projectId);
        withUndo(
          t('board.archiveDoneResult', { count }),
          async () => {
            for (const task of before) await store().archiveTask(task.id, false);
          },
          'other',
        );
      },

      async deleteColumn(column: KanbanColumn) {
        const count = tasksOf(store().tasks, column.id, column.sortMode).length;
        const others = columnsOf(store().columns, projectId).filter((c) => c.id !== column.id);
        const r = await confirm({
          title: t('column.deleteTitle'),
          message: t('column.deleteMessage', { name: column.title, count }),
          confirmLabel: t('column.deleteWithTasks'),
          destructive: true,
          extraLabel: count > 0 && others.length > 0 ? t('column.moveTasksTo') : undefined,
        });
        if (r === 'cancel') return;
        let moveTo: string | null = null;
        if (r === 'extra') moveTo = others[0]!.id;
        await store().deleteColumn(column.id, moveTo);
        withUndo(t('board.undoDeleted'), () => store().restoreItem('column', column.id), 'other');
      },

      async clear(kind: ClearKind) {
        const count = previewClear(kind, projectId);
        if (count === 0) {
          toast(t('board.clearNothing'), undefined, { category: 'other' });
          return;
        }
        const r = await confirm({
          title: kind === 'trash' ? t('board.clearTrash') : t('board.clearArchive'),
          message:
            kind === 'trash'
              ? t('board.clearTrashMessage', { count })
              : t('board.clearArchiveMessage', { count }),
          confirmLabel:
            kind === 'trash' ? t('settings.clearPermanently') : t('board.moveArchiveToTrash'),
          destructive: true,
        });
        if (r !== 'confirm') return;
        const res = await clearBucket(kind, projectId);
        if (res.ok) {
          toast(t('board.clearDone', { count: res.count }), undefined, { category: 'other' });
        } else {
          alert(t('common.error'), res.message);
        }
      },
    };
  }, [projectId, confirm, toast, alert]);
}
