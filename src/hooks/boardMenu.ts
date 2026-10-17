import { requestDrawerCloseAfterRender, takeDrawerCloseAfterRender } from './drawerTransition';

/**
 * スマホのメニューの開閉。
 * メニューはボード画面の横スクロールの「いちばん左のカンバンのさらに左」にある1枚のページ。
 */
export interface BoardMenuApi {
  open: () => void;
  close: () => void;
  /** 閉じるアニメーションが完了した後に処理を続行する。 */
  closeAndThen?: (afterClose: () => void) => void;
  toggle: () => void;
}

let current: BoardMenuApi | null = null;
let pendingCloseAfterProjectRender: { projectId: string; target: string } | null = null;

export function registerBoardMenu(api: BoardMenuApi): () => void {
  current = api;
  return () => {
    if (current === api) current = null;
  };
}

export const openBoardMenu = (): void => current?.open();
export const closeBoardMenu = (): void => current?.close();
export const closeBoardMenuThen = (afterClose: () => void): void => {
  if (current?.closeAndThen) current.closeAndThen(afterClose);
  else {
    current?.close();
    afterClose();
  }
};
export const toggleBoardMenu = (): void => current?.toggle();

/** 指定プロジェクトの内容がボードに描画された後でメニューを閉じる要求を登録する。 */
export function requestBoardMenuCloseAfterProjectRender(projectId: string): void {
  const target = `project:${projectId}`;
  pendingCloseAfterProjectRender = { projectId, target };
  requestDrawerCloseAfterRender(target);
}

/** BoardView が対象プロジェクトを描画したタイミングで、一度だけ閉じるトークンを取得する。 */
export function consumeBoardMenuCloseAfterProjectRender(projectId?: string): number | null {
  const pending = pendingCloseAfterProjectRender;
  if (!projectId || !pending || pending.projectId !== projectId) return null;
  pendingCloseAfterProjectRender = null;
  return takeDrawerCloseAfterRender(pending.target);
}
