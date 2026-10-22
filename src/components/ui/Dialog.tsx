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
import { SystemBars } from './SystemBars';
import { getSystemBarInsets } from '@/lib/systemBarInsets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isTouchWeb } from '@/lib/hover';
import { AuthInputFocusProvider, useInputFocusScroller } from '../auth/AuthInputFocusContext';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';

// ESC は最前面のダイアログだけが処理する。ネストしたダイアログで親まで閉じないようにする。
let dialogEscapeSequence = 0;
const activeDialogEscapeStack: number[] = [];

interface Props {
  visible: boolean;
  title: ReactNode;
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
  /** 期限カレンダーなどの子ダイアログ表示中、親ダイアログのキーボード配置を維持する。 */
  preserveKeyboardLayout?: boolean;
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
  preserveKeyboardLayout = false,
}: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const footerInBody =
    (mode === 'compact' || Platform.OS !== 'web' || isTouchWeb) && !fixedBody && !!footer;
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
  const focusedDialogInputRef = useRef<TextInput | null>(null);
  const dialogEscapeTokenRef = useRef<number | null>(null);
  // onShow から入力欄へ自動フォーカスする間、native の Keyboard イベントが
  // TextInput の onFocus より先に届いても、キーボード表示状態を取りこぼさない。
  const dialogInputFocusRequestedRef = useRef(false);
  const nativeKeyboardSessionRef = useRef(false);
  const nativeShowFrameRef = useRef<number | null>(null);
  const preserveKeyboardLayoutRef = useRef(preserveKeyboardLayout);
  useLayoutEffect(() => {
    preserveKeyboardLayoutRef.current = preserveKeyboardLayout;
  }, [preserveKeyboardLayout]);
  const keyboardTrackingSuspendedRef = useRef(false);
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
        focusedDialogInputRef.current = null;
        dialogInputFocusRequestedRef.current = false;
      } else {
        let isFocused = false;
        if (Platform.OS === 'web') {
          // TextField はフォーカス時だけでなく、内容サイズ変化時にもこの通知を送る。
          // DOM 上の activeElement と照合し、サイズ変更をフォーカス開始と誤認しない。
          const node =
            typeof HTMLElement !== 'undefined' && input instanceof HTMLElement
              ? input
              : (input as unknown as { getNativeRef?: () => unknown }).getNativeRef?.();
          isFocused =
            typeof document !== 'undefined' &&
            typeof HTMLElement !== 'undefined' &&
            node instanceof HTMLElement &&
            document.activeElement === node;
        } else {
          // ネイティブでも内容サイズ変更通知を受けるため、実際の入力フォーカスを確認する。
          isFocused = input.isFocused();
        }

        if (isFocused) {
          dialogInputFocusedRef.current = true;
          focusedDialogInputRef.current = input;
          dialogInputFocusRequestedRef.current = false;
        } else if (focusedDialogInputRef.current === input) {
          // フォーカス中の入力欄自身から非フォーカス通知を受けた場合だけ解除する。
          // 別の入力欄のサイズ変更通知で、現在のフォーカス状態を消さない。
          dialogInputFocusedRef.current = false;
          focusedDialogInputRef.current = null;
        }
      }
      revealFocusedInput(input);
    },
    [revealFocusedInput],
  );

  const handleRequestClose = useCallback(() => {
    if (!dismissible) return;
    const token = dialogEscapeTokenRef.current;
    if (token !== null && activeDialogEscapeStack[activeDialogEscapeStack.length - 1] !== token) {
      return;
    }

    // 入力中の最初の ESC は入力欄からフォーカスを外すだけにし、ダイアログを閉じない。
    if (dialogInputFocusedRef.current || dialogInputFocusRequestedRef.current) {
      const focusedInput = focusedDialogInputRef.current;
      if (focusedInput) {
        focusedInput.blur();
      } else if (
        Platform.OS === 'web' &&
        typeof document !== 'undefined' &&
        typeof HTMLElement !== 'undefined' &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        document.activeElement.blur();
      } else {
        Keyboard.dismiss();
      }
      dialogInputFocusedRef.current = false;
      focusedDialogInputRef.current = null;
      dialogInputFocusRequestedRef.current = false;
      return;
    }

    onClose();
  }, [dismissible, onClose]);
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
  const [webModalSession, setWebModalSession] = useState(0);
  const wasVisibleForWebModalRef = useRef(false);

  useLayoutEffect(() => {
    if (Platform.OS === 'web' && visible && !wasVisibleForWebModalRef.current) {
      setWebModalSession((session) => session + 1);
    }
    wasVisibleForWebModalRef.current = visible;
  }, [visible]);

  // 開閉時に前回のキーボード寸法を次の表示へ持ち越さない。
  // layout effect で描画前に戻し、最初のフレームだけ位置が変わるちらつきを避ける。
  useLayoutEffect(() => {
    dialogInputFocusedRef.current = false;
    focusedDialogInputRef.current = null;
    dialogInputFocusRequestedRef.current = false;
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
    if (!visible) {
      keyboardTrackingSuspendedRef.current = false;
      return;
    }
    // 子ダイアログを開いている間は、親の keyboard state を維持して hide イベントを無視する。
    if (preserveKeyboardLayout) {
      keyboardTrackingSuspendedRef.current = true;
      return;
    }
    const resumedAfterChildDialog = keyboardTrackingSuspendedRef.current;
    keyboardTrackingSuspendedRef.current = false;

    if (Platform.OS === 'web') {
      if (!isTouchWeb || typeof window === 'undefined' || typeof document === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      let frame = 0;
      const update = () => {
        if (preserveKeyboardLayoutRef.current) return;
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (preserveKeyboardLayoutRef.current) return;
          // ブラウザーのアドレスバーによる visualViewport の変化をキーボードと誤認しない。
          // 実際に入力要素へフォーカスがある場合に限り、表示領域の下端との差を採用する。
          const active = document.activeElement;
          // フォーカス通知と DOM の activeElement の更新順は、別ダイアログから
          // 切り替えた直後にずれることがある。実際に入力要素が active なら検出する。
          const focusedInput =
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
    let pendingShowFrame: number | null = null;
    let resumeFrame: number | null = null;
    if (resumedAfterChildDialog) {
      // カレンダーを閉じた時点の実際のキーボード状態で親ダイアログを再同期する。
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = null;
        const keyboardVisible = Keyboard.isVisible();
        nativeKeyboardSessionRef.current = keyboardVisible;
        updateKeyboardState(keyboardVisible);
      });
    }
    const show = Keyboard.addListener(showEvent, (event) => {
      // 別ダイアログから切り替えた直後は、入力欄のフォーカス通知より
      // キーボード表示イベントが先に届くことがあるため、次フレームでも確認する。
      const applyShow = () => {
        pendingShowFrame = null;
        if (preserveKeyboardLayoutRef.current) return;
        // Keyboard イベントはアプリ全体へ届くため、入力欄を持たないダイアログでは無視する。
        // 自動フォーカス要求済みなら、onFocus 通知より先に届いた正当なイベントを受理する。
        if (!dialogInputFocusedRef.current && !dialogInputFocusRequestedRef.current) return;
        dialogInputFocusRequestedRef.current = false;
        nativeKeyboardSessionRef.current = true;
        if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
        updateKeyboardState(true);
      };
      if (dialogInputFocusedRef.current || dialogInputFocusRequestedRef.current) {
        applyShow();
      } else {
        if (pendingShowFrame !== null) cancelAnimationFrame(pendingShowFrame);
        pendingShowFrame = requestAnimationFrame(applyShow);
      }
    });
    const hide = Keyboard.addListener(hideEvent, (event) => {
      if (preserveKeyboardLayoutRef.current) return;
      // blur が Keyboard hide より先に届いても、表示済みセッションの終了だけは処理する。
      dialogInputFocusRequestedRef.current = false;
      if (!nativeKeyboardSessionRef.current) return;
      nativeKeyboardSessionRef.current = false;
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      updateKeyboardState(false);
      // iOS の WillHide はアニメーション開始時。キーボード状態だけを先に戻し、
      // 入力フォーカス自体は TextField の blur 通知に任せる。
    });
    return () => {
      if (pendingShowFrame !== null) cancelAnimationFrame(pendingShowFrame);
      if (resumeFrame !== null) cancelAnimationFrame(resumeFrame);
      show.remove();
      hide.remove();
    };
  }, [visible, preserveKeyboardLayout, updateKeyboardState]);

  useEffect(() => {
    if (visible || nativeShowFrameRef.current === null) return;
    cancelAnimationFrame(nativeShowFrameRef.current);
    nativeShowFrameRef.current = null;
    dialogInputFocusRequestedRef.current = false;
  }, [visible]);

  const handleShow = () => {
    // Web は現在の visualViewport とフォーカス状態から計測する。
    // ネイティブでは中央配置で1フレーム表示してから自動フォーカスする。
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const focusedInput =
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
    } else if (onShow) {
      // フォーカス予定だけでキーボード表示中のレイアウトへ先回りしない。
      // まず既定の中央位置で Modal を表示し、次フレームで入力欄へフォーカスする。
      // ダイアログが表示された後のキーボードによる移動は Keyboard イベントに任せる。
      if (nativeShowFrameRef.current !== null) {
        cancelAnimationFrame(nativeShowFrameRef.current);
      }
      nativeShowFrameRef.current = requestAnimationFrame(() => {
        nativeShowFrameRef.current = null;
        if (!visible) return;
        dialogInputFocusRequestedRef.current = true;
        onShow();
      });
      return;
    }
    onShow?.();
  };

  useLayoutEffect(() => {
    if (!visible) return;
    push();
    const token = ++dialogEscapeSequence;
    dialogEscapeTokenRef.current = token;
    activeDialogEscapeStack.push(token);
    return () => {
      const index = activeDialogEscapeStack.lastIndexOf(token);
      if (index >= 0) activeDialogEscapeStack.splice(index, 1);
      if (dialogEscapeTokenRef.current === token) dialogEscapeTokenRef.current = null;
      pop();
    };
  }, [visible, push, pop]);

  const compact = mode === 'compact';
  return (
    <Modal
      key={Platform.OS === 'web' ? webModalSession : 'native-dialog'}
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleRequestClose}
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
              // モバイルWebでは VisualViewport の実高さを使う。
              // window.innerHeight との差分から下端を計算すると、ブラウザーがウィンドウ高も
              // 変更する環境で位置がずれるため、高さを直接指定してキーボード上端へ合わせる。
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
          <View
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
                maxHeight:
                  webKeyboardMaxHeight ??
                  (keyboardVisible && Platform.OS !== 'web'
                    ? '100%'
                    : UI_METRICS.dialog.maxHeightPercent),
                height: webKeyboardViewportActive
                  ? webKeyboardMaxHeight
                  : fixedBody
                    ? UI_METRICS.dialog.fixedBodyHeight
                    : undefined,
              },
            ]}
          >
            <AuthInputFocusProvider value={handleDialogInputFocus}>
              <View style={styles.header}>
                <View style={styles.title}>
                  {typeof title === 'string' || typeof title === 'number' ? (
                    <AppText variant="title" numberOfLines={UI_METRICS.text.singleLineMax}>
                      {title}
                    </AppText>
                  ) : (
                    title
                  )}
                </View>
                {dismissible ? (
                  <IconButton icon="close" label={t('common.close')} onPress={onClose} />
                ) : (
                  <View style={styles.headerActionPlaceholder} />
                )}
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
                  {footerInBody ? <View style={styles.mobileFooter}>{footer}</View> : null}
                </ScrollView>
              )}
              {footer && !footerInBody ? <View style={styles.footer}>{footer}</View> : null}
            </AuthInputFocusProvider>
          </View>
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
  headerActionPlaceholder: { width: BOARD.touchTarget, height: BOARD.touchTarget },
  bodyScroll: { flexShrink: 1, minHeight: 0 },
  body: { padding: SPACING.lg, gap: SPACING.md },
  fixedBodyScroll: { flex: 1 },
  fixedBodyContent: { flex: 1 },
  footer: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  mobileFooter: {
    marginHorizontal: -SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
});
