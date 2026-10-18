import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/i18n';
import { UI_METRICS } from '@/config/layout';
import { LAYER, RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { getSystemBarInsets } from '@/lib/systemBarInsets';

interface Props {
  visible: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

/**
 * 未保存変更の確認。親の Dialog 内で重ねて表示し、
 * 二重の Native Modal とアニメーションが重ならないようにする。
 */
export function DiscardChangesOverlay({ visible, onDiscard, onKeepEditing }: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());

  if (!visible) return null;

  // 親 Dialog の Modal の中で覆い、二つのネイティブ Modal の fade や
  // SystemBars 初期化が同時に走ることによるちらつきを避ける。
  return (
    <View style={styles.cover}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        onPress={onKeepEditing}
        accessibilityLabel={t('common.cancel')}
      />
      <View
        style={[
          styles.dialogArea,
          { paddingTop: insets.top + SPACING.lg, paddingBottom: insets.bottom + SPACING.lg },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: lineColor, borderWidth: lineWidth },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <AppText variant="title">{t('task.discardTitle')}</AppText>
          <AppText muted>{t('task.discardMessage')}</AppText>
          <View style={styles.actions}>
            <Button label={t('task.keepEditing')} variant="secondary" onPress={onKeepEditing} />
            <Button label={t('task.discard')} variant="outlineDanger" onPress={onDiscard} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: LAYER.dragPreview,
    elevation: SHADOW.float.elevation + 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  dialogArea: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: UI_METRICS.dialog.contentMaxWidth,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
});
