import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LIMITS } from '@/config/limits';
import { formatDue, parseDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { firstError, validateMaxLength, validateTitle } from '@/domain/validation';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { SPACING, useTheme } from '@/theme';
import type { TaskColorKey } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CalendarDialog } from '../ui/CalendarDialog';
import { ColorPicker } from '../ui/ColorPicker';
import { Dialog } from '../ui/Dialog';
import { DropdownMenu } from '../ui/DropdownMenu';
import { useFeedback } from '../ui/FeedbackProvider';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/TextField';

export interface TaskFormValues {
  title: string;
  description: string;
  color: TaskColorKey | null;
  dueAt: number | null;
  columnId: string;
}

interface Props {
  visible: boolean;
  /** null のときは新規作成 */
  task: Task | null;
  /** プロジェクト内のカンバン（場所の選択肢） */
  columns: { id: string; title: string }[];
  /** 新規作成時の初期のカンバン */
  defaultColumnId: string;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void;
}

const dueText = (task: Task | null): string =>
  task && task.dueAt !== null ? formatDue({ dueAt: task.dueAt, dueHasTime: false }) : '';

/** タスクの作成・編集ダイアログ（作成と編集で共通）。複製・アーカイブ・削除・お気に入りはタスクのメニューから行う。 */
export function TaskDialog({ visible, task, columns, defaultColumnId, onClose, onSubmit }: Props) {
  const { confirm } = useFeedback();
  const { colors } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [due, setDue] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId);
  const [calendar, setCalendar] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const initialColumn = task?.columnId ?? defaultColumnId;

  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setColor(task?.color ?? null);
    setDue(dueText(task));
    setColumnId(initialColumn);
    setCalendar(false);
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
    columnId !== initialColumn;

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
    onSubmit({ title: title.trim(), description, color, dueAt: parsedDue ? parsedDue.dueAt : null, columnId });
  };

  const currentColumn = columns.find((c) => c.id === columnId);

  return (
    <>
      <Dialog
        visible={visible}
        title={task ? t('task.edit') : t('task.create')}
        onClose={requestClose}
        footer={<Button label={t('common.confirm')} onPress={submit} fullWidth />}
      >
        <TextField label={t('task.title')} value={title} onChangeText={setTitle} error={titleError} autoFocus onSubmitEditing={submit} returnKeyType="done" />
        <TextField label={t('task.description')} value={description} onChangeText={setDescription} error={descError} lines={4} />
        <ColorPicker label={t('task.color')} value={color} onChange={setColor} />

        <View style={styles.dueRow}>
          <View style={styles.flex}>
            <TextField label={t('task.due')} value={due} onChangeText={setDue} placeholder={t('task.dueHint')} error={dueError} autoCapitalize="none" autoCorrect={false} />
          </View>
          <IconButton icon="calendar" label={t('task.dueOpen')} onPress={() => setCalendar(true)} style={styles.dueButton} />
        </View>

        <View style={styles.field}>
          <AppText variant="label" muted>
            {t('task.column')}
          </AppText>
          <DropdownMenu
            anchorStyle={styles.flex}
            items={columns.map((c) => ({ label: c.title, icon: c.id === columnId ? 'check' : undefined, onPress: () => setColumnId(c.id) }))}
            trigger={(open) => (
              <Pressable accessibilityRole="button" accessibilityLabel={t('task.column')} onPress={open} style={[styles.select, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <AppText style={styles.flex} numberOfLines={1}>
                  {currentColumn?.title ?? ''}
                </AppText>
                <Icon name="down" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          />
        </View>

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

      <CalendarDialog
        visible={calendar}
        value={parsedDue && parsedDue !== 'invalid' ? parsedDue.dueAt : null}
        onClose={() => setCalendar(false)}
        onSelect={(ts) => {
          setDue(ts === null ? '' : formatDue({ dueAt: ts, dueHasTime: false }));
          setCalendar(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  dueButton: { marginBottom: 2 },
  field: { gap: SPACING.xs },
  select: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderWidth: 1, paddingHorizontal: SPACING.md, minHeight: 44 },
  dates: { gap: 2, alignItems: 'flex-end' },
});
