import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
const activeDialogEscapeStack: string[] = [];

function getWebInputElement(input: TextInput | null): HTMLElement | null {
  if (!input || typeof HTMLElement === 'undefined') return null;
  const node =
    input instanceof HTMLElement
      ? input
      : (input as unknown as { getNativeRef?: () => unknown }).getNativeRef?.();
  return node instanceof HTMLElement ? node : null;
}

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
  /** キーボード表示中、ダイアログを利用可能な高さまで広げる。 */
  expandToKeyboard?: boolean;
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
  expandToKeyboard = false,
}: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const { mode } = useLayoutMode();
  const footerInBody =
    (mode === 'compact' || Platform.OS !== 'web' || isTouchWeb) && !fixedBody && !!footer;
  const push = useUiStore((s) => s.pushDialog);
  const pop = useUiStore((s) => s.popDialog);
  const dialogCount = useUiStore((s) => s.dialogCount);
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
  const dialogEscapeToken = useId();
  // onShow から入力欄へ自動フォーカスする間、native の Keyboard イベントが
  // TextInput の onFocus より先に届いても、キーボード表示状態を取りこぼさない。
  const dialogInputFocusRequestedRef = useRef(false);
  const nativeKeyboardSessionRef = useRef(false);
  const nativeShowFrameRef = useRef<number | null>(null);
  const dialogShowPaintFrameRef = useRef<number | null>(null);
  const positionStableFrameRef = useRef<number | null>(null);
  const positionerLayoutReadyRef = useRef(false);
  const positionReadyRef = useRef(false);
  const pendingShowFocusRef = useRef(false);
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
          // ダイアログを切り替えた際、キーボードが既に表示されていると
          // Keyboard show イベントが再発しない場合があるため、実状態も同期する。
          if (Platform.OS !== 'web' && Keyboard.isVisible()) {
            nativeKeyboardSessionRef.current = true;
            updateKeyboardState(true);
          }
        } else if (focusedDialogInputRef.current === input) {
          // フォーカス中の入力欄自身から非フォーカス通知を受けた場合だけ解除する。
          // 別の入力欄のサイズ変更通知で、現在のフォーカス状態を消さない。
          dialogInputFocusedRef.current = false;
          focusedDialogInputRef.current = null;
        }
      }
      revealFocusedInput(input);
    },
    [revealFocusedInput, updateKeyboardState],
  );

  const handleRequestClose = useCallback(() => {
    if (!dismissible) return;
    if (activeDialogEscapeStack[activeDialogEscapeStack.length - 1] !== dialogEscapeToken) {
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
  }, [dismissible, onClose, dialogEscapeToken]);
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
  const expandDialogForKeyboard =
    expandToKeyboard && keyboardVisible && (Platform.OS !== 'web' || webKeyboardViewportActive);
  const dialogTopPadding = insets.top + SPACING.lg;
  const webKeyboardMaxHeight = webKeyboardViewportActive
    ? Math.max(0, webViewportHeight - dialogTopPadding)
    : undefined;
  const wasVisibleRef = useRef(visible);
  const onDismissRef = useRef(onDismiss);
  // 表示状態が変わったレンダー中にセッションを更新し、古いレイアウトが表示される前に無効化する。
  // effect 内で setState する必要がなく、再表示時も前回の positionReady を使わない。
  const [dialogSessionState, setDialogSessionState] = useState(() => ({
    session: 0,
    visible,
  }));
  if (dialogSessionState.visible !== visible) {
    setDialogSessionState((previous) => ({
      session: previous.session + (visible ? 1 : 0),
      visible,
    }));
  }
  const dialogSession = dialogSessionState.session;
  const [positionReadySession, setPositionReadySession] = useState<number | null>(null);
  const wasVisibleForDialogSessionRef = useRef(false);
  const positionReady = visible && positionReadySession === dialogSession;

  useLayoutEffect(() => {
    if (visible && !wasVisibleForDialogSessionRef.current) {
      // KeyboardAvoidingView は前回表示時の frame を内部に保持する。
      // 開くたびに新しいレイアウト計算から始め、前回のキーボード寸法を持ち越さない。
      positionerLayoutReadyRef.current = false;
      positionReadyRef.current = false;
      if (positionStableFrameRef.current !== null) {
        cancelAnimationFrame(positionStableFrameRef.current);
        positionStableFrameRef.current = null;
      }
      if (nativeShowFrameRef.current !== null) {
        cancelAnimationFrame(nativeShowFrameRef.current);
        nativeShowFrameRef.current = null;
      }
      if (dialogShowPaintFrameRef.current !== null) {
        cancelAnimationFrame(dialogShowPaintFrameRef.current);
        dialogShowPaintFrameRef.current = null;
      }
      pendingShowFocusRef.current = false;
      dialogInputFocusRequestedRef.current = false;
    } else if (!visible) {
      positionerLayoutReadyRef.current = false;
      positionReadyRef.current = false;
      if (positionStableFrameRef.current !== null) {
        cancelAnimationFrame(positionStableFrameRef.current);
        positionStableFrameRef.current = null;
      }
      if (nativeShowFrameRef.current !== null) {
        cancelAnimationFrame(nativeShowFrameRef.current);
        nativeShowFrameRef.current = null;
      }
      if (dialogShowPaintFrameRef.current !== null) {
        cancelAnimationFrame(dialogShowPaintFrameRef.current);
        dialogShowPaintFrameRef.current = null;
      }
      pendingShowFocusRef.current = false;
      dialogInputFocusRequestedRef.current = false;
    }
    wasVisibleForDialogSessionRef.current = visible;
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
          // document.activeElement は背面の詳細ダイアログから開いた編集ダイアログの
          // 入力欄も指すため、このダイアログ自身がフォーカス管理している入力欄に限定する。
          const localInput = getWebInputElement(focusedDialogInputRef.current);
          const focusedInput =
            localInput !== null &&
            active === localInput &&
            active instanceof HTMLElement &&
            active.matches('input, textarea, [contenteditable="true"]');
          const visibleBottom = viewport.offsetTop + viewport.height;
          if (focusedInput) {
            webViewportBaselineHeightRef.current = Math.max(
              webViewportBaselineHeightRef.current,
              window.innerHeight,
              visibleBottom,
            );
          }
          const measuredHeight = Math.max(0, webViewportBaselineHeightRef.current - visibleBottom);
          if (focusedInput && measuredHeight > UI_METRICS.keyboard.dialogVisibleHeightPx) {
            webKeyboardSessionRef.current = true;
          } else if (
            webKeyboardSessionRef.current &&
            measuredHeight <=
              (focusedInput
                ? UI_METRICS.keyboard.dialogHideTolerancePx
                : UI_METRICS.keyboard.dialogVisibleHeightPx)
          ) {
            // フォーカスが外れ、キーボード相当の縮小がなくなったらセッションを終了する。
            // アドレスバー分の小さな viewport 差だけでキーボード表示を維持しない。
            webKeyboardSessionRef.current = false;
          }
          const keyboardVisible = webKeyboardSessionRef.current;
          // フォーカスがなく、キーボードも閉じていると判断できる時だけ基準値を更新する。
          // キーボードが開き始めた瞬間の縮小値を基準値として保存しない。
          if (
            !focusedInput &&
            !keyboardVisible &&
            measuredHeight <= UI_METRICS.keyboard.dialogVisibleHeightPx
          ) {
            webViewportBaselineHeightRef.current = Math.max(visibleBottom, window.innerHeight);
          }
          const webKeyboardHeight = keyboardVisible
            ? Math.max(0, webViewportBaselineHeightRef.current - visibleBottom)
            : 0;
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
    if (visible) return;
    if (nativeShowFrameRef.current !== null) {
      cancelAnimationFrame(nativeShowFrameRef.current);
      nativeShowFrameRef.current = null;
    }
    if (dialogShowPaintFrameRef.current !== null) {
      cancelAnimationFrame(dialogShowPaintFrameRef.current);
      dialogShowPaintFrameRef.current = null;
    }
    if (positionStableFrameRef.current !== null) {
      cancelAnimationFrame(positionStableFrameRef.current);
      positionStableFrameRef.current = null;
    }
    pendingShowFocusRef.current = false;
    dialogInputFocusRequestedRef.current = false;
  }, [visible]);

  const scheduleShowFocusAfterLayout = useCallback(() => {
    if (!visible || !onShow) {
      pendingShowFocusRef.current = false;
      return;
    }
    if (!positionerLayoutReadyRef.current || !positionReadyRef.current) {
      pendingShowFocusRef.current = true;
      return;
    }

    pendingShowFocusRef.current = false;
    if (nativeShowFrameRef.current !== null) {
      cancelAnimationFrame(nativeShowFrameRef.current);
    }
    if (dialogShowPaintFrameRef.current !== null) {
      cancelAnimationFrame(dialogShowPaintFrameRef.current);
    }

    // 1フレーム目で表示位置をレイアウト・描画させ、次のフレームで入力欄へフォーカスする。
    // これにより、モバイル Web でもキーボードを開く前に中央位置を表示できる。
    nativeShowFrameRef.current = requestAnimationFrame(() => {
      nativeShowFrameRef.current = null;
      dialogShowPaintFrameRef.current = requestAnimationFrame(() => {
        dialogShowPaintFrameRef.current = null;
        if (!wasVisibleForDialogSessionRef.current || !positionReadyRef.current) return;
        if (Platform.OS !== 'web') dialogInputFocusRequestedRef.current = true;
        onShow();
      });
    });
  }, [visible, onShow]);

  const handlePositionerLayout = useCallback(() => {
    positionerLayoutReadyRef.current = true;
    if (!visible || !wasVisibleForDialogSessionRef.current || positionReadyRef.current) return;

    // 表示直後の最初の layout 値は、Modal／キーボード回避ビューの初期化中に
    // 一時的な位置・高さである場合がある。2フレーム安定するまでカードを隠す。
    if (positionStableFrameRef.current !== null) {
      cancelAnimationFrame(positionStableFrameRef.current);
    }
    positionStableFrameRef.current = requestAnimationFrame(() => {
      positionStableFrameRef.current = requestAnimationFrame(() => {
        positionStableFrameRef.current = null;
        if (!wasVisibleForDialogSessionRef.current) return;
        positionReadyRef.current = true;
        setPositionReadySession(dialogSession);
        if (pendingShowFocusRef.current) scheduleShowFocusAfterLayout();
      });
    });
  }, [dialogSession, scheduleShowFocusAfterLayout, visible]);

  const handleShow = () => {
    // 現在の visualViewport とフォーカス状態から表示領域を計測する。
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const localInput = getWebInputElement(focusedDialogInputRef.current);
      const focusedInput =
        localInput !== null &&
        active === localInput &&
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

    if (onShow && (Platform.OS !== 'web' || isTouchWeb)) {
      // フォーカス予定だけでキーボード表示中のレイアウトへ先回りしない。
      // 最初のレイアウト完了後、中央位置が描画されてからフォーカスを要求する。
      pendingShowFocusRef.current = true;
      scheduleShowFocusAfterLayout();
      return;
    }
    onShow?.();
  };

  useLayoutEffect(() => {
    if (!visible) return;
    push();
    const token = dialogEscapeToken;
    activeDialogEscapeStack.push(token);
    return () => {
      const index = activeDialogEscapeStack.lastIndexOf(token);
      if (index >= 0) activeDialogEscapeStack.splice(index, 1);
      pop();
    };
  }, [visible, push, pop, dialogEscapeToken]);

  const compact = mode === 'compact';
  const isTopDialog =
    dialogCount > 0 &&
    activeDialogEscapeStack[activeDialogEscapeStack.length - 1] === dialogEscapeToken;
  return (
    <Modal
      key={Platform.OS === 'web' ? dialogSession : 'native-dialog'}
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleRequestClose}
      onShow={handleShow}
      onDismiss={finishDismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={[styles.modalRoot, { opacity: positionReady ? 1 : 0 }]}
        pointerEvents={positionReady ? 'auto' : 'none'}
      >
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
          key={dialogSession}
          enabled={isTopDialog}
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
              // ネイティブは KeyboardAvoidingView に位置調整を任せ、
              // Web は VisualViewport 内でキーボード上端へ配置する。
              justifyContent: webKeyboardViewportActive && keyboardVisible ? 'flex-end' : 'center',
            },
          ]}
          onLayout={handlePositionerLayout}
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
                ...(expandDialogForKeyboard && Platform.OS !== 'web' ? { flexGrow: 1 } : undefined),
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
                  style={[
                    styles.bodyScroll,
                    expandDialogForKeyboard ? styles.keyboardExpandedBodyScroll : undefined,
                  ]}
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
        {positionReady ? overlay : null}
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
  keyboardExpandedBodyScroll: { flexGrow: 1 },
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
