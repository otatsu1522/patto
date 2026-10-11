import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { monthGrid, shiftMonth } from '@/domain/calendar';
import { t } from '@/i18n';
import { startOfDay } from '@/lib/dates';
import { SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';

interface Props {
  visible: boolean;
  /** 選択中の日付（epoch ms）。なしは null */
  value: number | null;
  onClose: () => void;
  /** 日付を選んだ（null はクリア） */
  onSelect: (value: number | null) => void;
}

const CELL = 44;

/** 期限を選ぶカレンダー（年月日のみ）。 */
export function CalendarDialog({ visible, value, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const base = value !== null ? new Date(value) : new Date();
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() + 1 });

  useEffect(() => {
    if (!visible) return;
    const d = value !== null ? new Date(value) : new Date();
    setView({ year: d.getFullYear(), month: d.getMonth() + 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const weeks = monthGrid(view.year, view.month);
  const selected = value !== null ? startOfDay(value) : null;
  const today = startOfDay(Date.now());
  const weekdays = t('calendar.weekdays').split('');

  return (
    <Dialog
      visible={visible}
      title={t('calendar.title')}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button label={t('calendar.clear')} variant="secondary" onPress={() => onSelect(null)} style={styles.flex} />
          <Button label={t('calendar.today')} variant="secondary" onPress={() => onSelect(today)} style={styles.flex} />
        </View>
      }
    >
      <View style={styles.nav}>
        <IconButton icon="left" label={t('calendar.prev')} onPress={() => setView((v) => shiftMonth(v.year, v.month, -1))} />
        <AppText bold>{t('calendar.month', { year: view.year, month: view.month })}</AppText>
        <IconButton icon="right" label={t('calendar.next')} onPress={() => setView((v) => shiftMonth(v.year, v.month, 1))} />
      </View>
      <View style={styles.row}>
        {weekdays.map((w, i) => (
          <View key={`${w}${i}`} style={styles.cell}>
            <AppText variant="caption" muted>
              {w}
            </AppText>
          </View>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.row}>
          {week.map((cell, ci) => {
            if (cell.day === null) return <View key={ci} style={styles.cell} />;
            const ts = new Date(view.year, view.month - 1, cell.day).getTime();
            const isSelected = selected === ts;
            const isToday = today === ts;
            return (
              <Pressable
                key={ci}
                accessibilityRole="button"
                accessibilityLabel={`${view.year}-${view.month}-${cell.day}`}
                onPress={() => onSelect(ts)}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.cell,
                  {
                    backgroundColor: isSelected ? colors.primary : hovered ? colors.column : 'transparent',
                    borderColor: isToday ? colors.accent : 'transparent',
                  },
                ]}
              >
                <AppText bold={isSelected || isToday} color={isSelected ? colors.onPrimary : colors.text}>
                  {cell.day}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: CELL, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  footer: { flexDirection: 'row', gap: SPACING.sm },
  flex: { flex: 1 },
});
