import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
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
  const [keyboardState, setKeyboardState] = useState({
    visibleFor: visible,
    keyboardVisible: false,
    webKeyboardHeight: 0,
  });
  // 入力がフォーカスされた段階で KAV の振る舞いを準備しておき、
  // Keyboard show 後に behavior を切り替えてダイアログが後追いで跳ねるのを防ぐ。
  const [dialogInputFocused, setDialogInputFocused] = useState(false);
  const dialogInputFocusedRef = useRef(false);
  const nativeKeyboardSessionRef = useRef(false);

  const updateKeyboardState = useCallback(
    (nextKeyboardVisible: boolean, nextWebKeyboardHeight = 0) => {
      setKeyboardState((previous) =>
        previous.visibleFor === visible &&
        previous.keyboardVisible === nextKeyboardVisible &&
        previous.webKeyboardHeight === nextWebKeyboardHeight
          ? previous
          : {
              visibleFor: visible,
              keyboardVisible: nextKeyboardVisible,
              webKeyboardHeight: nextWebKeyboardHeight,
            },
      );
    },
    [visible],
  );

  const handleDialogInputFocus = useCallback(
    (input?: TextInput | null) => {
      if (input === null) {
        dialogInputFocusedRef.current = false;
        // キーボードが表示中なら、hide イベントまで KAV を有効のままにする。
        if (!nativeKeyboardSessionRef.current) setDialogInputFocused(false);
      } else if (input) {
        // フォーカスと、ソフトウェアキーボードが実際に表示された状態を分けて管理する。
        dialogInputFocusedRef.current = true;
        setDialogInputFocused(true);
      }
      revealFocusedInput(input);
    },
    [revealFocusedInput],
  );
  // Modalを閉じてから再表示するまでの間に残ったキーボード状態は、同じ描画に使わない。
  // レイアウトeffectより前のレンダーでも、開閉直後は中央配置の状態として扱う。
  const keyboardStateMatchesVisibility = keyboardState.visibleFor === visible;
  const keyboardVisible = keyboardStateMatchesVisibility && keyboardState.keyboardVisible;
  const webKeyboardHeight = keyboardStateMatchesVisibility ? keyboardState.webKeyboardHeight : 0;
  const wasVisibleRef = useRef(visible);
  const onDismissRef = useRef(onDismiss);

  // 開閉時に前回のキーボード寸法を次の表示へ持ち越さない。
  // layout effect で描画前に戻し、最初のフレームだけ位置が変わるちらつきを避ける。
  useLayoutEffect(() => {
    dialogInputFocusedRef.current = false;
    nativeKeyboardSessionRef.current = false;
    // 開くときは keyboardStateMatchesVisibility によって前回値を描画へ使わないため、
    // 表示開始直後に状態を更新して余計なレイアウト再計算を起こさない。
    if (visible) return;
    // 閉じたダイアログでは KAV の keyboard behavior も無効化する。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 非表示時に入力セッションを初期化する。
    setDialogInputFocused(false);
    // 閉じた時点でだけ前回の状態を破棄し、次回表示へ持ち越さない。
    setKeyboardState((previous) =>
      previous.visibleFor === false && !previous.keyboardVisible && previous.webKeyboardHeight === 0
        ? previous
        : { visibleFor: false, keyboardVisible: false, webKeyboardHeight: 0 },
    );
  }, [visible]);

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
    // 非表示のダイアログはキーボードを監視しない。前回値は layout effect で初期化する。
    if (!visible) return;

    if (Platform.OS === 'web') {
      if (!isTouchWeb || typeof window === 'undefined' || typeof document === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      let frame = 0;
      const update = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // ブラウザーのアドレスバーによる visualViewport の変化をキーボードと誤認しない。
          // 実際に入力要素へフォーカスがある場合に限り、表示領域の下端との差を採用する。
          const active = document.activeElement;
          const focusedInput =
            active instanceof HTMLElement &&
            active.matches('input, textarea, [contenteditable="true"]');
          const visibleBottom = viewport.offsetTop + viewport.height;
          const measuredHeight = Math.max(0, window.innerHeight - visibleBottom);
          const keyboardVisible =
            focusedInput && measuredHeight > UI_METRICS.keyboard.dialogVisibleHeightPx;
          const webKeyboardHeight = keyboardVisible ? measuredHeight : 0;
          updateKeyboardState(keyboardVisible, webKeyboardHeight);
        });
      };
      update();
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      document.addEventListener('focusin', update);
      document.addEventListener('focusout', update);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        document.removeEventListener('focusin', update);
        document.removeEventListener('focusout', update);
      };
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      // Keyboard イベントはアプリ全体へ届くため、入力欄を持たないダイアログでは無視する。
      // 直前の別ダイアログの遅延イベントで、非入力ダイアログの位置が動くのを防ぐ。
      // 実際にこのダイアログの入力欄がフォーカス中の場合に限って、
      // キーボード表示イベントを位置調整へ反映する。
      if (!dialogInputFocusedRef.current) return;
      nativeKeyboardSessionRef.current = true;
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      updateKeyboardState(true);
    });
    const hide = Keyboard.addListener(hideEvent, (event) => {
      // blur が Keyboard hide より先に届いても、表示済みセッションの終了だけは処理する。
      if (!nativeKeyboardSessionRef.current) return;
      nativeKeyboardSessionRef.current = false;
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      updateKeyboardState(false);
      // iOS の WillHide はアニメーション開始時。入力フォーカスを外すのは DidHide まで待ち、
      // キーボードがまだ表示中なのに KAV の behavior が解除される段差を防ぐ。
      if (Platform.OS !== 'ios' && !dialogInputFocusedRef.current) {
        setDialogInputFocused(false);
      }
    });
    const didHide =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardDidHide', () => {
            if (!dialogInputFocusedRef.current) setDialogInputFocused(false);
          })
        : null;
    return () => {
      show.remove();
      hide.remove();
      didHide?.remove();
    };
  }, [visible, updateKeyboardState]);

  const handleShow = () => {
    // Web は現在の visualViewport とフォーカス状態から計測する。
    // ネイティブはこの Modal の keyboard show イベントから位置を更新し、前のModalの状態を使わない。
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const focusedInput =
        active instanceof HTMLElement &&
        active.matches('input, textarea, [contenteditable="true"]');
      if (isTouchWeb && viewport && focusedInput) {
        const visibleBottom = viewport.offsetTop + viewport.height;
        const keyboardHeight = Math.max(0, window.innerHeight - visibleBottom);
        const keyboardVisible = keyboardHeight > UI_METRICS.keyboard.dialogVisibleHeightPx;
        updateKeyboardState(keyboardVisible, keyboardVisible ? keyboardHeight : 0);
      } else {
        updateKeyboardState(false);
      }
    }
    // ネイティブは onShow で位置を更新しない。
    // 現在のダイアログの入力欄がフォーカスされ、Keyboard show が届いたときだけ位置を調整する。
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
        {visible ? <SystemBars manageSystemUi={false} /> : null}
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
            !dialogInputFocused
              ? undefined
              : Platform.OS === 'ios'
                ? 'padding'
                : Platform.OS === 'android'
                  ? 'height'
                  : undefined
          }
          style={[
            styles.dialogPositioner,
            {
              paddingTop: insets.top + SPACING.lg,
              paddingBottom: keyboardVisible
                ? Platform.OS === 'web'
                  ? webKeyboardHeight
                  : 0
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
            <AuthInputFocusProvider value={handleDialogInputFocus}>
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
