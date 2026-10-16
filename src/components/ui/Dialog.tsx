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
import { BOARD, UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { LAYER, RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
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
  /** ダイアログの本文全体はスクロールさせず、子要素内の一覧だけをスクロールさせる。 */
  fixedBody?: boolean;
  /** false の場合、背景タップ・戻る操作・×ボタンで閉じられない */
  dismissible?: boolean;
  /** ダイアログが表示された直後に呼び出す。入力欄の自動フォーカスなどに使用する。 */
  onShow?: () => void;
  /** Modal の終了イベント後に呼び出す（次のダイアログを競合せず開く用途）。 */
  onDismiss?: () => void;
  /** 次のダイアログへ即時に切り替える際、閉じるアニメーションを省略する。 */
  dismissImmediately?: boolean;
}

/** ダイアログ。キーボードがないときは画面中央、入力中はキーボードの上の表示領域内に配置する。 */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  footer,
  overlay,
  fixedBody = false,
  dismissible = true,
  onShow,
  onDismiss,
  dismissImmediately = false,
}: Props) {
  const { colors } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);
  const bodyScrollRef = useRef<ScrollView>(null);
  const { revealFocusedInput, onScroll } = useInputFocusScroller(bodyScrollRef, visible);
  const [{ keyboardVisible, webKeyboardHeight }, setKeyboardState] = useState({
    keyboardVisible: false,
    webKeyboardHeight: 0,
  });
  const wasVisibleRef = useRef(visible);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const finishDismiss = () => {
    if (!wasVisibleRef.current) return;
    wasVisibleRef.current = false;
    onDismissRef.current?.();
  };

  useEffect(() => {
    if (visible) {
      wasVisibleRef.current = true;
      return;
    }
    if (!onDismissRef.current || Platform.OS === 'ios' || !wasVisibleRef.current) return;
    wasVisibleRef.current = false;
    // Android / Web では終了イベントが共通していないため、終了アニメーションを使わず、
    // Modal の非表示が反映された次フレームで通知する。固定時間には依存しない。
    const frame = requestAnimationFrame(() => onDismissRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    // 非表示のダイアログがキーボード状態を保持しないよう、表示中だけ監視する。
    if (!visible) {
      const frame = requestAnimationFrame(() => {
        setKeyboardState((previous) =>
          previous.keyboardVisible || previous.webKeyboardHeight > 0
            ? { keyboardVisible: false, webKeyboardHeight: 0 }
            : previous,
        );
      });
      return () => cancelAnimationFrame(frame);
    }

    if (Platform.OS === 'web') {
      if (!isTouchWeb || typeof window === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      let frame = 0;
      const update = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // visual viewport の下端からレイアウトビューポート下端までの差を使う。
          // offsetTop を含め、入力欄へスクロールした状態でも実際の下端に合わせる。
          const visibleBottom = viewport.offsetTop + viewport.height;
          const measuredHeight = Math.max(0, window.innerHeight - visibleBottom);
          const keyboardVisible = measuredHeight > UI_METRICS.keyboard.dialogVisibleHeightPx;
          // キーボード未検出時は余白も位置調整も入れず、アドレスバーの変化で動かさない。
          const webKeyboardHeight = keyboardVisible ? measuredHeight : 0;
          setKeyboardState((previous) =>
            previous.keyboardVisible === keyboardVisible &&
            previous.webKeyboardHeight === webKeyboardHeight
              ? previous
              : { keyboardVisible, webKeyboardHeight },
          );
        });
      };
      update();
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      };
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      setKeyboardState({ keyboardVisible: true, webKeyboardHeight: 0 });
    });
    const hide = Keyboard.addListener(hideEvent, (event) => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      setKeyboardState({ keyboardVisible: false, webKeyboardHeight: 0 });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  const handleShow = () => {
    // 以前の表示の状態を持ち越さず、既に開いているキーボードはその場で認識する。
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
      if (isTouchWeb && viewport) {
        const visibleBottom = viewport.offsetTop + viewport.height;
        const keyboardHeight = Math.max(0, window.innerHeight - visibleBottom);
        const keyboardVisible = keyboardHeight > UI_METRICS.keyboard.dialogVisibleHeightPx;
        setKeyboardState({
          keyboardVisible,
          webKeyboardHeight: keyboardVisible ? keyboardHeight : 0,
        });
      } else {
        setKeyboardState({ keyboardVisible: false, webKeyboardHeight: 0 });
      }
    } else {
      setKeyboardState({ keyboardVisible: Keyboard.isVisible(), webKeyboardHeight: 0 });
    }
    onShow?.();
  };

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
      animationType={dismissImmediately || (onDismiss && Platform.OS !== 'ios') ? 'none' : 'fade'}
      onRequestClose={dismissible ? onClose : () => {}}
      onShow={handleShow}
      onDismiss={finishDismiss}
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
              // キーボード表示時は表示領域の最下端へ寄せ、ダイアログ下端と
              // キーボード上端の間に余白を作らない。
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
                // 作成・編集・検索・詳細など、すべてのダイアログ幅を大きい側へ統一する。
                maxWidth: compact
                  ? ('100%' as never)
                  : BOARD.dialogMaxWidth + UI_METRICS.dialog.standardExtraWidth,
                // 固定本文の高さはキーボード状態で切り替えず、表示領域の maxHeight に任せる。
                height: fixedBody ? UI_METRICS.dialog.fixedBodyHeight : undefined,
              },
            ]}
          >
            <AuthInputFocusProvider value={revealFocusedInput}>
              <View style={styles.header}>
                <AppText
                  variant="title"
                  style={styles.title}
                  numberOfLines={UI_METRICS.text.singleLineMax}
                >
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
                  scrollEventThrottle={TIMING.scrollEventThrottleMs}
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
  backdropLayer: { zIndex: LAYER.base },
  dialogPositioner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    width: '100%',
    position: 'relative',
    maxHeight: UI_METRICS.dialog.maxHeightPercent,
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
