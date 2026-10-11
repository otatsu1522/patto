import type { StringKey } from '@/i18n';

/**
 * ショートカットで実行できる操作の一覧と既定のキー（すべて単キー）。
 * 既定のキーを変えるときはこのファイルを編集する。利用者は設定画面からも変更できる。
 */
export const SHORTCUT_ACTIONS = [
  { id: 'cursorLeft', labelKey: 'shortcut.cursorLeft', keys: ['h'] },
  { id: 'cursorDown', labelKey: 'shortcut.cursorDown', keys: ['j'] },
  { id: 'cursorUp', labelKey: 'shortcut.cursorUp', keys: ['k'] },
  { id: 'cursorRight', labelKey: 'shortcut.cursorRight', keys: ['l'] },
  { id: 'grab', labelKey: 'shortcut.grab', keys: ['g'] },
  { id: 'edit', labelKey: 'shortcut.edit', keys: ['e', 'Enter'] },
  { id: 'delete', labelKey: 'shortcut.delete', keys: ['d'] },
  { id: 'newTask', labelKey: 'shortcut.newTask', keys: ['n'] },
  { id: 'newColumn', labelKey: 'shortcut.newColumn', keys: ['c'] },
  { id: 'toggleFavorite', labelKey: 'shortcut.toggleFavorite', keys: ['f'] },
  { id: 'archiveTask', labelKey: 'shortcut.archiveTask', keys: ['a'] },
  { id: 'archiveDone', labelKey: 'shortcut.archiveDone', keys: ['A'] },
  { id: 'duplicate', labelKey: 'shortcut.duplicate', keys: ['y'] },
  { id: 'moveColumnLeft', labelKey: 'shortcut.moveColumnLeft', keys: ['H'] },
  { id: 'moveColumnRight', labelKey: 'shortcut.moveColumnRight', keys: ['L'] },
  { id: 'nextProject', labelKey: 'shortcut.nextProject', keys: [']'] },
  { id: 'prevProject', labelKey: 'shortcut.prevProject', keys: ['['] },
  { id: 'newProject', labelKey: 'shortcut.newProject', keys: ['p'] },
  { id: 'search', labelKey: 'shortcut.search', keys: ['/'] },
  { id: 'toggleSidebar', labelKey: 'shortcut.toggleSidebar', keys: ['b'] },
  { id: 'openSettings', labelKey: 'shortcut.openSettings', keys: [','] },
  { id: 'sync', labelKey: 'shortcut.sync', keys: ['r'] },
  { id: 'undo', labelKey: 'shortcut.undo', keys: ['u'] },
  { id: 'toggleTheme', labelKey: 'shortcut.toggleTheme', keys: ['t'] },
  { id: 'showHelp', labelKey: 'shortcut.showHelp', keys: ['?'] },
] as const satisfies readonly { id: string; labelKey: StringKey; keys: readonly string[] }[];

export type ActionId = (typeof SHORTCUT_ACTIONS)[number]['id'];
export type Bindings = Record<ActionId, string[]>;

export const defaultBindings = (): Bindings =>
  Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, [...a.keys]])) as Bindings;

/** 既定値に、利用者の変更（overrides）を重ねたキー割り当て */
export function resolveBindings(overrides: Record<string, string[]>): Bindings {
  const base = defaultBindings();
  for (const a of SHORTCUT_ACTIONS) {
    const o = overrides[a.id];
    if (o) base[a.id] = o;
  }
  return base;
}

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** キー入力を "h" / "H" / "Enter" / "ctrl+z" のような文字列にする（Shiftは大文字・記号で表す）。 */
export function keyToString(e: KeyLike): string {
  const key = e.key === ' ' ? 'Space' : e.key;
  const mods = [e.ctrlKey ? 'ctrl' : '', e.metaKey ? 'meta' : '', e.altKey ? 'alt' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

export const isModifierOnly = (key: string): boolean => ['Shift', 'Control', 'Alt', 'Meta'].includes(key);

/** キー → アクションの逆引き表 */
export function buildKeyMap(bindings: Bindings): Map<string, ActionId> {
  const map = new Map<string, ActionId>();
  for (const a of SHORTCUT_ACTIONS) for (const k of bindings[a.id]) map.set(k, a.id);
  return map;
}

/** key が別のアクションで使われていればそのIDを返す（自分自身は除く） */
export function findConflict(bindings: Bindings, actionId: ActionId, key: string): ActionId | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id !== actionId && bindings[a.id].includes(key)) return a.id;
  }
  return null;
}

/** 表示用（Enter → ↵ など） */
export const displayKey = (key: string): string => (key === 'Space' ? 'Space' : key === 'Enter' ? 'Enter' : key);
