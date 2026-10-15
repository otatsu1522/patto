import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Divider, Section, SwitchRow } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { BOARD } from '@/config/layout';
import { t, type StringKey } from '@/i18n';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import {
  SHORTCUT_ACTIONS,
  displayKey,
  findConflict,
  isModifierOnly,
  keyToString,
  resolveBindings,
  type ActionId,
} from '@/shortcuts/actions';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { BORDER_WIDTH, RADIUS, SPACING, useTheme } from '@/theme';

const INFO_KEYS: StringKey[] = [
  'shortcut.info1',
  'shortcut.info2',
  'shortcut.info3',
  'shortcut.info4',
  'shortcut.info5',
  'shortcut.info6',
  'shortcut.info7',
];

/** キーボードショートカットの確認・変更（Web版）。 */
export default function ShortcutSettings() {
  const scrollRef = useWebWheelScroll();
  const { colors } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const bindings = resolveBindings(settings.shortcutOverrides);
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [message, setMessage] = useState<{ id: ActionId; text: string } | null>(null);
  const [info, setInfo] = useState(false);

  // この画面を開いている間は、ほかのショートカット（タスク作成など）が反応しないようにする
  useEffect(() => {
    useUiStore.getState().pushDialog();
    return () => useUiStore.getState().popDialog();
  }, []);

  // キー入力の待ち受け
  useEffect(() => {
    if (!capturing || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (isModifierOnly(e.key)) return;
      e.preventDefault();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const key = keyToString(e);
      const conflict = findConflict(bindings, capturing, key);
      if (conflict) {
        const label = SHORTCUT_ACTIONS.find((a) => a.id === conflict)!.labelKey;
        setMessage({
          id: capturing,
          text: t('settings.shortcutsConflict', { key: displayKey(key), action: t(label) }),
        });
      } else if (!bindings[capturing].includes(key)) {
        update({
          shortcutOverrides: {
            ...settings.shortcutOverrides,
            [capturing]: [...bindings[capturing], key],
          },
        });
        setMessage(null);
      }
      setCapturing(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const setKeys = (id: ActionId, keys: string[]) =>
    update({ shortcutOverrides: { ...settings.shortcutOverrides, [id]: keys } });
  const reset = (id: ActionId) => {
    const next = { ...settings.shortcutOverrides };
    delete next[id];
    update({ shortcutOverrides: next });
  };
  const startCapture = (id: ActionId) => {
    setMessage(null);
    setCapturing(id);
  };

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.shortcuts')} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          {Platform.OS !== 'web' ? <AppText muted>{t('settings.shortcutsWebOnly')}</AppText> : null}
          <Section>
            <SwitchRow
              label={t('settings.shortcutsEnabled')}
              value={settings.shortcutsEnabled}
              onChange={(v) => update({ shortcutsEnabled: v })}
            />
          </Section>

          <View style={styles.infoRow}>
            <AppText variant="caption" muted style={styles.flex}>
              {t('settings.shortcutsFixed')}
            </AppText>
            <IconButton
              icon="info"
              label={t('shortcut.infoTitle')}
              onPress={() => setInfo(true)}
              box={36}
              size={20}
              color={colors.textMuted}
            />
          </View>

          <Section>
            {SHORTCUT_ACTIONS.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <AppText style={styles.label}>{t(a.labelKey)}</AppText>
                  <View style={styles.keys}>
                    {bindings[a.id].map((k) => (
                      <Pressable
                        key={k}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('settings.shortcutsRemove')}: ${displayKey(k)}`}
                        onPress={() =>
                          setKeys(
                            a.id,
                            bindings[a.id].filter((x) => x !== k),
                          )
                        }
                        style={[
                          styles.key,
                          { borderColor: colors.border, backgroundColor: colors.hover },
                        ]}
                      >
                        <AppText variant="caption" bold>
                          {displayKey(k)}
                        </AppText>
                      </Pressable>
                    ))}
                    {bindings[a.id].length === 0 || capturing === a.id ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('shortcut.emptySlot')}
                        onPress={() => startCapture(a.id)}
                        style={[
                          styles.slot,
                          { borderColor: capturing === a.id ? colors.accent : colors.divider },
                        ]}
                      >
                        {capturing === a.id ? (
                          <AppText variant="caption" color={colors.accent}>
                            {t('settings.shortcutsPress')}
                          </AppText>
                        ) : null}
                      </Pressable>
                    ) : null}
                    <IconButton
                      icon="add"
                      label={t('settings.shortcutsAdd')}
                      onPress={() => startCapture(a.id)}
                      box={34}
                      size={18}
                    />
                    <IconButton
                      icon="restore"
                      label={t('settings.shortcutsReset')}
                      onPress={() => reset(a.id)}
                      box={34}
                      size={18}
                    />
                  </View>
                </View>
                {message?.id === a.id ? (
                  <AppText variant="caption" color={colors.danger} style={styles.rowMessage}>
                    {message.text}
                  </AppText>
                ) : null}
              </View>
            ))}
          </Section>
          <Button
            label={t('settings.shortcutsResetAll')}
            variant="secondary"
            onPress={() => update({ shortcutOverrides: {} })}
          />
        </View>
      </ScrollView>

      <Dialog visible={info} title={t('shortcut.infoTitle')} onClose={() => setInfo(false)}>
        {INFO_KEYS.map((key) => (
          <AppText key={key}>{t(key)}</AppText>
        ))}
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    touchAction: 'pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.lg },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
    minHeight: 52,
  },
  label: { flex: 1 },
  keys: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    maxWidth: '60%',
  },
  key: {
    minWidth: 30,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: BORDER_WIDTH,
    alignItems: 'center',
  },
  /** キーがない（または追加待ち）の点線の四角 */
  slot: {
    minWidth: 44,
    minHeight: 28,
    paddingHorizontal: SPACING.sm,
    borderWidth: BORDER_WIDTH,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMessage: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
