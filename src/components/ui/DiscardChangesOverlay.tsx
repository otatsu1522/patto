import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/i18n';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { SystemBars } from './SystemBars';
import { getSystemBarInsets } from '@/lib/systemBarInsets';

interface Props {
  visible: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

/**
 * 未保存変更の確認。編集ダイアログとは別の Modal として表示し、
 * スマホでも背後のフォームを操作できないよう、画面全体を覆う。
 */
export function DiscardChangesOverlay({ visible, onDiscard, onKeepEditing }: Props) {
  const { colors } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onKeepEditing}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.cover}>
        <SystemBars />
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
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <AppText variant="title">{t('task.discardTitle')}</AppText>
            <AppText muted>{t('task.discardMessage')}</AppText>
            <View style={styles.actions}>
              <Button label={t('task.keepEditing')} variant="secondary" onPress={onKeepEditing} />
              <Button label={t('task.discard')} variant="danger" onPress={onDiscard} />
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cover: { flex: 1, alignItems: 'stretch', justifyContent: 'center' },
  dialogArea: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
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
