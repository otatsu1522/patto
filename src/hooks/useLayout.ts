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
  /** 横スクロールの1回分の幅（カンバン1つ分 + すき間） */
  step: number;
  /** 左右の余白 */
  padding: number;
  /** 横スクロールで止まる位置（スクロール量）。1つだけなら [0] */
  offsets: number[];
  /** 両端に見せる、隣のカンバンの幅（PCで4つ以上あるとき。移動ボタンを置く） */
  peek: number;
  /** スマホ縦（前後のカンバンが見える表示） */
  compact: boolean;
}

/** スマホ縦で、現在のカンバンが画面幅に占める割合。残りで前後のカンバンが見える */
const COMPACT_RATIO = 0.82;
/** PCで、左右に隣のカンバンを見せる幅 */
const PEEK_PX = 40;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * ボード領域の幅とカンバン数から、カンバンの幅・表示列数・スクロールで止まる位置を計算する（純粋関数）。
 * - スマホ縦: 現在のカンバンを中央に、前後が見える。いちばん左・右では余白を詰めて、反対側の隣が多く見える。
 * - それ以外: カンバンが3つ以下なら、その数で画面いっぱいに並べる。4つ以上なら3つ表示し、左右に隣が少し見える。
 */
export function boardGeometry(
  containerWidth: number,
  mode: LayoutMode,
  count: number,
): BoardGeometry {
  const { boardPadding: p, columnGap: gap, minColumnWidth, visibleColumns } = BOARD;
  const n = Math.max(1, count);

  if (mode === 'compact') {
    const columnWidth =
      n === 1 ? containerWidth - p * 2 : Math.round(containerWidth * COMPACT_RATIO);
    const step = columnWidth + gap;
    const max = Math.max(0, p * 2 + n * columnWidth + (n - 1) * gap - containerWidth);
    const offsets = Array.from({ length: n }, (_, k) =>
      clamp(p + k * step - (containerWidth - columnWidth) / 2, 0, max),
    );
    return { visible: 1, columnWidth, step, padding: p, offsets, peek: 0, compact: true };
  }

  const fit = Math.max(1, Math.floor((containerWidth - p * 2 + gap) / (minColumnWidth + gap)));
  const limit = Math.min(visibleColumns, fit);
  if (n <= limit) {
    const columnWidth = (containerWidth - p * 2 - gap * (n - 1)) / n;
    return {
      visible: n,
      columnWidth,
      step: columnWidth + gap,
      padding: p,
      offsets: [0],
      peek: 0,
      compact: false,
    };
  }
  const columnWidth = (containerWidth - p * 2 - gap * (limit - 1) - PEEK_PX * 2) / limit;
  const step = columnWidth + gap;
  const max = Math.max(0, p * 2 + n * columnWidth + (n - 1) * gap - containerWidth);
  const offsets = Array.from({ length: n - limit + 1 }, (_, k) =>
    clamp(k * step - PEEK_PX, 0, max),
  );
  return { visible: limit, columnWidth, step, padding: p, offsets, peek: PEEK_PX, compact: false };
}

/** スクロール量 x にいちばん近い「止まる位置」の番号 */
export function nearestOffsetIndex(offsets: number[], x: number): number {
  let best = 0;
  offsets.forEach((o, i) => {
    if (Math.abs(o - x) < Math.abs(offsets[best]! - x)) best = i;
  });
  return best;
}

/** 現在位置から見て、前（-1）/ 次（+1）の「止まる位置」。なければ null */
export function adjacentOffset(offsets: number[], x: number, dir: -1 | 1): number | null {
  const found =
    dir === 1 ? offsets.find((o) => o > x + 1) : [...offsets].reverse().find((o) => o < x - 1);
  return found ?? null;
}

/** ポインタ位置（ボード左端からの距離）+ スクロール量から、何番目のカンバンの上かを返す。 */
export function columnIndexAt(x: number, scrollX: number, g: BoardGeometry, count: number): number {
  const idx = Math.floor((x + scrollX - g.padding + BOARD.columnGap / 2) / g.step);
  return Math.max(0, Math.min(idx, count - 1));
}

/** メニューの幅: PCは画面の約1/4、スマホは画面の約8割。 */
export const sidebarWidthFor = (windowWidth: number, permanent: boolean): number =>
  permanent
    ? Math.round(Math.min(400, Math.max(220, windowWidth * 0.25)))
    : Math.round(Math.min(340, Math.max(260, windowWidth * 0.82)));
