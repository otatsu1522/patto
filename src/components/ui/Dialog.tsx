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
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

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
  /** 旧呼び出し元との互換用。現在のダイアログはアニメーションなしで表示を切り替える。 */
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
}: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);
  const bodyScrollRef = useWebWheelScroll({
    enabled: visible && !fixedBody,
    touchScroll: visible && !fixedBody,
    touchAction: 'pan-y',
  });
  const { revealFocusedInput, onScroll } = useInputFocusScroller(
    bodyScrollRef,
    visible && !fixedBody,
  );
  const [keyboardState, setKeyboardState] = useState({
    visibleFor: visible,
    keyboardVisible: false,
    webKeyboardHeight: 0,
    webViewportTop: 0,
    webViewportHeight: 0,
  });
  // フォーカス状態とキーボードが実際に表示された状態を分離する。
  // KeyboardAvoidingView の behavior は表示中ずっと固定し、フォーカス時の後追いレイアウト変更を防ぐ。
  const dialogInputFocusedRef = useRef(false);
  const nativeKeyboardSessionRef = useRef(false);
  // Web では blur がキーボード閉じ始めより先に届くため、viewport が戻るまでセッションを保持する。
  const webKeyboardSessionRef = useRef(false);
  const webViewportBaselineHeightRef = useRef(
    typeof window !== 'undefined'
      ? Math.max(window.innerHeight, window.visualViewport?.height ?? 0)
      : 0,
  );

  const updateKeyboardState = useCallback(
    (
      nextKeyboardVisible: boolean,
      nextWebKeyboardHeight = 0,
      nextWebViewportTop = 0,
      nextWebViewportHeight = 0,
    ) => {
      setKeyboardState((previous) =>
        previous.visibleFor === visible &&
        previous.keyboardVisible === nextKeyboardVisible &&
        previous.webKeyboardHeight === nextWebKeyboardHeight &&
        previous.webViewportTop === nextWebViewportTop &&
        previous.webViewportHeight === nextWebViewportHeight
          ? previous
          : {
              visibleFor: visible,
              keyboardVisible: nextKeyboardVisible,
              webKeyboardHeight: nextWebKeyboardHeight,
              webViewportTop: nextWebViewportTop,
              webViewportHeight: nextWebViewportHeight,
            },
      );
    },
    [visible],
  );

  const handleDialogInputFocus = useCallback(
    (input?: TextInput | null) => {
      if (input === null || input === undefined) {
        dialogInputFocusedRef.current = false;
      } else if (Platform.OS === 'web') {
        // TextField はフォーカス時だけでなく、内容サイズ変化時にもこの通知を送る。
        // DOM 上の activeElement と照合し、サイズ変更をフォーカス開始と誤認しない。
        const node =
          typeof HTMLElement !== 'undefined' && input instanceof HTMLElement
            ? input
            : (input as unknown as { getNativeRef?: () => unknown }).getNativeRef?.();
        dialogInputFocusedRef.current =
          typeof document !== 'undefined' &&
          typeof HTMLElement !== 'undefined' &&
          node instanceof HTMLElement &&
          document.activeElement === node;
      } else {
        // ネイティブでも内容サイズ変更通知を受けるため、実際の入力フォーカスを確認する。
        dialogInputFocusedRef.current = input.isFocused();
      }
      revealFocusedInput(input);
    },
    [revealFocusedInput],
  );
  // Modalを閉じてから再表示するまでの間に残ったキーボード状態は、同じ描画に使わない。
  // レイアウトeffectより前のレンダーでも、開閉直後は中央配置の状態として扱う。
  const keyboardStateMatchesVisibility = keyboardState.visibleFor === visible;
  const keyboardVisible = keyboardStateMatchesVisibility && keyboardState.keyboardVisible;
  const webKeyboardViewportActive =
    Platform.OS === 'web' &&
    isTouchWeb &&
    keyboardStateMatchesVisibility &&
    keyboardVisible &&
    keyboardState.webViewportHeight > 0;
  const webViewportTop = webKeyboardViewportActive ? keyboardState.webViewportTop : 0;
  const webViewportHeight = webKeyboardViewportActive ? keyboardState.webViewportHeight : 0;
  const dialogTopPadding = insets.top + SPACING.lg;
  const webKeyboardMaxHeight = webKeyboardViewportActive
    ? Math.max(0, webViewportHeight - dialogTopPadding)
    : undefined;
  const wasVisibleRef = useRef(visible);
  const onDismissRef = useRef(onDismiss);

  // 開閉時に前回のキーボード寸法を次の表示へ持ち越さない。
  // layout effect で描画前に戻し、最初のフレームだけ位置が変わるちらつきを避ける。
  useLayoutEffect(() => {
    dialogInputFocusedRef.current = false;
    nativeKeyboardSessionRef.current = false;
    webKeyboardSessionRef.current = false;
    // 開くときは keyboardStateMatchesVisibility によって前回値を描画へ使わないため、
    // 表示開始直後に状態を更新して余計なレイアウト再計算を起こさない。
    if (visible) return;
    // 閉じた時点でだけ前回の状態を破棄し、次回表示へ持ち越さない。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 閉じる段階でキーボード寸法を同期リセットし、次回表示のちらつきを防ぐ。
    setKeyboardState((previous) =>
      previous.visibleFor === false &&
      !previous.keyboardVisible &&
      previous.webKeyboardHeight === 0 &&
      previous.webViewportTop === 0 &&
      previous.webViewportHeight === 0
        ? previous
        : {
            visibleFor: false,
            keyboardVisible: false,
            webKeyboardHeight: 0,
            webViewportTop: 0,
            webViewportHeight: 0,
          },
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
            dialogInputFocusedRef.current &&
            active instanceof HTMLElement &&
            active.matches('input, textarea, [contenteditable="true"]');
          const visibleBottom = viewport.offsetTop + viewport.height;
          if (focusedInput) {
            webViewportBaselineHeightRef.current = Math.max(
              webViewportBaselineHeightRef.current,
              window.innerHeight,
              visibleBottom,
            );
          } else if (!webKeyboardSessionRef.current) {
            // キーボードセッション終了後にだけ基準値を更新する。
            // blur が先行しても、閉じきる前に基準値を縮めない。
            webViewportBaselineHeightRef.current = Math.max(visibleBottom, window.innerHeight);
          }
          const measuredHeight = Math.max(0, webViewportBaselineHeightRef.current - visibleBottom);
          if (focusedInput && measuredHeight > UI_METRICS.keyboard.dialogVisibleHeightPx) {
            webKeyboardSessionRef.current = true;
          } else if (
            webKeyboardSessionRef.current &&
            measuredHeight <= UI_METRICS.keyboard.dialogHideTolerancePx
          ) {
            webKeyboardSessionRef.current = false;
          }
          const keyboardVisible = webKeyboardSessionRef.current;
          const webKeyboardHeight = keyboardVisible ? measuredHeight : 0;
          updateKeyboardState(
            keyboardVisible,
            webKeyboardHeight,
            viewport.offsetTop,
            viewport.height,
          );
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
      // iOS の WillHide はアニメーション開始時。キーボード状態だけを先に戻し、
      // 入力フォーカス自体は TextField の blur 通知に任せる。
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible, updateKeyboardState]);

  const handleShow = () => {
    // Web は現在の visualViewport とフォーカス状態から計測する。
    // ネイティブはこの Modal の keyboard show イベントから位置を更新し、前のModalの状態を使わない。
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const focusedInput =
        dialogInputFocusedRef.current &&
        active instanceof HTMLElement &&
        active.matches('input, textarea, [contenteditable="true"]');
      if (isTouchWeb && viewport && focusedInput) {
        const visibleBottom = viewport.offsetTop + viewport.height;
        webViewportBaselineHeightRef.current = Math.max(
          webViewportBaselineHeightRef.current,
          window.innerHeight,
          visibleBottom,
        );
        const keyboardHeight = Math.max(0, webViewportBaselineHeightRef.current - visibleBottom);
        const keyboardVisible = keyboardHeight > UI_METRICS.keyboard.dialogVisibleHeightPx;
        webKeyboardSessionRef.current = keyboardVisible;
        updateKeyboardState(
          keyboardVisible,
          keyboardVisible ? keyboardHeight : 0,
          viewport.offsetTop,
          viewport.height,
        );
      } else {
        webKeyboardSessionRef.current = false;
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

  const compact = mode === 'compact';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
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
            Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
          }
          style={[
            styles.dialogPositioner,
            {
              paddingTop: dialogTopPadding,
              paddingBottom: keyboardVisible ? 0 : insets.bottom + SPACING.lg,
              // モバイルWebでは VisualViewport 自体をダイアログの表示領域にする。
              // 画面全体の高さからキーボード分を二重に引かず、下端をキーボード上端へ合わせる。
              ...(webKeyboardViewportActive
                ? {
                    position: 'absolute' as const,
                    top: webViewportTop,
                    left: 0,
                    right: 0,
                    height: webViewportHeight,
                  }
                : undefined),
              // キーボード表示時は表示領域の最下端へ寄せ、下端に余白を作らない。
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
                borderColor: lineColor,
                borderWidth: lineWidth,
                // 作成・編集・検索・詳細など、すべてのダイアログ幅を大きい側へ統一する。
                maxWidth: compact
                  ? ('100%' as never)
                  : BOARD.dialogMaxWidth + UI_METRICS.dialog.standardExtraWidth,
                // キーボード表示中は VisualViewport 内に収め、本文のスクロール領域を潰さない。
                maxHeight: webKeyboardMaxHeight ?? UI_METRICS.dialog.maxHeightPercent,
                height: fixedBody
                  ? webKeyboardViewportActive
                    ? webKeyboardMaxHeight
                    : UI_METRICS.dialog.fixedBodyHeight
                  : undefined,
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
