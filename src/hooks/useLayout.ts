import { useWindowDimensions } from 'react-native';
import { BOARD, BREAKPOINTS } from '@/config/layout';

export type LayoutMode = 'compact' | 'medium' | 'expanded';

export const layoutModeFor = (width: number): LayoutMode =>
  width < BREAKPOINTS.medium ? 'compact' : width < BREAKPOINTS.expanded ? 'medium' : 'expanded';

/** 画面幅から表示モード（スマホ縦 / スマホ横・小型タブレット / PC）を決める。 */
export function useLayoutMode(): { mode: LayoutMode; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return { mode: layoutModeFor(width), width, height };
}

export interface BoardGeometry {
  /** 1画面に見えるカンバンの数 */
  visible: number;
  columnWidth: number;
  /** 横スクロールの1回分の幅 */
  step: number;
  paging: boolean;
}

/** ボード領域の幅から、カンバンの幅と表示列数を計算する（純粋関数）。 */
export function boardGeometry(containerWidth: number, mode: LayoutMode): BoardGeometry {
  const { boardPadding: p, columnGap: gap, minColumnWidth, visibleColumns } = BOARD;
  if (mode === 'compact') {
    return { visible: 1, columnWidth: Math.max(0, containerWidth - p * 2), step: containerWidth, paging: true };
  }
  const fit = Math.max(1, Math.floor((containerWidth - p * 2 + gap) / (minColumnWidth + gap)));
  const visible = Math.min(visibleColumns, fit);
  const columnWidth = (containerWidth - p * 2 - gap * (visible - 1)) / visible;
  return { visible, columnWidth, step: columnWidth + gap, paging: false };
}

/** ポインタ位置（ボード左端からの距離）+ スクロール量から、何番目のカンバンの上かを返す。 */
export function columnIndexAt(x: number, scrollX: number, g: BoardGeometry, count: number): number {
  const p = BOARD.boardPadding;
  const idx = g.paging ? Math.floor((x + scrollX) / g.step) : Math.floor((x + scrollX - p) / g.step);
  return Math.max(0, Math.min(idx, count - 1));
}
