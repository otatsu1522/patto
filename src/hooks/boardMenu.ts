/**
 * スマホのメニューの開閉。
 * メニューは、ボード画面の横スクロールの「いちばん左のカンバンのさらに左」にある1枚のページ。
 * 開いているかどうかは、そのスクロール位置だけで決まる（別の場所に状態を持たないので、互いに更新し合って
 * ループすることがない）。ボード画面が、自分のスクロール操作を次の形で登録する。
 */
export interface BoardMenuApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

let current: BoardMenuApi | null = null;

export function registerBoardMenu(api: BoardMenuApi): () => void {
  current = api;
  return () => {
    if (current === api) current = null;
  };
}

export const openBoardMenu = (): void => current?.open();
export const closeBoardMenu = (): void => current?.close();
export const toggleBoardMenu = (): void => current?.toggle();
