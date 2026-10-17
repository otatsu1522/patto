import { requestDrawerCloseAfterRender, takeDrawerCloseAfterRender } from './drawerTransition';

/** 設定画面の横スライド式メニューを操作するための登録API。 */
export interface SettingsMenuApi {
  open: () => void;
  close: () => void;
  /** 閉じるアニメーションが完了した後に処理を続行する。 */
  closeAndThen?: (afterClose: () => void) => void;
  toggle: () => void;
}

let current: SettingsMenuApi | null = null;
let pendingCloseTarget: string | null = null;

export function registerSettingsMenu(api: SettingsMenuApi): () => void {
  current = api;
  return () => {
    if (current === api) current = null;
  };
}

export const openSettingsMenu = (): void => current?.open();
export const closeSettingsMenu = (): void => current?.close();
export const closeSettingsMenuThen = (afterClose: () => void): void => {
  if (current?.closeAndThen) current.closeAndThen(afterClose);
  else {
    current?.close();
    afterClose();
  }
};
export const toggleSettingsMenu = (): void => current?.toggle();

/** 設定画面への遷移後、描画されたコンテンツを保ったままメニューを閉じる要求を登録する。 */
export function requestSettingsMenuCloseAfterRender(target: string): void {
  pendingCloseTarget = target;
  requestDrawerCloseAfterRender(`settings:${target}`);
}

/** AppShell が遷移先を描画した後に一度だけ閉じる要求を取得する。 */
export function consumeSettingsMenuCloseAfterRender(target: string): number | null {
  if (pendingCloseTarget !== target) return null;
  pendingCloseTarget = null;
  return takeDrawerCloseAfterRender(`settings:${target}`);
}
