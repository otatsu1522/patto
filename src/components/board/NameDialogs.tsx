import { useEffect, useState } from 'react';
import { LIMITS } from '@/config/limits';
import type { KanbanColumn, Project } from '@/domain/types';
import { validateTitle } from '@/domain/validation';
import { useFocusOnOpen } from '@/hooks/useFocusOnOpen';
import { t } from '@/i18n';
import type { TaskColorKey } from '@/theme/taskColors';
import { Button } from '../ui/Button';
import { ColorPicker } from '../ui/ColorPicker';
import { Dialog } from '../ui/Dialog';
import { DiscardChangesOverlay } from '../ui/DiscardChangesOverlay';
import { TextField } from '../ui/TextField';

interface ColumnDialogProps {
  visible: boolean;
  column: KanbanColumn | null;
  onClose: () => void;
  onSubmit: (v: { title: string; color: TaskColorKey | null }) => void;
}

/** カンバンの作成・名前変更ダイアログ。 */
export function ColumnDialog({ visible, column, onClose, onSubmit }: ColumnDialogProps) {
  const [lastColumn, setLastColumn] = useState(column);
  if (visible && lastColumn !== column) setLastColumn(column);
  const shownColumn = visible ? column : lastColumn;
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const titleInput = useFocusOnOpen(visible);

  /* eslint-disable react-hooks/set-state-in-effect -- ダイアログを開くたびに、入力欄を元の値に戻す */
  useEffect(() => {
    if (!visible) return;
    setTitle(column?.title ?? '');
    setColor(column?.color ?? null);
    setSubmitted(false);
    setDiscardPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, column?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dirty = title !== (column?.title ?? '') || color !== (column?.color ?? null);
  const requestClose = () => {
    if (discardPrompt) {
      setDiscardPrompt(false);
      return;
    }
    if (dirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  };
  const error = submitted ? validateTitle(title, LIMITS.columnTitleMax) : null;
  const submit = () => {
    setSubmitted(true);
    if (validateTitle(title, LIMITS.columnTitleMax)) return;
    onSubmit({ title: title.trim(), color });
  };

  return (
    <Dialog
      visible={visible}
      title={shownColumn ? t('column.rename') : t('column.create')}
      onClose={requestClose}
      overlay={
        <DiscardChangesOverlay
          visible={discardPrompt}
          onKeepEditing={() => setDiscardPrompt(false)}
          onDiscard={() => {
            setDiscardPrompt(false);
            onClose();
          }}
        />
      }
      footer={<Button label={t('common.confirm')} variant="accent" onPress={submit} fullWidth />}
    >
      <TextField
        label={t('column.title')}
        value={title}
        onChangeText={setTitle}
        error={error}
        ref={titleInput}
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      <ColorPicker label={t('column.color')} value={color} onChange={setColor} />
    </Dialog>
  );
}

interface ProjectDialogProps {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
  onSubmit: (v: { title: string; color: TaskColorKey | null }) => void;
}

/** プロジェクトの作成・編集ダイアログ（タイトルと色のみ）。 */
export function ProjectDialog({ visible, project, onClose, onSubmit }: ProjectDialogProps) {
  const [lastProject, setLastProject] = useState(project);
  if (visible && lastProject !== project) setLastProject(project);
  const shownProject = visible ? project : lastProject;
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const titleInput = useFocusOnOpen(visible);

  /* eslint-disable react-hooks/set-state-in-effect -- ダイアログを開くたびに、入力欄を元の値に戻す */
  useEffect(() => {
    if (!visible) return;
    setTitle(project?.title ?? '');
    setColor(project?.color ?? null);
    setSubmitted(false);
    setDiscardPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, project?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dirty = title !== (project?.title ?? '') || color !== (project?.color ?? null);
  const requestClose = () => {
    if (discardPrompt) {
      setDiscardPrompt(false);
      return;
    }
    if (dirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  };
  const titleError = submitted ? validateTitle(title, LIMITS.projectTitleMax) : null;
  const submit = () => {
    setSubmitted(true);
    if (validateTitle(title, LIMITS.projectTitleMax)) return;
    onSubmit({ title: title.trim(), color });
  };

  return (
    <Dialog
      visible={visible}
      title={shownProject ? t('project.edit') : t('project.create')}
      onClose={requestClose}
      overlay={
        <DiscardChangesOverlay
          visible={discardPrompt}
          onKeepEditing={() => setDiscardPrompt(false)}
          onDiscard={() => {
            setDiscardPrompt(false);
            onClose();
          }}
        />
      }
      footer={<Button label={t('common.confirm')} variant="accent" onPress={submit} fullWidth />}
    >
      <TextField
        label={t('project.title')}
        value={title}
        onChangeText={setTitle}
        error={titleError}
        ref={titleInput}
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      <ColorPicker label={t('project.color')} value={color} onChange={setColor} />
    </Dialog>
  );
}
