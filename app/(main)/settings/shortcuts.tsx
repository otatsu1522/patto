import { Fragment, useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
import { Section, SwitchRow } from '@/components/ui/Rows';
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
  const keyCapsWidth = parts.reduce((width, part) => width + Math.max(18, part.length * 7 + 4), 0);
  // キー間の「+」表示・gap と、キー枠自体の左右 padding／border を含める。
  const modifierSeparatorsWidth = Math.max(0, parts.length - 1) * 12;
  return keyCapsWidth + modifierSeparatorsWidth + 10;
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
  const [shortcutRowWidth, setShortcutRowWidth] = useState(0);
  const [measuredComboWidths, setMeasuredComboWidths] = useState<Record<string, number>>({});
  const [measuredSlotWidths, setMeasuredSlotWidths] = useState({ add: 0, capture: 0 });

  // 設定画面が実際に表示されている間だけ、ボード側のショートカットを停止する。
  // Expo Router は前の画面をスタックに保持するため、mount/unmount ではなく focus/blur に同期する。
  useFocusEffect(
    useCallback(() => {
      useUiStore.getState().setShortcutsSuspended(true);
      return () => {
        setCapturing(null);
        useUiStore.getState().setShortcutsSuspended(false);
      };
    }, []),
  );

  // 入力待ち中にフォーム外の余白をクリックしたら待ち受けを解除する。
  useEffect(() => {
    if (!capturing || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const cancelCapture = () => setCapturing(null);
    document.addEventListener('pointerdown', cancelCapture, true);
    return () => document.removeEventListener('pointerdown', cancelCapture, true);
  }, [capturing]);

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

  const keyFieldLayout = (id: ActionId): { width: number; wrap: boolean } => {
    const keys = bindings[id];
    // 固定文字幅の推測ではなく、実際に描画されたキー枠／点線枠の幅を使う。
    // 推測値は初回レイアウトが終わるまでの仮値としてのみ使う。
    const keyWidths = keys.reduce(
      (total, key) => total + (measuredComboWidths[key] ?? estimatedComboWidth(key)),
      0,
    );
    const slotWidth =
      capturing === id ? measuredSlotWidths.capture || 72 : measuredSlotWidths.add || 42;
    const fieldChrome = BORDER_WIDTH * 2 + SPACING.sm * 2;
    // キー欄の後ろに「追加」枠が来る。gap は各キーと追加枠の間だけ必要。
    const desiredWidth = fieldChrome + keyWidths + keys.length * SPACING.xs + slotWidth;
    // 行幅からリセットボタン・余白・タイトル用の幅を差し引き、タイトルと重ならない最大幅を求める。
    const measuredMax = shortcutRowWidth - SPACING.md * 2 - 34 - SPACING.sm * 2 - 96;
    const fallbackMax = Math.max(70, Math.min(440, windowWidth * 0.6));
    const minimumWidth = fieldChrome + slotWidth;
    const maxWidth =
      shortcutRowWidth > 0
        ? Math.max(minimumWidth, measuredMax)
        : Math.max(minimumWidth, fallbackMax);
    return {
      width: Math.max(minimumWidth, Math.min(desiredWidth, maxWidth)),
      // 通常は1行。ラベル用の幅を確保できないほどキーが多い場合だけ折り返す。
      wrap: desiredWidth > maxWidth,
    };
  };

  const handleShortcutRowLayout = (width: number) => {
    setShortcutRowWidth((current) => (Math.abs(current - width) > 1 ? width : current));
  };

  const recordComboWidth = (key: string, width: number) => {
    if (!Number.isFinite(width) || width <= 0) return;
    setMeasuredComboWidths((current) =>
      Math.abs((current[key] ?? 0) - width) > 0.5 ? { ...current, [key]: width } : current,
    );
  };

  const recordSlotWidth = (kind: 'add' | 'capture', width: number) => {
    if (!Number.isFinite(width) || width <= 0) return;
    setMeasuredSlotWidths((current) =>
      Math.abs(current[kind] - width) > 0.5 ? { ...current, [kind]: width } : current,
    );
  };

  const separator = <View style={[styles.separator, { backgroundColor: colors.border }]} />;

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
            {separator}
            {SHORTCUT_ACTIONS.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? separator : null}
                <View
                  style={styles.row}
                  onLayout={(event) => handleShortcutRowLayout(event.nativeEvent.layout.width)}
                >
                  <AppText style={styles.label} numberOfLines={2}>
                    {t(a.labelKey)}
                  </AppText>
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
                      {
                        width: keyFieldLayout(a.id).width,
                        flexWrap: keyFieldLayout(a.id).wrap ? 'wrap' : 'nowrap',
                      },
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
                        onLayout={(event) => recordComboWidth(k, event.nativeEvent.layout.width)}
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
                        onLayout={(event) =>
                          recordSlotWidth('capture', event.nativeEvent.layout.width)
                        }
                        style={[styles.captureSlot, { borderColor: colors.accent }]}
                      >
                        <AppText variant="caption" color={colors.accent} numberOfLines={1}>
                          {t('settings.shortcutsPressShort')}
                        </AppText>
                      </View>
                    ) : (
                      <View
                        pointerEvents="none"
                        onLayout={(event) => recordSlotWidth('add', event.nativeEvent.layout.width)}
                        style={[
                          styles.addSlot,
                          { borderColor: colors.border, backgroundColor: colors.bg },
                        ]}
                      >
                        <AppText variant="caption" muted style={styles.addHint} numberOfLines={1}>
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
            variant="outline"
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
    minHeight: 60,
  },
  labelBlock: { flex: 1, minWidth: 0, gap: SPACING.xs },
  label: { flex: 1, minWidth: 0 },
  keyField: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    minHeight: 40,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
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
    flexShrink: 0,
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
    minWidth: 0,
    minHeight: 30,
    paddingHorizontal: SPACING.sm,
    borderWidth: BORDER_WIDTH,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addHint: { textAlign: 'center' },
  separator: { height: BORDER_WIDTH, alignSelf: 'stretch', flexShrink: 0 },
  captureSlot: {
    minHeight: 30,
    minWidth: 0,
    paddingHorizontal: SPACING.sm,
    borderWidth: BORDER_WIDTH,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowMessage: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
