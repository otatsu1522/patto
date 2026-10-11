/** 直前の操作を元に戻すための簡易スタック（画面を開いている間だけ保持）。 */
interface UndoEntry {
  undo: () => Promise<void>;
}

const stack: UndoEntry[] = [];
const MAX = 20;

export function pushUndo(undo: () => Promise<void>): () => Promise<void> {
  stack.push({ undo });
  if (stack.length > MAX) stack.shift();
  return undo;
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
