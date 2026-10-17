import { useEffect, useRef } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { isTouchWeb } from '@/lib/hover';
import { GESTURE } from '@/config/layout';

type ScrollViewHandle = {
  getScrollableNode?: () => unknown;
  _scrollNodeRef?: { current?: unknown };
};

/** react-native-web の ScrollView が実際にスクロールする DOM 要素を取得する。 */
function getScrollElement(ref: { current: ScrollView | null }): HTMLElement | null {
  const instance = ref.current as unknown as ScrollViewHandle | null;
  const node = instance?.getScrollableNode?.() ?? instance?._scrollNodeRef?.current;
  return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null;
}

export interface WebWheelScrollOptions {
  /** false の場合、タッチ移動はブラウザ標準に任せる（横スクロールを併用する一覧向け）。 */
  touchScroll?: boolean;
  /** false の場合、この ScrollView にはイベント処理を取り付けない。 */
  enabled?: boolean;
  /** スクロール要素に設定する touch-action。 */
  touchAction?: string;
  /** これ以上長押しされたタッチは、カードのドラッグ操作に任せる。 */
  touchLongPressMs?: number;
}

/**
 * Web の ScrollView 用スクロール ref。
 * 子のカード・フォーム上から操作してもホイールスクロールを受け取り、
 * 必要な画面ではタッチ移動も補助する。
 */
export function useWebWheelScroll({
  touchScroll = true,
  touchAction = 'pan-y',
  touchLongPressMs,
  enabled = true,
}: WebWheelScrollOptions = {}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;

    let element: HTMLElement | null = null;
    let frame = 0;
    let attempts = 0;
    let disposed = false;
    let observer: MutationObserver | null = null;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let touchStartedAt = 0;
    let touchAxis: 'pending' | 'vertical' | 'horizontal' = 'pending';
    let trackingTouch = false;

    const isInside = (event: Event) => {
      const target = event.target;
      return !!element && target instanceof Node && element.contains(target);
    };

    const hasNestedScrollable = (target: EventTarget | null, deltaY: number) => {
      let node = target instanceof HTMLElement ? target : null;
      while (node && node !== element) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        ) {
          const canScroll =
            deltaY < 0
              ? node.scrollTop > 0
              : node.scrollTop + node.clientHeight <
                node.scrollHeight - GESTURE.nestedScrollEndTolerancePx;
          if (canScroll) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onWheel = (event: WheelEvent) => {
      if (!element || !isInside(event) || event.ctrlKey || event.deltaY === 0) return;
      if (hasNestedScrollable(event.target, event.deltaY)) return;

      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * GESTURE.webWheelLineDeltaPx
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * element.clientHeight
            : event.deltaY;
      const current = element.scrollTop;
      const next = Math.max(
        0,
        Math.min(element.scrollHeight - element.clientHeight, current + delta),
      );
      if (next === current) return;

      event.preventDefault();
      element.scrollTop = next;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!element || !isInside(event) || event.touches.length !== 1) {
        trackingTouch = false;
        return;
      }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      touchStartedAt = Date.now();
      touchAxis = 'pending';
      trackingTouch = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!element || !trackingTouch || event.touches.length !== 1) return;
      if (
        touchAxis === 'pending' &&
        touchLongPressMs !== undefined &&
        Date.now() - touchStartedAt >= touchLongPressMs
      ) {
        // スクロール方向が決まる前の長押しだけ、カードのドラッグ操作に譲る。
        // 縦スクロールを開始した後は、400ms を超えてもスクロールを継続する。
        resetTouch();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (touchAxis === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE.webScrollAxisThresholdPx) return;
        touchAxis = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
      }
      if (touchAxis !== 'vertical') return;

      const delta = lastY - touch.clientY;
      lastY = touch.clientY;
      // ネストしたリストにまだスクロール余地がある場合は、そちらの標準操作を優先する。
      // 子リストの端に達した後は、このダイアログ本文へスクロールを引き継ぐ。
      if (hasNestedScrollable(event.target, delta)) return;
      const current = element.scrollTop;
      const next = Math.max(
        0,
        Math.min(element.scrollHeight - element.clientHeight, current + delta),
      );
      if (next === current) return;

      if (event.cancelable) event.preventDefault();
      element.scrollTop = next;
    };

    const resetTouch = () => {
      trackingTouch = false;
      touchAxis = 'pending';
    };

    const detach = () => {
      if (!element) return;
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', resetTouch, true);
      document.removeEventListener('touchcancel', resetTouch, true);
    };

    const attach = () => {
      if (disposed) return;
      const found = getScrollElement(scrollRef);
      if (!found) {
        if (attempts++ < GESTURE.webScrollAttachAttempts) {
          frame = window.requestAnimationFrame(attach);
        } else if (!observer && typeof MutationObserver !== 'undefined') {
          // 条件表示される検索結果など、フックの初回実行時にまだ DOM がない場合も接続する。
          observer = new MutationObserver(() => {
            if (!element) attach();
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
        return;
      }

      if (element === found) return;
      if (element) detach();
      element = found;
      observer?.disconnect();
      observer = null;

      // 子のカード・フォームの上でもページの縦スクロールを受け取る。
      element.style.overflowY = 'auto';
      element.style.minHeight = '0';
      element.style.touchAction = touchAction;
      element.style.overscrollBehaviorY = 'contain';
      element.style.setProperty('-webkit-overflow-scrolling', 'touch');

      document.addEventListener('wheel', onWheel, { capture: true, passive: false });
      if (isTouchWeb && touchScroll) {
        document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
        document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        document.addEventListener('touchend', resetTouch, true);
        document.addEventListener('touchcancel', resetTouch, true);
      }
    };

    attach();
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      detach();
    };
  }, [enabled, touchAction, touchScroll, touchLongPressMs]);

  return scrollRef;
}
