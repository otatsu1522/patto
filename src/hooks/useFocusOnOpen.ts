import { useEffect, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * ダイアログを開いたら、入力欄にフォーカスする。
 * メニューを閉じた直後にダイアログが開くと、autoFocus が効かないことがあるため、
 * 開く動きが落ち着いてから focus() を呼ぶ。
 */
export function useFocusOnOpen(visible: boolean, delayMs = 350) {
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => ref.current?.focus(), delayMs);
    return () => clearTimeout(id);
  }, [visible, delayMs]);
  return ref;
}
