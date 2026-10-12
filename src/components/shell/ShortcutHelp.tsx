import { StyleSheet, View } from 'react-native';
import { t } from '@/i18n';
import { SHORTCUT_ACTIONS, displayKey, resolveBindings } from '@/shortcuts/actions';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Dialog } from '../ui/Dialog';
import { BORDER_WIDTH } from '@/theme/tokens';

/** ショートカット一覧（? キーで表示）。 */
export function ShortcutHelp() {
  const { colors } = useTheme();
  const open = useUiStore((s) => s.helpOpen);
  const setOpen = useUiStore((s) => s.setHelpOpen);
  const overrides = useSettingsStore((s) => s.settings.shortcutOverrides);
  const bindings = resolveBindings(overrides);
  return (
    <Dialog visible={open} title={t('settings.shortcuts')} onClose={() => setOpen(false)} wide>
      {SHORTCUT_ACTIONS.map((a) => (
        <View key={a.id} style={styles.row}>
          <AppText style={styles.label}>{t(a.labelKey)}</AppText>
          <View style={styles.keys}>
            {bindings[a.id].map((k) => (
              <View key={k} style={[styles.key, { borderColor: colors.border, backgroundColor: colors.hover }]}>
                <AppText variant="caption" bold>
                  {displayKey(k)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  label: { flex: 1 },
  keys: { flexDirection: 'row', gap: SPACING.xs },
  key: { minWidth: 28, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.sm, borderWidth: BORDER_WIDTH, alignItems: 'center' },
});
