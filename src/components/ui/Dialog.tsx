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
import { AuthInputFocusProvider, useInputFocusScroller } from '../auth/AuthInputFocusContext';

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
  /** ダイアログの本文全体はスクロールさせず、子要素内の一覧だけをスクロールさせる。 */
  fixedBody?: boolean;
  /** false の場合、背景タップ・戻る操作・×ボタンで閉じられない */
  dismissible?: boolean;
  /** ダイアログが表示された直後に呼び出す。入力欄の自動フォーカスなどに使用する。 */
  onShow?: () => void;
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
  fixedBody = false,
  dismissible = true,
  onShow,
}: Props) {
  const { colors } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);
  const bodyScrollRef = useRef<ScrollView>(null);
  const { revealFocusedInput, onScroll } = useInputFocusScroller(bodyScrollRef, visible);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [webKeyboardHeight, setWebKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (!isTouchWeb || !window.visualViewport) return;
      const viewport = window.visualViewport;
      const update = () => {
        const visibleBottom = viewport.offsetTop + viewport.height;
        const keyboardHeight = Math.max(0, window.innerHeight - visibleBottom);
        setWebKeyboardHeight(keyboardHeight);
        setKeyboardVisible(keyboardHeight > 120);
      };
      update();
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      return () => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      };
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
      onShow={onShow}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.modalRoot}>
        <SystemBars />
        {/* 背景は全画面に固定する。キーボード表示時もメニューや画面本体を移動させない。 */}
        <Pressable
          style={[
            StyleSheet.absoluteFill,
            styles.backdropLayer,
            { backgroundColor: colors.overlay },
          ]}
          onPress={dismissible ? onClose : undefined}
          accessibilityLabel={t('common.close')}
        />
        {/* キーボード回避はダイアログ本体の位置決めだけに適用する。 */}
        <KeyboardAvoidingView
          behavior={
            Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
          }
          style={[
            styles.dialogPositioner,
            {
              paddingTop: insets.top + SPACING.lg,
              paddingBottom:
                Platform.OS === 'web' && webKeyboardHeight > 0
                  ? webKeyboardHeight
                  : keyboardVisible && Platform.OS !== 'web'
                    ? 0
                    : insets.bottom + SPACING.lg,
              justifyContent: keyboardVisible ? 'flex-end' : 'center',
            },
          ]}
          pointerEvents="box-none"
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
                height: fixedBody ? (keyboardVisible ? '72%' : '82%') : undefined,
              },
            ]}
          >
            <AuthInputFocusProvider value={revealFocusedInput}>
              <View style={styles.header}>
                <AppText variant="title" style={styles.title} numberOfLines={1}>
                  {title}
                </AppText>
                {dismissible ? (
                  <IconButton icon="close" label={t('common.close')} onPress={onClose} />
                ) : null}
              </View>
              {fixedBody ? (
                <View style={[styles.bodyScroll, styles.fixedBodyScroll]}>
                  <View style={[styles.body, styles.fixedBodyContent]}>{children}</View>
                </View>
              ) : (
                <ScrollView
                  ref={bodyScrollRef}
                  style={styles.bodyScroll}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.body}
                  onScroll={onScroll}
                  scrollEventThrottle={16}
                  automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                >
                  {children}
                </ScrollView>
              )}
              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </AuthInputFocusProvider>
          </Pressable>
        </KeyboardAvoidingView>
        {overlay}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  backdropLayer: { zIndex: 0 },
  dialogPositioner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
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
  fixedBodyScroll: { flex: 1 },
  fixedBodyContent: { flex: 1 },
  footer: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
});
