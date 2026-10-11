import { useEffect, useState } from 'react';
import { LIMITS } from '@/config/limits';
import type { KanbanColumn, Project } from '@/domain/types';
import { validateMaxLength, validateTitle, firstError } from '@/domain/validation';
import { t } from '@/i18n';
import type { TaskColorKey } from '@/theme/taskColors';
import { Button } from '../ui/Button';
import { ColorPicker } from '../ui/ColorPicker';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/TextField';

interface ColumnDialogProps {
  visible: boolean;
  column: KanbanColumn | null;
  onClose: () => void;
  onSubmit: (v: { title: string; color: TaskColorKey | null }) => void;
}

/** カンバンの作成・名前変更ダイアログ。 */
export function ColumnDialog({ visible, column, onClose, onSubmit }: ColumnDialogProps) {
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(column?.title ?? '');
    setColor(column?.color ?? null);
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, column?.id]);

  const error = submitted ? validateTitle(title, LIMITS.columnTitleMax) : null;
  const submit = () => {
    setSubmitted(true);
    if (validateTitle(title, LIMITS.columnTitleMax)) return;
    onSubmit({ title: title.trim(), color });
  };

  return (
    <Dialog visible={visible} title={column ? t('column.rename') : t('column.create')} onClose={onClose} footer={<Button label={t('common.confirm')} onPress={submit} fullWidth />}>
      <TextField label={t('column.title')} value={title} onChangeText={setTitle} error={error} autoFocus onSubmitEditing={submit} returnKeyType="done" />
      <ColorPicker label={t('column.color')} value={color} onChange={setColor} />
    </Dialog>
  );
}

interface ProjectDialogProps {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
  onSubmit: (v: { title: string; description: string; color: TaskColorKey | null }) => void;
}

/** プロジェクトの作成・編集ダイアログ。 */
export function ProjectDialog({ visible, project, onClose, onSubmit }: ProjectDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(project?.title ?? '');
    setDescription(project?.description ?? '');
    setColor(project?.color ?? null);
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, project?.id]);

  const titleError = submitted ? validateTitle(title, LIMITS.projectTitleMax) : null;
  const descError = submitted ? validateMaxLength(description, LIMITS.projectDescriptionMax) : null;
  const submit = () => {
    setSubmitted(true);
    if (firstError(validateTitle(title, LIMITS.projectTitleMax), validateMaxLength(description, LIMITS.projectDescriptionMax))) return;
    onSubmit({ title: title.trim(), description, color });
  };

  return (
    <Dialog visible={visible} title={project ? t('project.edit') : t('project.create')} onClose={onClose} footer={<Button label={t('common.confirm')} onPress={submit} fullWidth />}>
      <TextField label={t('project.title')} value={title} onChangeText={setTitle} error={titleError} autoFocus onSubmitEditing={submit} returnKeyType="done" />
      <TextField label={t('project.description')} value={description} onChangeText={setDescription} error={descError} lines={3} />
      <ColorPicker label={t('project.color')} value={color} onChange={setColor} />
    </Dialog>
  );
}
