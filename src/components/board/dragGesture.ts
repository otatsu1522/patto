import * as Haptics from 'expo-haptics';
import { useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { GESTURE } from '@/config/layout';
import { isTouchWeb } from '@/lib/hover';

/** つかんだカードの大きさと、カードの左上から見た指の位置（ドラッグ中の見た目を指に合わせるため） */
export interface GrabInfo {
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export interface DragHandlers {
  begin: (absX: number, absY: number, grab?: GrabInfo) => void;
  move: (absX: number, absY: number) => void;
  end: (cancelled: boolean) => void;
}

/**
 * 「つかんで動かす」ジェスチャー。
 * スマホ: 長押ししてからドラッグ（通常のスクロールと区別するため）/ PC: マウスで少し動かすとドラッグ開始。
 */
/* eslint-disable react-hooks/refs -- 常に最新のハンドラーを呼ぶための定番の書き方（描画中には値を読まず、ジェスチャーの実行時にだけ読む） */
export function useDragGesture(handlers: DragHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const active = useRef(false);

  return useMemo(() => {
    const pan = Gesture.Pan().runOnJS(true);
    // マウスの Web は少し動かすとドラッグ開始。スマホ（ネイティブ・スマホのブラウザ）は、スクロールと区別するため長押し
    if (Platform.OS === 'web' && !isTouchWeb) pan.minDistance(GESTURE.webDragDistance);
    else pan.activateAfterLongPress(GESTURE.longPressMs);
    return pan
      .onStart((e) => {
        active.current = true;
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (isTouchWeb) navigator.vibrate?.(15);
        ref.current.begin(e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        if (active.current) ref.current.move(e.absoluteX, e.absoluteY);
      })
      .onFinalize((_e, success) => {
        if (!active.current) return;
        active.current = false;
        ref.current.end(!success);
      });
  }, []);
}
/* eslint-enable react-hooks/refs */
