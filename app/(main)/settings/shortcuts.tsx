import { Fragment, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
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
  displayKeyParts,
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
  'shortcut.info8',
];

/** 表示するキーの幅から、キー欄を必要最小限の幅で表示するための概算。 */
const estimatedComboWidth = (shortcut: string) => {
  const parts = displayKeyParts(shortcut);
  const keysWidth = parts.reduce((width, part) => width + Math.max(18, part.length * 7) + 4, 0);
  return keysWidth + Math.max(0, parts.length - 1) * 4 + 2;
};

/** キーボードショートカットの確認・変更（Web版）。 */
export default function ShortcutSettings() {
  const scrollRef = useWebWheelScroll();
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const bindings = resolveBindings(settings.shortcutOverrides);
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [message, setMessage] = useState<{ id: ActionId; text: string } | null>(null);
  const [info, setInfo] = useState(false);

  // この画面を開いている間は、ほかのショートカット（タスク作成など）が反応しないようにする。
  useEffect(() => {
    useUiStore.getState().pushDialog();
    return () => useUiStore.getState().popDialog();
  }, []);

  // キー入力の待ち受け。
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

  const maxKeyFieldWidth = Math.max(120, Math.min(440, windowWidth * 0.52));
  const keyFieldWidth = (id: ActionId) => {
    const keys = bindings[id];
    const chipsWidth = keys.reduce(
      (total, key) => total + estimatedComboWidth(key) + SPACING.xs,
      0,
    );
    const desiredWidth =
      SPACING.sm * 2 +
      BORDER_WIDTH * 2 +
      chipsWidth +
      (capturing === id ? 92 : 52) +
      (keys.length ? SPACING.xs : 0);
    return Math.min(maxKeyFieldWidth, Math.max(120, desiredWidth));
  };

  const renderComboParts = (shortcut: string) =>
    displayKeyParts(shortcut).map((part, index) => (
      <Fragment key={`${part}-${index}`}>
        {index > 0 ? (
          <AppText variant="caption" muted style={styles.comboPlus}>
            +
          </AppText>
        ) : null}
        <View style={[styles.keyCap, { backgroundColor: 'transparent' }]}>
          <AppText variant="caption" bold>
            {part}
          </AppText>
        </View>
      </Fragment>
    ));

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
              {t('settings.shortcutsGuide')}
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
            <View style={styles.row}>
              <View style={styles.labelBlock}>
                <AppText style={styles.label}>{t('settings.shortcutsEscape')}</AppText>
                <AppText variant="caption" muted>
                  {t('settings.shortcutsEscapeHint')}
                </AppText>
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.keyField,
                  styles.fixedKeyField,
                  { borderColor: colors.border, backgroundColor: colors.bg },
                ]}
              >
                <View style={[styles.combo, styles.fixedCombo, { borderColor: colors.divider }]}>
                  <View style={styles.keyCap}>
                    <AppText variant="caption" bold>
                      Esc
                    </AppText>
                  </View>
                </View>
              </View>
            </View>
            <Divider />
            {SHORTCUT_ACTIONS.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <AppText style={styles.label}>{t(a.labelKey)}</AppText>
                  <View
                    accessibilityLabel={t('settings.shortcutsAdd')}
                    accessibilityHint={t('settings.shortcutsGuide')}
                    onStartShouldSetResponder={() => true}
                    onResponderRelease={() => {
                      if (capturing !== a.id) startCapture(a.id);
                    }}
                    style={[
                      styles.keyField,
                      bindings[a.id].length === 0 ? styles.emptyKeyField : undefined,
                      { width: keyFieldWidth(a.id) },
                      {
                        borderColor: capturing === a.id ? colors.accent : colors.border,
                        backgroundColor: colors.surface,
                      },
                      Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined,
                    ]}
                  >
                    {bindings[a.id].map((k) => (
                      <Pressable
                        key={k}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('settings.shortcutsRemove')}: ${displayKey(k)}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          setKeys(
                            a.id,
                            bindings[a.id].filter((x) => x !== k),
                          );
                        }}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.combo,
                          {
                            borderColor: colors.border,
                            backgroundColor: pressed || hovered ? colors.hover : colors.bg,
                          },
                        ]}
                      >
                        {renderComboParts(k)}
                      </Pressable>
                    ))}
                    {capturing === a.id ? (
                      <View
                        pointerEvents="none"
                        style={[styles.captureSlot, { borderColor: colors.accent }]}
                      >
                        <AppText variant="caption" color={colors.accent}>
                          {t('settings.shortcutsPressShort')}
                        </AppText>
                      </View>
                    ) : (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.addSlot,
                          { borderColor: colors.border, backgroundColor: colors.bg },
                        ]}
                      >
                        <AppText variant="caption" muted style={styles.addHint}>
                          {t('settings.shortcutsAddShort')}
                        </AppText>
                      </View>
                    )}
                  </View>
                  <IconButton
                    icon="restore"
                    label={t('settings.shortcutsReset')}
                    onPress={() => reset(a.id)}
                    box={34}
                    size={18}
                  />
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
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 56,
  },
  labelBlock: { flex: 1, minWidth: 0, gap: SPACING.xs },
  label: { flex: 1, minWidth: 0 },
  keyField: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    minHeight: 42,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  emptyKeyField: { justifyContent: 'center' },
  fixedKeyField: { opacity: 0.65 },
  combo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 4,
    paddingVertical: 3,
    minHeight: 30,
  },
  fixedCombo: { backgroundColor: 'transparent' },
  keyCap: {
    minWidth: 18,
    minHeight: 22,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboPlus: { paddingHorizontal: 1 },
  addSlot: {
    minWidth: 52,
    minHeight: 30,
    paddingHorizontal: SPACING.xs,
    borderWidth: BORDER_WIDTH,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addHint: { textAlign: 'center' },
  captureSlot: {
    minHeight: 30,
    minWidth: 92,
    paddingHorizontal: SPACING.xs,
    borderWidth: BORDER_WIDTH,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMessage: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
