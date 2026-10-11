import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIMITS } from '@/config/limits';
import { formatDue, parseDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { firstError, validateMaxLength, validateTitle } from '@/domain/validation';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { SPACING } from '@/theme';
import type { TaskColorKey } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { ColorPicker } from '../ui/ColorPicker';
import { Dialog } from '../ui/Dialog';
import { useFeedback } from '../ui/FeedbackProvider';
import { SwitchRow } from '../ui/Rows';
import { TextField } from '../ui/TextField';

export interface TaskFormValues {
  title: string;
  description: string;
  color: TaskColorKey | null;
  dueAt: number | null;
  dueHasTime: boolean;
  isFavorite: boolean;
}

interface Props {
  visible: boolean;
  /** null のときは新規作成 */
  task: Task | null;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
}

const dueText = (task: Task | null): string =>
  task && task.dueAt !== null ? formatDue({ dueAt: task.dueAt, dueHasTime: task.dueHasTime }) : '';

/** タスクの作成・編集ダイアログ（作成と編集で共通）。 */
export function TaskDialog({ visible, task, onClose, onSubmit, onDelete, onDuplicate, onArchive }: Props) {
  const { confirm } = useFeedback();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [due, setDue] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setColor(task?.color ?? null);
    setDue(dueText(task));
    setFavorite(task?.isFavorite ?? false);
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, task?.id]);

  const titleError = submitted ? validateTitle(title, LIMITS.taskTitleMax) : null;
  const descError = submitted ? validateMaxLength(description, LIMITS.taskDescriptionMax) : null;
  const parsedDue = parseDue(due);
  const dueError = submitted && parsedDue === 'invalid' ? t('task.dueInvalid') : null;

  const dirty =
    title !== (task?.title ?? '') ||
    description !== (task?.description ?? '') ||
    color !== (task?.color ?? null) ||
    due.trim() !== dueText(task) ||
    favorite !== (task?.isFavorite ?? false);

  const requestClose = async () => {
    if (dirty) {
      const r = await confirm({ title: t('task.discardTitle'), message: t('task.discardMessage'), confirmLabel: t('task.discard'), destructive: true });
      if (r !== 'confirm') return;
    }
    onClose();
  };

  const submit = () => {
    setSubmitted(true);
    if (firstError(validateTitle(title, LIMITS.taskTitleMax), validateMaxLength(description, LIMITS.taskDescriptionMax)) || parsedDue === 'invalid') return;
    onSubmit({
      title: title.trim(),
      description,
      color,
      dueAt: parsedDue ? parsedDue.dueAt : null,
      dueHasTime: parsedDue ? parsedDue.dueHasTime : false,
      isFavorite: favorite,
    });
  };

  return (
    <Dialog
      visible={visible}
      title={task ? t('task.edit') : t('task.create')}
      onClose={requestClose}
      footer={
        <>
          <Button label={t('common.confirm')} onPress={submit} fullWidth />
          {task ? (
            <View style={styles.row}>
              {onDuplicate ? <Button label={t('common.duplicate')} variant="secondary" icon="copy" onPress={onDuplicate} style={styles.flex} /> : null}
              {onArchive ? <Button label={t('common.archive')} variant="secondary" icon="archive" onPress={onArchive} style={styles.flex} /> : null}
              {onDelete ? <Button label={t('common.delete')} variant="danger" icon="trash" onPress={onDelete} style={styles.flex} /> : null}
            </View>
          ) : null}
        </>
      }
    >
      <TextField label={t('task.title')} value={title} onChangeText={setTitle} error={titleError} autoFocus={!task} onSubmitEditing={submit} returnKeyType="done" />
      <TextField label={t('task.description')} value={description} onChangeText={setDescription} error={descError} lines={4} />
      <ColorPicker label={t('task.color')} value={color} onChange={setColor} />
      <TextField label={t('task.due')} value={due} onChangeText={setDue} placeholder={t('task.dueHint')} error={dueError} autoCapitalize="none" autoCorrect={false} />
      <SwitchRow label={t('task.favorite')} value={favorite} onChange={setFavorite} />
      {task ? (
        <View style={styles.dates}>
          <AppText variant="caption" muted>
            {t('task.createdAt')}: {formatDateTime(task.createdAt)}
          </AppText>
          <AppText variant="caption" muted>
            {t('task.updatedAt')}: {formatDateTime(task.updatedAt)}
          </AppText>
        </View>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACING.sm },
  flex: { flex: 1 },
  dates: { gap: 2 },
});
