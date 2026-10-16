import { useCallback, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * ダイアログの表示完了イベントから入力欄へフォーカスするための参照を管理する。
 * 固定時間の待機は使わず、Dialog の onShow から focus を呼び出す。
 */
export function useFocusOnOpen() {
  const inputRef = useRef<TextInput | null>(null);

  // JSX render 中に ref.current を読む必要がないよう、コールバック ref を渡す。
  const setRef = useCallback((input: TextInput | null) => {
    inputRef.current = input;
  }, []);

  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return { setRef, focus };
}
