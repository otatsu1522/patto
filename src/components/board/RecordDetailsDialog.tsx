import type { Task } from '@/domain/types';
import type { IconKey } from '@/config/icons';
import { formatDue } from '@/domain/due';
import { formatDateTime } from '@/lib/dates';
import { UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { SPACING, useTheme, ICON_SIZE } from '@/theme';
import { StyleSheet, View } from 'react-native';

interface Props {
  record: Task | null;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  dismissImmediately?: boolean;
  onEdit: (task: Task) => void;
  projectName?: string;
  columnName?: string;
}

/** タスクの情報を閲覧するダイアログ。項目名と値を統一したスタイルで表示する。 */
export function RecordDetailsDialog({
  record,
  visible,
  onClose,
  onDismiss,
  dismissImmediately = false,
  onEdit,
  projectName,
  columnName,
}: Props) {
  const { colors, taskColor, lineWidth, lineColor } = useTheme();
  if (!record) return null;

  const task = record;
  const description = task.description.trim();
  const due =
    task.dueAt === null
      ? t('task.dueNone')
      : formatDue({ dueAt: task.dueAt, dueHasTime: task.dueHasTime });

  const detail = (label: string, value: string, placeholder = false, icon?: IconKey) => (
    <View style={styles.section} key={label}>
      <AppText variant="caption" muted style={styles.fieldLabel}>
        {label}
      </AppText>
      <View style={styles.valueRow}>
        {icon ? <Icon name={icon} size={ICON_SIZE.md} color={colors.textMuted} /> : null}
        <AppText
          selectable
          color={placeholder ? colors.textMuted : colors.text}
          style={styles.value}
        >
          {value}
        </AppText>
      </View>
    </View>
  );

  return (
    <Dialog
      visible={visible && !!record}
      title={t('task.detailsTitle')}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissImmediately={dismissImmediately}
      footer={
        <View style={styles.footerButtons}>
          <Button
            label={t('task.edit')}
            variant="primary"
            onPress={() => onEdit(task)}
            style={styles.footerButton}
          />
          <Button
            label={t('common.close')}
            variant="secondary"
            onPress={onClose}
            style={styles.footerButton}
          />
        </View>
      }
    >
      <View style={styles.locationRow}>
        <AppText numberOfLines={UI_METRICS.text.singleLineMax} style={styles.locationName}>
          {projectName || t('common.none')}
        </AppText>
        <AppText muted>{t('task.locationSeparator')}</AppText>
        <AppText numberOfLines={UI_METRICS.text.singleLineMax} style={styles.locationName}>
          {columnName || t('common.none')}
        </AppText>
      </View>

      <View style={styles.section}>
        <AppText variant="caption" muted style={styles.fieldLabel}>
          {t('common.title')}
        </AppText>
        <View style={styles.valueRow}>
          {task.color ? (
            <View style={[styles.colorDot, { backgroundColor: taskColor(task.color) }]} />
          ) : null}
          <AppText selectable style={styles.value}>
            {task.title}
          </AppText>
        </View>
      </View>
      {detail(t('common.description'), description || t('common.noDescription'), !description)}
      {detail(
        t('task.favorite'),
        task.isFavorite ? t('common.yes') : t('common.no'),
        false,
        task.isFavorite ? 'pin' : 'unpin',
      )}
      {detail(t('task.due'), due, task.dueAt === null, 'calendar')}
      {task.completedAt ? detail(t('task.completedAt'), formatDateTime(task.completedAt)) : null}
      {task.archivedAt ? detail(t('common.archive'), formatDateTime(task.archivedAt)) : null}
      {task.deletedAt !== null
        ? detail(t('common.deletedAt'), formatDateTime(task.deletedAt))
        : null}

      <View style={[styles.dateRow, { borderTopColor: lineColor, borderTopWidth: lineWidth }]}>
        <View style={styles.dateCell}>
          <View style={styles.dateLabel}>
            <Icon name="edit" size={ICON_SIZE.md} color={colors.textMuted} />
            <AppText variant="caption" muted style={styles.fieldLabel}>
              {t('common.createdAt')}
            </AppText>
          </View>
          <AppText selectable style={styles.value}>
            {formatDateTime(task.createdAt)}
          </AppText>
        </View>
        <View style={styles.dateCell}>
          <View style={styles.dateLabel}>
            <Icon name="refresh" size={ICON_SIZE.md} color={colors.textMuted} />
            <AppText variant="caption" muted style={styles.fieldLabel}>
              {t('common.updatedAt')}
            </AppText>
          </View>
          <AppText selectable style={styles.value}>
            {formatDateTime(task.updatedAt)}
          </AppText>
        </View>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  locationName: { flexShrink: 1 },
  section: { gap: SPACING.xs },
  fieldLabel: { alignSelf: 'flex-start' },
  dateLabel: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minWidth: 0 },
  value: { flexShrink: 1, minWidth: 0 },
  colorDot: {
    width: UI_METRICS.board.colorDotSize,
    height: UI_METRICS.board.colorDotSize,
    borderRadius: UI_METRICS.board.colorDotSize / 2,
    flexShrink: 0,
  },
  dateRow: {
    flexDirection: 'row',
    gap: SPACING.lg,
    paddingTop: SPACING.md,
  },
  dateCell: { flex: 1, minWidth: 0, gap: SPACING.xs },
  footerButtons: { flexDirection: 'row', gap: SPACING.sm },
  footerButton: { flex: 1 },
});
