import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { useLayoutMode } from '@/hooks/useLayout';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { BORDER_WIDTH } from '@/theme/tokens';
import { SystemBars } from './SystemBars';
import { getSystemBarInsets } from '@/lib/systemBarInsets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isTouchWeb } from '@/lib/hover';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** フォームより前面に重ねる確認 UI */
  overlay?: ReactNode;
  /** 幅を広げたいとき（一覧表示など） */
  wide?: boolean;
  /** false の場合、背景タップ・戻る操作・×ボタンで閉じられない */
  dismissible?: boolean;
}

/** ダイアログ。キーボードがないときは画面中央、入力中はキーボードの上の表示領域内に配置する。 */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  footer,
  overlay,
  wide,
  dismissible = true,
}: Props) {
  const { colors } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);
  const bodyScrollRef = useRef<ScrollView>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (!isTouchWeb || !window.visualViewport) return;
      const viewport = window.visualViewport;
      const update = () => setKeyboardVisible(window.innerHeight - viewport.height > 120);
      update();
      viewport.addEventListener('resize', update);
      return () => viewport.removeEventListener('resize', update);
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    push();
    return pop;
  }, [visible, push, pop]);

  // Web ではフォームやカラーピッカー上でホイールイベントが内側の要素に留まり、
  // ダイアログ本文がスクロールしない場合がある。スクロール要素で捕捉して本文を直接動かす。
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const scrollable = (
      bodyScrollRef.current as unknown as { getScrollableNode?: () => unknown } | null
    )?.getScrollableNode?.();
    const node = scrollable as HTMLElement | null;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      const maxScrollTop = node.scrollHeight - node.clientHeight;
      if (maxScrollTop <= 0) return;
      const next = Math.max(0, Math.min(maxScrollTop, node.scrollTop + event.deltaY));
      if (next === node.scrollTop) return;
      event.preventDefault();
      node.scrollTop = next;
    };

    node.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => node.removeEventListener('wheel', onWheel, true);
  }, [visible]);

  const compact = mode === 'compact';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissible ? onClose : () => {}}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.modalRoot}>
        <SystemBars />
        <KeyboardAvoidingView
          behavior={
            Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
          }
          style={styles.fill}
        >
          <Pressable
            style={[
              styles.backdrop,
              {
                backgroundColor: colors.overlay,
                top: 0,
                bottom: 0,
                paddingTop: insets.top + SPACING.lg,
                paddingBottom: keyboardVisible ? SPACING.md : insets.bottom + SPACING.lg,
              },
            ]}
            onPress={dismissible ? onClose : undefined}
            accessibilityLabel={t('common.close')}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.card,
                SHADOW.float,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  maxWidth: compact
                    ? ('100%' as never)
                    : wide
                      ? BOARD.dialogMaxWidth + 160
                      : BOARD.dialogMaxWidth,
                },
              ]}
            >
              <View style={styles.header}>
                <AppText variant="title" style={styles.title} numberOfLines={1}>
                  {title}
                </AppText>
                {dismissible ? (
                  <IconButton icon="close" label={t('common.close')} onPress={onClose} />
                ) : null}
              </View>
              <ScrollView
                ref={bodyScrollRef}
                style={styles.bodyScroll}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.body}
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              >
                {children}
              </ScrollView>
              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </Pressable>
          </Pressable>
          {overlay}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  modalRoot: { flex: 1 },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    position: 'relative',
    maxHeight: '90%',
    borderRadius: RADIUS.lg,
    borderWidth: BORDER_WIDTH,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.sm,
    paddingTop: SPACING.sm,
  },
  title: { flex: 1 },
  bodyScroll: { flexShrink: 1, minHeight: 0 },
  body: { padding: SPACING.lg, gap: SPACING.md },
  footer: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
});
