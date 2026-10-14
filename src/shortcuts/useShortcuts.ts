import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import {
  buildKeyMap,
  isModifierOnly,
  keyToString,
  resolveBindings,
  type ActionId,
} from './actions';

export type ShortcutHandlers = Partial<Record<ActionId, () => void>>;

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true
  );
};

/**
 * キーボードショートカット（Web のみ）。handlers に渡したアクションだけを処理する。
 * 入力欄の操作中、ダイアログ表示中、設定でOFFのときは何もしない。
 */
export function useShortcuts(handlers: ShortcutHandlers, active = true): void {
  const ref = useRef(handlers);
  // eslint-disable-next-line react-hooks/refs -- 常に最新のハンドラーを呼ぶための定番の書き方（読むのはキー入力時だけ）
  ref.current = handlers;

  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const { settings } = useSettingsStore.getState();
      if (!settings.shortcutsEnabled || isModifierOnly(e.key)) return;
      if (isTypingTarget(e.target) || useUiStore.getState().dialogCount > 0) return;
      const map = buildKeyMap(resolveBindings(settings.shortcutOverrides));
      const action = map.get(keyToString(e));
      const fn = action ? ref.current[action] : undefined;
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/** Esc などの固定キー用（設定で変更できない）。 */
export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler);
  // eslint-disable-next-line react-hooks/refs -- 同上
  ref.current = handler;
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUiStore.getState().dialogCount === 0) ref.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
