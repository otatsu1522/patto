import { createContext, useCallback, useContext, useEffect, useRef, type RefObject } from 'react';
import {
  Keyboard,
  Platform,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type TextInput,
} from 'react-native';

export type AuthInputFocusHandler = (input?: TextInput | null) => void;

const AuthInputFocusContext = createContext<AuthInputFocusHandler | null>(null);

export const AuthInputFocusProvider = AuthInputFocusContext.Provider;
export const useAuthInputFocus = () => useContext(AuthInputFocusContext);

/**
 * フォーカス中の入力欄を、キーボードを除いた表示領域へスクロールする。
 * 認証画面・設定フォーム・ダイアログで共通利用し、Web の visual viewport と
 * ネイティブの Keyboard イベントの両方を扱う。
 */
export function useInputFocusScroller(scrollRef: RefObject<ScrollView | null>, enabled = true) {
  const { height } = useWindowDimensions();
  const scrollY = useRef(0);
  const focusedInput = useRef<TextInput | null>(null);
  const keyboardTop = useRef<number | null>(null);

  const revealFocusedInput = useCallback(
    (input?: TextInput | null) => {
      if (input === null) {
        focusedInput.current = null;
        return;
      }
      if (input) focusedInput.current = input;
      const target = focusedInput.current;
      if (!enabled || !target) return;

      // キーボードによるレイアウト変更を待ってから、実際の入力欄の位置を測定する。
      requestAnimationFrame(() => {
        if (focusedInput.current !== target) return;
        requestAnimationFrame(() => {
          if (focusedInput.current !== target) return;
          target.measureInWindow((_x, y, _width, inputHeight) => {
            let visibleTop = 0;
            let visibleBottom = height;
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
              const viewport = window.visualViewport;
              if (viewport) {
                visibleTop = viewport.offsetTop;
                visibleBottom = visibleTop + viewport.height;
              } else {
                visibleBottom = window.innerHeight;
              }
            } else if (keyboardTop.current !== null) {
              // Android の resize と iOS の overlay のどちらでも、使える方の下端を採用する。
              visibleBottom = Math.min(visibleBottom, keyboardTop.current);
            }

            const margin = 16;
            let delta = 0;
            if (y + inputHeight > visibleBottom - margin) {
              delta = y + inputHeight - (visibleBottom - margin);
            } else if (y < visibleTop + margin) {
              delta = y - (visibleTop + margin);
            }
            if (Math.abs(delta) <= 1) return;

            const nextY = Math.max(0, scrollY.current + delta);
            if (Math.abs(nextY - scrollY.current) <= 1) return;
            scrollY.current = nextY;
            scrollRef.current?.scrollTo({ y: nextY, animated: false });
          });
        });
      });
    },
    [enabled, height, scrollRef],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    if (!enabled) {
      focusedInput.current = null;
      keyboardTop.current = null;
      scrollY.current = 0;
      return;
    }

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const viewport = window.visualViewport;
      const onViewportChange = () => revealFocusedInput();
      viewport?.addEventListener('resize', onViewportChange);
      viewport?.addEventListener('scroll', onViewportChange);
      window.addEventListener('resize', onViewportChange);
      return () => {
        viewport?.removeEventListener('resize', onViewportChange);
        viewport?.removeEventListener('scroll', onViewportChange);
        window.removeEventListener('resize', onViewportChange);
      };
    }

    const updateKeyboardFrame = (event: {
      endCoordinates: { screenY: number; height: number };
    }) => {
      const screenY = event.endCoordinates.screenY;
      keyboardTop.current =
        Number.isFinite(screenY) && screenY > 0
          ? screenY
          : Math.max(0, height - event.endCoordinates.height);
      revealFocusedInput();
    };
    const clearKeyboardFrame = () => {
      keyboardTop.current = null;
    };

    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      updateKeyboardFrame,
    );
    const didShow =
      Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidShow', updateKeyboardFrame) : null;
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      clearKeyboardFrame,
    );
    return () => {
      show.remove();
      didShow?.remove();
      hide.remove();
    };
  }, [enabled, height, revealFocusedInput]);

  return { revealFocusedInput, onScroll };
}
