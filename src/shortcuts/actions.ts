import { t, type StringKey } from '@/i18n';

/**
 * ショートカットで実行できる操作の一覧と既定のキー。
 * 単キーと修飾キーの組み合わせに対応し、利用者は設定画面から変更できる。
 */
export const SHORTCUT_ACTIONS = [
  { id: 'cursorLeft', labelKey: 'shortcut.cursorLeft', keys: ['h'] },
  { id: 'cursorDown', labelKey: 'shortcut.cursorDown', keys: ['j'] },
  { id: 'cursorUp', labelKey: 'shortcut.cursorUp', keys: ['k'] },
  { id: 'cursorRight', labelKey: 'shortcut.cursorRight', keys: ['l'] },
  { id: 'grab', labelKey: 'shortcut.grab', keys: ['g'] },
  { id: 'edit', labelKey: 'shortcut.edit', keys: ['e', 'Enter'] },
  { id: 'delete', labelKey: 'shortcut.delete', keys: ['x'] },
  { id: 'newTask', labelKey: 'shortcut.newTask', keys: ['n'] },
  { id: 'newColumn', labelKey: 'shortcut.newColumn', keys: ['N'] },
  { id: 'toggleFavorite', labelKey: 'shortcut.toggleFavorite', keys: ['p'] },
  { id: 'archiveTask', labelKey: 'shortcut.archiveTask', keys: ['a'] },
  { id: 'archiveDone', labelKey: 'shortcut.archiveDone', keys: ['A'] },
  { id: 'duplicate', labelKey: 'shortcut.duplicate', keys: ['d'] },
  { id: 'moveColumnLeft', labelKey: 'shortcut.moveColumnLeft', keys: ['H'] },
  { id: 'moveColumnRight', labelKey: 'shortcut.moveColumnRight', keys: ['L'] },
  { id: 'nextProject', labelKey: 'shortcut.nextProject', keys: [']'] },
  { id: 'prevProject', labelKey: 'shortcut.prevProject', keys: ['['] },
  { id: 'newProject', labelKey: 'shortcut.newProject', keys: ['P'] },
  { id: 'search', labelKey: 'shortcut.search', keys: ['/'] },
  { id: 'toggleSidebar', labelKey: 'shortcut.toggleSidebar', keys: ['m'] },
  { id: 'openSettings', labelKey: 'shortcut.openSettings', keys: [','] },
  { id: 'sync', labelKey: 'shortcut.sync', keys: ['r'] },
  { id: 'undo', labelKey: 'shortcut.undo', keys: ['u'] },
  { id: 'toggleTheme', labelKey: 'shortcut.toggleTheme', keys: ['t'] },
  { id: 'showHelp', labelKey: 'shortcut.showHelp', keys: ['?'] },
] as const satisfies readonly { id: string; labelKey: StringKey; keys: readonly string[] }[];

export type ActionId = (typeof SHORTCUT_ACTIONS)[number]['id'];
export type Bindings = Record<ActionId, string[]>;

export const defaultBindings = (): Bindings =>
  Object.fromEntries(
    SHORTCUT_ACTIONS.map((a) => [a.id, a.keys.map(normalizeShortcutKey)]),
  ) as Bindings;

/**
 * キー割り当てを正規形にする。以前保存された "N" や "ctrl+Z" も、
 * それぞれ "shift+n" / "ctrl+shift+z" に変換して互換性を保つ。
 */
export function normalizeShortcutKey(shortcut: string): string {
  const parts = shortcut.split('+');
  let key = parts.pop() ?? '';
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));

  // 以前の表現では、大文字の英字が Shift を意味していた。
  if (/^[A-Z]$/.test(key)) {
    modifiers.add('shift');
    key = key.toLowerCase();
  }

  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const normalizedModifiers = order.filter((modifier) => modifiers.has(modifier));
  return [...normalizedModifiers, key].join('+');
}

/** 既定値に、利用者の変更（overrides）を重ねたキー割り当て */
export function resolveBindings(overrides: Record<string, string[]>): Bindings {
  const base = defaultBindings();
  for (const a of SHORTCUT_ACTIONS) {
    const o = overrides[a.id];
    if (o) base[a.id] = o.map(normalizeShortcutKey);
  }
  return base;
}

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** キー入力を正規形にする。英字の Shift は明示し、記号は入力された記号自体で表す。 */
export function keyToString(e: KeyLike): string {
  const rawKey = e.key === ' ' ? 'Space' : e.key;
  const isLetter = /^[a-z]$/i.test(rawKey);
  const key = isLetter ? rawKey.toLowerCase() : rawKey;
  const modifiers = [
    e.ctrlKey ? 'ctrl' : '',
    e.altKey ? 'alt' : '',
    // 英字は大文字・小文字を区別し、Enter や矢印などは Shift も組み合わせとして扱う。
    e.shiftKey && (isLetter || rawKey.length > 1) ? 'shift' : '',
    e.metaKey ? 'meta' : '',
  ].filter(Boolean);
  return normalizeShortcutKey([...modifiers, key].join('+'));
}

export const isModifierOnly = (key: string): boolean =>
  ['Shift', 'Control', 'Alt', 'Meta'].includes(key);

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

/** 表示用のキー単位。修飾キーと通常キーを個別のキーキャップとして表示する。 */
export function displayKeyParts(shortcut: string): string[] {
  const parts = normalizeShortcutKey(shortcut).split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts.map((modifier) => {
    switch (modifier) {
      case 'ctrl':
        return 'Ctrl';
      case 'meta':
        return 'Meta';
      case 'alt':
        return 'Alt';
      case 'shift':
        return 'Shift';
      default:
        return modifier;
    }
  });
  const visibleKey = /^[a-z]$/.test(key) ? key.toUpperCase() : key;
  return [...modifiers, visibleKey === 'Space' ? 'Space' : visibleKey];
}

/** 説明文・エラーメッセージ用（例: Ctrl + Shift + Z）。 */
export const displayKey = (key: string): string =>
  displayKeyParts(key).join(t('shortcut.comboJoiner'));
