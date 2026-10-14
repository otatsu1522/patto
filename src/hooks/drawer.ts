import { Animated } from 'react-native';

/**
 * スマホのメニュー（ドロワー）の開き具合（0=閉じている、1=開いている）。
 *
 * ボード画面では、メニューを「いちばん左のカンバンのさらに左」に置いた横スクロールの一部として扱う。
 * そのため、メニューを開く操作はカンバンを移動するときと同じスクロールの動き（同じ感度・吸着）になる。
 * ボードがない画面（設定など）では、アニメーションで開閉する。
 */
export const drawerProgress = new Animated.Value(0);

export interface BoardDrawerApi {
  /** メニューの幅（スクロール量 0 のとき、この幅ぶんメニューが見える） */
  menuWidth: number;
  /** メニューを閉じた位置（最初のカンバンが左に揃う）のスクロール量 */
  closedX: number;
  scrollTo: (x: number, animated: boolean) => void;
  isOpen: () => boolean;
}

let board: BoardDrawerApi | null = null;

/** ボード画面が、自分のスクロールをメニューの開閉に使えるよう登録する。戻り値で解除。 */
export function attachBoardDrawer(api: BoardDrawerApi): () => void {
  board = api;
  return () => {
    if (board === api) board = null;
  };
}

export const boardDrawerIsOpen = (): boolean | null => (board ? board.isOpen() : null);

/** メニューを開く/閉じる（ボードがあればスクロールで、なければアニメーションで）。 */
export function applyDrawer(open: boolean, animated = true): void {
  if (board) {
    board.scrollTo(open ? 0 : board.closedX, animated);
    return;
  }
  if (!animated) return drawerProgress.setValue(open ? 1 : 0);
  Animated.timing(drawerProgress, {
    toValue: open ? 1 : 0,
    duration: 200,
    useNativeDriver: false,
  }).start();
}

/** 指に合わせてメニューを動かす（progress は 0〜1）。 */
export function dragDrawer(progress: number): void {
  const p = Math.max(0, Math.min(1, progress));
  if (board) board.scrollTo((1 - p) * board.menuWidth, false);
  else drawerProgress.setValue(p);
}
