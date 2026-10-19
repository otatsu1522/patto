import { LIMITS } from '@/config/limits';
import { t } from '@/i18n';
import type { ToastCategory } from '@/config/defaults';
import { useSettingsStore } from '@/store/settingsStore';

/** 直前の操作を元に戻すための簡易スタック（画面を開いている間だけ保持）。 */
interface UndoEntry {
  undo: () => Promise<void>;
}

const stack: UndoEntry[] = [];

type UndoToast = (
  message: string,
  action?: { label: string; onPress: () => void },
  options?: { category: ToastCategory; bypassCategoryFilter?: boolean },
) => void;

export function pushUndo(undo: () => Promise<void>): () => Promise<void> {
  let entry: UndoEntry | null = null;
  const execute = async () => {
    if (!entry) return;
    const index = stack.indexOf(entry);
    if (index < 0) return;
    stack.splice(index, 1);
    await undo();
  };
  entry = { undo };
  stack.push(entry);
  if (stack.length > LIMITS.undoStackMaxEntries) stack.shift();
  return execute;
}

/** Undo 可能な操作は、トーストのボタンと U キーで同じスタックを共有する。 */
export function showUndoToast(
  toast: UndoToast,
  message: string,
  undo: () => Promise<void>,
  category: ToastCategory,
): void {
  const settings = useSettingsStore.getState().settings;
  if (!settings.toastEnabled || !settings.toastCategories.includes(category)) {
    toast(message, undefined, { category });
    return;
  }
  const execute = pushUndo(undo);
  toast(message, { label: t('common.undo'), onPress: () => void execute() }, { category });
}

export async function popUndo(): Promise<boolean> {
  const entry = stack.pop();
  if (!entry) return false;
  await entry.undo();
  return true;
}

export const clearUndo = (): void => {
  stack.length = 0;
};
