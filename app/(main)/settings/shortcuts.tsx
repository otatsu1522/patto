import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Divider, Section, SwitchRow } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { IconButton } from '@/components/ui/IconButton';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { SHORTCUT_ACTIONS, displayKey, findConflict, isModifierOnly, keyToString, resolveBindings, type ActionId } from '@/shortcuts/actions';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { BORDER_WIDTH } from '@/theme/tokens';

/** キーボードショートカットの確認・変更（Web版）。 */
export default function ShortcutSettings() {
  const { colors } = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const bindings = resolveBindings(settings.shortcutOverrides);
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // キー入力の待ち受け中は、ほかのショートカットが反応しないようダイアログ扱いにする
  useEffect(() => {
    if (!capturing || Platform.OS !== 'web') return;
    useUiStore.getState().pushDialog();
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
        setMessage(t('settings.shortcutsConflict', { key: displayKey(key), action: t(label) }));
      } else if (!bindings[capturing].includes(key)) {
        update({ shortcutOverrides: { ...settings.shortcutOverrides, [capturing]: [...bindings[capturing], key] } });
        setMessage(null);
      }
      setCapturing(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      useUiStore.getState().popDialog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const setKeys = (id: ActionId, keys: string[]) => update({ shortcutOverrides: { ...settings.shortcutOverrides, [id]: keys } });
  const reset = (id: ActionId) => {
    const next = { ...settings.shortcutOverrides };
    delete next[id];
    update({ shortcutOverrides: next });
  };

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.shortcuts')} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          {Platform.OS !== 'web' ? <AppText muted>{t('settings.shortcutsWebOnly')}</AppText> : null}
          <Section>
            <SwitchRow label={t('settings.shortcutsEnabled')} value={settings.shortcutsEnabled} onChange={(v) => update({ shortcutsEnabled: v })} />
          </Section>
          {message ? (
            <AppText variant="caption" color={colors.danger}>
              {message}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {t('settings.shortcutsFixed')}
          </AppText>
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
                        onPress={() => setKeys(a.id, bindings[a.id].filter((x) => x !== k))}
                        style={[styles.key, { borderColor: colors.border, backgroundColor: colors.hover }]}
                      >
                        <AppText variant="caption" bold>
                          {displayKey(k)}
                        </AppText>
                      </Pressable>
                    ))}
                    <IconButton icon="add" label={t('settings.shortcutsAdd')} onPress={() => { setMessage(null); setCapturing(a.id); }} box={34} size={18} />
                    <IconButton icon="restore" label={t('settings.shortcutsReset')} onPress={() => reset(a.id)} box={34} size={18} />
                  </View>
                </View>
                {capturing === a.id ? (
                  <AppText variant="caption" color={colors.primary} style={styles.capture}>
                    {t('settings.shortcutsPress')}
                  </AppText>
                ) : null}
              </View>
            ))}
          </Section>
          <Button label={t('settings.shortcutsResetAll')} variant="secondary" onPress={() => update({ shortcutOverrides: {} })} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: SPACING.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs, minHeight: 52 },
  label: { flex: 1 },
  keys: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '55%' },
  key: { minWidth: 30, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm, borderWidth: BORDER_WIDTH, alignItems: 'center' },
  capture: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
