import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { archivedTasks, trashItems } from '@/domain/selectors';
import { t } from '@/i18n';
import { useFeedback } from '../ui/FeedbackProvider';
import { formatDateTime } from '@/lib/dates';
import { useDataStore } from '@/store/dataStore';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { BORDER_WIDTH } from '@/theme/tokens';
import { UI_METRICS } from '@/config/layout';

interface Props {
  /** null のときは閉じている */
  kind: 'archive' | 'trash' | null;
  projectId: string;
  onClose: () => void;
  onClear: () => void;
}

interface Row {
  key: string;
  title: string;
  kindLabel: string;
  at: number | null;
  restore: () => Promise<void>;
}

/** アーカイブ済みタスク / ごみ箱の中身を一覧し、復元やクリアができるダイアログ。 */
export function ArchiveDialog({ kind, projectId, onClose, onClear }: Props) {
  const { colors } = useTheme();
  const { alert } = useFeedback();
  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const store = useDataStore.getState();
  const [restoringAll, setRestoringAll] = useState(false);

  const rows: Row[] =
    kind === 'archive'
      ? archivedTasks(tasks, projectId).map((task) => ({
          key: task.id,
          title: task.title,
          kindLabel: t('board.kind.task'),
          at: task.archivedAt,
          restore: () => store.archiveTask(task.id, false),
        }))
      : kind === 'trash'
        ? trashItems({ projects, columns, tasks }, projectId).map((item) => ({
            key: item.record.id,
            title: item.record.title,
            kindLabel: t(
              item.kind === 'task'
                ? 'board.kind.task'
                : item.kind === 'column'
                  ? 'board.kind.column'
                  : 'board.kind.project',
            ),
            at: item.record.deletedAt,
            restore: () => store.restoreItem(item.kind, item.record.id),
          }))
        : [];

  const restoreAll = async () => {
    if (restoringAll) return;
    setRestoringAll(true);
    try {
      // ごみ箱一覧では親項目の復元が同じ削除時刻の子も復元するため、
      // セレクターが提示した復元単位を順に処理する。
      for (const row of rows) await row.restore();
    } catch {
      alert(t('common.error'), t('board.restoreAllFailed'));
    } finally {
      setRestoringAll(false);
    }
  };

  return (
    <Dialog
      visible={kind !== null}
      title={kind === 'trash' ? t('board.trashTitle') : t('board.archiveTitle')}
      onClose={onClose}
      footer={
        rows.length > 0 ? (
          <View style={styles.footerActions}>
            <Button
              label={t('board.restoreAll')}
              variant="outline"
              icon="restore"
              loading={restoringAll}
              disabled={restoringAll}
              onPress={() => void restoreAll()}
              fullWidth
            />
            <Button
              label={kind === 'trash' ? t('board.clearTrash') : t('board.clearArchive')}
              variant="danger"
              icon="trash"
              disabled={restoringAll}
              onPress={onClear}
              fullWidth
            />
          </View>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState title={t('board.listEmpty')} />
      ) : (
        rows.map((r) => (
          <View key={r.key} style={[styles.row, { borderColor: colors.border }]}>
            <View style={styles.texts}>
              <AppText numberOfLines={UI_METRICS.text.previewLines}>{r.title}</AppText>
              <AppText variant="caption" muted>
                {r.kindLabel}
                {r.at ? ` · ${formatDateTime(r.at)}` : ''}
              </AppText>
            </View>
            <IconButton
              icon="restore"
              label={t('common.restore')}
              disabled={restoringAll}
              onPress={r.restore}
            />
          </View>
        ))
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.md,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  texts: { flex: 1 },
  footerActions: { gap: SPACING.sm },
});
