import { useEffect, useState } from 'react';
import type { Task } from '@/domain/types';
import type { IconKey } from '@/config/icons';
import { formatDue } from '@/domain/due';
import { formatDateTime } from '@/lib/dates';
import { UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CalendarDialog } from '../ui/CalendarDialog';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { SPACING, useTheme, ICON_SIZE } from '@/theme';
import { Keyboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

interface Props {
  record: Task | null;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  dismissImmediately?: boolean;
  onEdit: (task: Task) => void;
  onCopyTitle: () => void;
  onCopyDescription: () => void;
  onToggleFavorite: (task: Task) => void;
  onSetDue: (task: Task, dueAt: number | null) => void;
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
  onCopyTitle,
  onCopyDescription,
  onToggleFavorite,
  onSetDue,
  projectName,
  columnName,
}: Props) {
  const { colors, taskColor, lineWidth, lineColor } = useTheme();
  const [calendarVisible, setCalendarVisible] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- 詳細ダイアログが閉じた場合、期限選択を次回表示へ持ち越さない */
  useEffect(() => {
    if (!visible) setCalendarVisible(false);
  }, [visible]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const copyText = async (value: string, onCopied: () => void) => {
    try {
      await Clipboard.setStringAsync(value);
      onCopied();
    } catch {
      // クリップボードを利用できない環境でも詳細表示を維持する。
    }
  };

  const renderDescription = (value: string) => {
    const parts: { text: string; url?: string }[] = [];
    const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
    const trailingPunctuation = /[.,!?;:，．。！？、）)\]}」』】]+$/;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(value)) !== null) {
      const rawUrl = match[0];
      const url = rawUrl.replace(trailingPunctuation, '');
      if (!url) continue;
      if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index) });
      parts.push({ text: url, url });
      if (url.length < rawUrl.length) parts.push({ text: rawUrl.slice(url.length) });
      cursor = match.index + rawUrl.length;
    }
    if (cursor < value.length) parts.push({ text: value.slice(cursor) });

    return parts.map((part, index) =>
      part.url ? (
        <Text
          key={`${index}-${part.url}`}
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(part.url!).catch(() => {});
          }}
          style={{ color: colors.accent, textDecorationLine: 'underline' }}
        >
          {part.text}
        </Text>
      ) : (
        <Text key={index}>{part.text}</Text>
      ),
    );
  };
  if (!record) return null;

  const task = record;
  const description = task.description.trim();
  const due =
    task.dueAt === null
      ? t('task.dueNone')
      : formatDue({ dueAt: task.dueAt, dueHasTime: task.dueHasTime });

  const detail = (
    label: string,
    value: string,
    placeholder = false,
    icon?: IconKey,
    onIconPress?: () => void,
    iconActionLabel?: string,
  ) => (
    <View style={styles.section} key={label}>
      {onIconPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={iconActionLabel}
          hitSlop={4}
          onPress={onIconPress}
          style={styles.actionLabel}
        >
          <AppText variant="caption" muted style={styles.fieldLabel}>
            {label}
          </AppText>
        </Pressable>
      ) : (
        <AppText variant="caption" muted style={styles.fieldLabel}>
          {label}
        </AppText>
      )}
      <View style={styles.valueRow}>
        {icon ? (
          onIconPress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={iconActionLabel}
              hitSlop={6}
              onPress={onIconPress}
              style={styles.detailIconButton}
            >
              <Icon name={icon} size={ICON_SIZE.md} color={colors.textMuted} />
            </Pressable>
          ) : (
            <Icon name={icon} size={ICON_SIZE.md} color={colors.textMuted} />
          )
        ) : null}
        {onIconPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={iconActionLabel}
            hitSlop={4}
            onPress={onIconPress}
            style={styles.actionValue}
          >
            <AppText
              selectable
              color={placeholder ? colors.textMuted : colors.text}
              style={styles.value}
            >
              {value}
            </AppText>
          </Pressable>
        ) : (
          <AppText
            selectable
            color={placeholder ? colors.textMuted : colors.text}
            style={styles.value}
          >
            {value}
          </AppText>
        )}
      </View>
    </View>
  );

  return (
    <>
      <Dialog
        visible={visible && !!record}
        title={t('task.detailsTitle')}
        onClose={() => {
          setCalendarVisible(false);
          onClose();
        }}
        onDismiss={() => {
          setCalendarVisible(false);
          onDismiss();
        }}
        dismissImmediately={dismissImmediately}
        footer={
          <View style={styles.footerButtons}>
            <Button
              label={t('task.edit')}
              variant="primary"
              onPress={() => {
                setCalendarVisible(false);
                onEdit(task);
              }}
              style={styles.footerButton}
            />
            <Button
              label={t('common.close')}
              variant="secondary"
              onPress={() => {
                setCalendarVisible(false);
                onClose();
              }}
              style={styles.footerButton}
            />
          </View>
        }
      >
        <View style={styles.locationRow}>
          <AppText style={styles.locationName}>{projectName || t('common.none')}</AppText>
          <AppText muted>{t('task.locationSeparator')}</AppText>
          <AppText style={styles.locationName}>{columnName || t('common.none')}</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="caption" muted style={styles.fieldLabel}>
            {t('common.title')}
          </AppText>
          <View style={styles.valueRow}>
            <View style={styles.copySlot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('task.copyTitleAction')}
                onPress={() => void copyText(task.title, onCopyTitle)}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                style={styles.copyTitleTarget}
              >
                <View
                  style={[
                    styles.colorDot,
                    task.color
                      ? { backgroundColor: taskColor(task.color) }
                      : { borderColor: colors.border, borderWidth: lineWidth },
                  ]}
                />
              </Pressable>
            </View>
            <AppText selectable style={styles.value}>
              {task.title}
            </AppText>
          </View>
        </View>
        <View style={styles.section}>
          <AppText variant="caption" muted style={styles.fieldLabel}>
            {t('common.description')}
          </AppText>
          <View style={styles.valueRow}>
            <View style={styles.copySlot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('task.copyDescriptionAction')}
                onPress={() => void copyText(task.description, onCopyDescription)}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                style={styles.copyDescriptionTarget}
              >
                <Icon name="document" size={ICON_SIZE.sm} color={colors.textMuted} />
              </Pressable>
            </View>
            <AppText
              selectable
              style={styles.value}
              color={!description ? colors.textMuted : colors.text}
            >
              {description ? renderDescription(description) : t('common.noDescription')}
            </AppText>
          </View>
        </View>
        {detail(
          t('task.favorite'),
          task.isFavorite ? t('task.favoritePinned') : t('task.favoriteNotPinned'),
          false,
          task.isFavorite ? 'pin' : 'unpin',
          () => onToggleFavorite(task),
          task.isFavorite ? t('common.unfavorite') : t('common.favorite'),
        )}
        {detail(
          t('task.due'),
          due,
          task.dueAt === null,
          'calendar',
          () => {
            // カレンダーを閉じた際に背面の入力欄へフォーカスが戻らないようにする。
            Keyboard.dismiss();
            setCalendarVisible(true);
          },
          t('task.dueOpen'),
        )}
        {task.completedAt ? detail(t('task.completedAt'), formatDateTime(task.completedAt)) : null}
        {task.archivedAt ? detail(t('common.archive'), formatDateTime(task.archivedAt)) : null}
        {task.deletedAt !== null
          ? detail(t('common.deletedAt'), formatDateTime(task.deletedAt))
          : null}

        <View style={[styles.dateRow, { borderTopColor: lineColor, borderTopWidth: lineWidth }]}>
          <View style={styles.dateCell}>
            <View style={styles.dateLabel}>
              <Icon name="calendarAddOn" size={ICON_SIZE.md} color={colors.textMuted} />
              <AppText variant="caption" muted style={styles.fieldLabel}>
                {t('common.createdAt')}
              </AppText>
            </View>
            <AppText selectable muted style={styles.value}>
              {formatDateTime(task.createdAt)}
            </AppText>
          </View>
          <View style={styles.dateCell}>
            <View style={styles.dateLabel}>
              <Icon name="calendarClock" size={ICON_SIZE.md} color={colors.textMuted} />
              <AppText variant="caption" muted style={styles.fieldLabel}>
                {t('common.updatedAt')}
              </AppText>
            </View>
            <AppText selectable muted style={styles.value}>
              {formatDateTime(task.updatedAt)}
            </AppText>
          </View>
        </View>
      </Dialog>
      <CalendarDialog
        visible={calendarVisible && visible}
        value={task.dueAt}
        onClose={() => setCalendarVisible(false)}
        onSelect={(dueAt) => {
          onSetDue(task, dueAt);
          setCalendarVisible(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  locationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  locationName: { flexShrink: 1, minWidth: 0 },
  section: { gap: SPACING.xs },
  actionLabel: { alignSelf: 'flex-start' },
  actionValue: { flexShrink: 1, minWidth: 0 },
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
  detailIconButton: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  copySlot: {
    width: ICON_SIZE.md,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  copyTitleTarget: {
    width: ICON_SIZE.md,
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyDescriptionTarget: {
    width: ICON_SIZE.md,
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
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
