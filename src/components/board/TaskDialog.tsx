import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { LIMITS } from '@/config/limits';
import { BOARD, UI_METRICS } from '@/config/layout';
import { formatDueInput, formatDueTyping, normalizeDueInput, parseDue } from '@/domain/due';
import type { Task } from '@/domain/types';
import { firstError, validateMaxLength, validateTitle } from '@/domain/validation';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { SPACING, useTheme, ICON_SIZE } from '@/theme';
import type { TaskColorKey } from '@/theme/taskColors';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CalendarDialog } from '../ui/CalendarDialog';
import { ColorPicker } from '../ui/ColorPicker';
import { Dialog } from '../ui/Dialog';
import { DiscardChangesOverlay } from '../ui/DiscardChangesOverlay';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { TextField } from '../ui/TextField';
import { canHover } from '@/lib/hover';

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
  task && task.dueAt !== null ? formatDueInput(task.dueAt) : '';

/**
 * タスクの作成・編集ダイアログ（共通）。
 * 新規作成では「タスク名」と「色」を先に表示し、既存タスクの編集では「オプション」を開いた状態にする。
 * 複製・アーカイブ・削除・ピン留めは、タスクをタップしたときのメニューから行う。
 */
export function TaskDialog({ visible, task, columns, defaultColumnId, onClose, onSubmit }: Props) {
  const { colors, controlLineWidth, controlLineColor } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<TaskColorKey | null>(null);
  const [due, setDue] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId);
  const [calendar, setCalendar] = useState(false);
  const [options, setOptions] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const titleInputRef = useRef<TextInput>(null);
  const focusTitleInput = useCallback(() => {
    titleInputRef.current?.focus();
  }, []);

  // 閉じるアニメーション中に表示が切り替わらないよう、開いている間のタスクを覚えておく
  const [lastTask, setLastTask] = useState<Task | null>(task);
  if (visible && lastTask !== task) setLastTask(task);
  const shownTask = visible ? task : lastTask;

  const initialColumn = task?.columnId ?? defaultColumnId;

  /* eslint-disable react-hooks/set-state-in-effect -- ダイアログを開くたびに、入力欄を元の値に戻す */
  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setColor(task?.color ?? null);
    setDue(dueText(task));
    setColumnId(initialColumn);
    setCalendar(false);
    setOptions(task !== null);
    setSelectOpen(false);
    setSubmitted(false);
    setDiscardPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, task?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const submit = () => {
    setSubmitted(true);
    if (
      firstError(
        validateTitle(title, LIMITS.taskTitleMax),
        validateMaxLength(description, LIMITS.taskDescriptionMax),
      ) ||
      parsedDue === 'invalid'
    )
      return;
    onSubmit({
      title: title.trim(),
      description,
      color,
      dueAt: parsedDue ? parsedDue.dueAt : null,
      columnId,
    });
  };

  const currentColumn = columns.find((c) => c.id === columnId);

  return (
    <>
      <Dialog
        visible={visible}
        title={shownTask ? t('task.edit') : t('task.create')}
        onClose={requestClose}
        onShow={focusTitleInput}
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
          label={t('task.title')}
          value={title}
          onChangeText={(value) => setTitle(value.replace(/[\r\n]+/g, ' '))}
          error={titleError}
          ref={titleInputRef}
          key={`${visible ? 'open' : 'closed'}-${shownTask?.id ?? 'new'}`}
          autoGrow
          onSubmitEditing={submit}
          onEnter={submit}
        />
        <ColorPicker label={t('task.color')} value={color} onChange={setColor} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={options ? t('task.optionsHide') : t('task.options')}
          onPress={() => setOptions((v) => !v)}
          style={styles.optionsToggle}
        >
          <AppText muted bold>
            {t('task.options')}
          </AppText>
          <Icon name={options ? 'up' : 'down'} size={ICON_SIZE.xl} color={colors.textMuted} />
        </Pressable>

        {options ? (
          <>
            <TextField
              label={t('task.description')}
              value={description}
              onChangeText={setDescription}
              error={descError}
              lines={UI_METRICS.textField.descriptionLines}
            />

            <View style={styles.dueRow}>
              <View style={styles.flex}>
                <TextField
                  label={t('task.due')}
                  value={due}
                  onChangeText={(v) => setDue(formatDueTyping(v))}
                  onBlur={() => setDue((v) => normalizeDueInput(v))}
                  onClear={() => setDue('')}
                  placeholder={t('task.dueHint')}
                  error={dueError}
                  keyboardType="number-pad"
                  maxLength={LIMITS.dueDateInputMax}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <IconButton
                icon="calendar"
                label={t('task.dueOpen')}
                onPress={() => setCalendar(true)}
                style={styles.dueButton}
              />
            </View>

            <View style={styles.field}>
              <AppText variant="label" muted>
                {t('task.column')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('task.column')}
                onPress={() => setSelectOpen((v) => !v)}
                style={[
                  styles.select,
                  {
                    borderColor: controlLineColor,
                    backgroundColor: colors.surface,
                    borderWidth: controlLineWidth,
                  },
                ]}
              >
                <AppText style={styles.flex} numberOfLines={UI_METRICS.text.singleLineMax}>
                  {currentColumn?.title ?? ''}
                </AppText>
                <Icon
                  name={selectOpen ? 'up' : 'down'}
                  size={ICON_SIZE.lg}
                  color={colors.textMuted}
                />
              </Pressable>
              {selectOpen ? (
                <View style={{ borderColor: controlLineColor, borderWidth: controlLineWidth }}>
                  {columns.map((c) => (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setColumnId(c.id);
                        setSelectOpen(false);
                      }}
                      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.option,
                        { backgroundColor: hovered && canHover ? colors.hover : 'transparent' },
                      ]}
                    >
                      <View style={styles.checkSlot}>
                        {c.id === columnId ? <Icon name="check" size={ICON_SIZE.lg} /> : null}
                      </View>
                      <AppText numberOfLines={UI_METRICS.text.singleLineMax} style={styles.flex}>
                        {c.title}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            {shownTask ? (
              <View style={styles.dates}>
                <View style={styles.dateLine}>
                  <Icon name="edit" size={ICON_SIZE.md} color={colors.textMuted} />
                  <AppText variant="caption" muted>
                    {t('task.createdAt')}
                    {t('common.labelValueSeparator')}
                    {formatDateTime(shownTask.createdAt)}
                  </AppText>
                </View>
                <View style={styles.dateLine}>
                  <Icon name="refresh" size={ICON_SIZE.md} color={colors.textMuted} />
                  <AppText variant="caption" muted>
                    {t('task.updatedAt')}
                    {t('common.labelValueSeparator')}
                    {formatDateTime(shownTask.updatedAt)}
                  </AppText>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </Dialog>

      <CalendarDialog
        visible={calendar}
        value={parsedDue && parsedDue !== 'invalid' ? parsedDue.dueAt : null}
        onClose={() => setCalendar(false)}
        onSelect={(ts) => {
          setDue(ts === null ? '' : formatDueInput(ts));
          setCalendar(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  dueButton: { marginBottom: UI_METRICS.board.dueButtonBaselineAdjustment },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  field: { gap: SPACING.xs },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: BOARD.touchTarget,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: BOARD.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  checkSlot: { width: UI_METRICS.board.checkboxSlotWidth, alignItems: 'center' },
  optionsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: BOARD.touchTarget,
  },
  /** 作成日と更新日: 横に並べて中央寄せ、間に余白 */
  dates: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginBottom: -SPACING.sm,
  },
});
