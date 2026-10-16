import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { SHORTCUT_ACTIONS, displayKeyParts, resolveBindings } from '@/shortcuts/actions';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { RADIUS, SPACING, useTheme, OPACITY } from '@/theme';
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
  const renderCombo = (shortcut: string) => (
    <View
      key={shortcut}
      style={[styles.combo, { borderColor: colors.border, backgroundColor: colors.hover }]}
    >
      {displayKeyParts(shortcut).map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? (
            <AppText variant="caption" muted style={styles.plus}>
              {t('shortcut.comboPlus')}
            </AppText>
          ) : null}
          <View style={styles.keyCap}>
            <AppText variant="caption" bold>
              {part}
            </AppText>
          </View>
        </Fragment>
      ))}
    </View>
  );

  return (
    <Dialog visible={open} title={t('settings.shortcuts')} onClose={() => setOpen(false)}>
      <View style={styles.row}>
        <View style={styles.labelBlock}>
          <AppText style={styles.label}>{t('settings.shortcutsEscape')}</AppText>
          <AppText variant="caption" muted>
            {t('settings.shortcutsEscapeHint')}
          </AppText>
        </View>
        <View
          style={[styles.keyField, styles.fixedField, { borderColor: colors.border }]}
          pointerEvents="none"
        >
          <View style={[styles.combo, { borderColor: colors.divider, backgroundColor: colors.bg }]}>
            <View style={styles.keyCap}>
              <AppText variant="caption" bold>
                {t('shortcut.keyEscape')}
              </AppText>
            </View>
          </View>
        </View>
      </View>
      {SHORTCUT_ACTIONS.map((a) => (
        <View key={a.id} style={styles.row}>
          <AppText style={styles.label}>{t(a.labelKey)}</AppText>
          <View style={styles.keys}>{bindings[a.id].map(renderCombo)}</View>
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  labelBlock: { flex: 1, minWidth: 0, gap: SPACING.xs },
  label: { flex: 1, minWidth: 0 },
  keys: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  keyField: {
    flex: 1,
    minWidth: 0,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.md,
    padding: SPACING.xs,
    flexDirection: 'row',
  },
  fixedField: { opacity: OPACITY.muted },
  combo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: UI_METRICS.shortcuts.comboGap,
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.sm,
    paddingHorizontal: UI_METRICS.shortcuts.comboPaddingHorizontal,
    paddingVertical: UI_METRICS.shortcuts.comboPaddingVertical,
    minHeight: UI_METRICS.shortcuts.comboMinHeight,
  },
  keyCap: {
    minWidth: UI_METRICS.shortcuts.helpKeyCapMinWidth,
    minHeight: UI_METRICS.shortcuts.keyCapMinHeight,
    paddingHorizontal: UI_METRICS.shortcuts.comboPaddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { paddingHorizontal: UI_METRICS.shortcuts.comboPlusPaddingHorizontal },
});
