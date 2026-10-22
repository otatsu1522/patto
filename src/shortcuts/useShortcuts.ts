import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';
import { isTouchWeb } from '@/lib/hover';
import { useUiStore } from '@/store/uiStore';
import {
  buildKeyMap,
  isModifierOnly,
  keyToString,
  resolveBindings,
  type ActionId,
} from './actions';

export type ShortcutHandlers = Partial<Record<ActionId, () => void | Promise<unknown>>>;

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
  const activeRef = useRef(active);
  const inFlightActionsRef = useRef<Set<ActionId>>(new Set());
  // eslint-disable-next-line react-hooks/refs -- 常に最新のハンドラーを呼ぶための定番の書き方（読むのはキー入力時だけ）
  ref.current = handlers;
  // eslint-disable-next-line react-hooks/refs -- 画面切替コミット直後、listener cleanup 前の入力も抑止する。
  activeRef.current = active;

  useEffect(() => {
    if (Platform.OS !== 'web' || isTouchWeb || !active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const { settings } = useSettingsStore.getState();
      if (!settings.shortcutsEnabled || isModifierOnly(e.key)) return;
      const uiState = useUiStore.getState();
      if (
        isTypingTarget(e.target) ||
        uiState.dialogCount > 0 ||
        uiState.dropdownMenuOpen ||
        uiState.shortcutsSuspended
      )
        return;
      const map = buildKeyMap(resolveBindings(settings.shortcutOverrides));
      const action = map.get(keyToString(e));
      const fn = action ? ref.current[action] : undefined;
      if (!action || !fn) return;

      e.preventDefault();
      const inFlight = inFlightActionsRef.current;
      // キーリピートは許可するが、同じ操作の非同期処理中に届いた入力は無視する。
      if (inFlight.has(action)) return;

      inFlight.add(action);
      try {
        const result = fn();
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).then(
            () => inFlight.delete(action),
            () => inFlight.delete(action),
          );
        } else {
          inFlight.delete(action);
        }
      } catch (error) {
        inFlight.delete(action);
        throw error;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/** Esc などの固定キー用（設定で変更できない）。 */
export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler);
  const activeRef = useRef(active);
  // eslint-disable-next-line react-hooks/refs -- 同上
  ref.current = handler;
  // eslint-disable-next-line react-hooks/refs -- 画面切替コミット直後、listener cleanup 前の入力も抑止する。
  activeRef.current = active;
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const uiState = useUiStore.getState();
      if (
        e.key === 'Escape' &&
        uiState.dialogCount === 0 &&
        !uiState.dropdownMenuOpen &&
        !uiState.shortcutsSuspended
      )
        ref.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
