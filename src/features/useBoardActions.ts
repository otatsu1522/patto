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
        await store().moveTask(task.id, target.id);
        toast(t('board.taskMoved'), undefined, { category: 'movement' });
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
        withUndo(t('board.undoDeleted'), () => store().restoreItem('task', task.id), 'editing');
        return true;
      },

      async archiveTask(task: Task) {
        await store().archiveTask(task.id, true);
        withUndo(
          t('board.archiveDoneResult', { count: 1 }),
          () => store().archiveTask(task.id, false),
          'editing',
        );
      },

      async archiveDone() {
        const before = columnsOf(store().columns, projectId)
          .filter((c) => c.isDoneColumn)
          .flatMap((c) => tasksOf(store().tasks, c.id, c.sortMode));
        if (before.length === 0) {
          toast(t('board.archiveDoneNone'), undefined, { category: 'system' });
          return;
        }
        const count = await store().archiveDoneTasks(projectId);
        withUndo(
          t('board.archiveDoneResult', { count }),
          async () => {
            for (const task of before) await store().archiveTask(task.id, false);
          },
          'editing',
        );
      },

      async deleteColumn(column: KanbanColumn) {
        // 表示中のタスクだけでなく、アーカイブ済みを含む未削除タスクを数える。
        const count = store().tasks.filter(
          (task) => task.columnId === column.id && task.deletedAt === null,
        ).length;
        const r = await confirm({
          title: t('column.deleteTitle'),
          message: t('column.deleteMessage', { name: column.title, count }),
          confirmLabel: t('common.delete'),
          destructive: true,
        });
        if (r !== 'confirm') return;
        await store().deleteColumn(column.id);
        withUndo(t('board.undoDeleted'), () => store().restoreItem('column', column.id), 'editing');
      },

      async clear(kind: ClearKind) {
        const count = previewClear(kind, projectId);
        if (count === 0) {
          toast(t('board.clearNothing'), undefined, { category: 'system' });
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
          toast(t('board.clearDone', { count: res.count }), undefined, { category: 'system' });
        } else {
          alert(t('common.error'), res.message);
        }
      },
    };
  }, [projectId, confirm, toast, alert]);
}
