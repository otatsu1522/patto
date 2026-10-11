import { useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { useLayoutMode } from '@/hooks/useLayout';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 幅を広げたいとき（一覧表示など） */
  wide?: boolean;
}

/** ダイアログ。PCは中央のカード、スマホは下から出るシートとして表示する。 */
export function Dialog({ visible, title, onClose, children, footer, wide }: Props) {
  const { colors } = useTheme();
  const { mode } = useLayoutMode();
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);

  useEffect(() => {
    if (!visible) return;
    push();
    return pop;
  }, [visible, push, pop]);

  const sheet = mode === 'compact';
  return (
    <Modal visible={visible} transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }, sheet && styles.bottom]} onPress={onClose} accessibilityLabel={t('common.close')}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.card,
              SHADOW.float,
              { backgroundColor: colors.surface, borderColor: colors.border, maxWidth: wide ? BOARD.dialogMaxWidth + 160 : BOARD.dialogMaxWidth },
              sheet && styles.sheet,
            ]}
          >
            <View style={styles.header}>
              <AppText variant="title" style={styles.title} numberOfLines={1}>
                {title}
              </AppText>
              <IconButton icon="close" label={t('common.close')} onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  bottom: { justifyContent: 'flex-end', padding: 0 },
  card: { width: '100%', maxHeight: '90%', borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxWidth: '100%' as never },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: SPACING.lg, paddingRight: SPACING.sm, paddingTop: SPACING.sm },
  title: { flex: 1 },
  body: { padding: SPACING.lg, gap: SPACING.md },
  footer: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
});
