import * as Haptics from 'expo-haptics';
import { useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { GESTURE } from '@/config/layout';

export interface DragHandlers {
  begin: (absX: number, absY: number) => void;
  move: (absX: number, absY: number) => void;
  end: (cancelled: boolean) => void;
}

/**
 * 「つかんで動かす」ジェスチャー。
 * スマホ: 長押ししてからドラッグ（通常のスクロールと区別するため）/ PC: マウスで少し動かすとドラッグ開始。
 */
export function useDragGesture(handlers: DragHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const active = useRef(false);

  return useMemo(() => {
    const pan = Gesture.Pan().runOnJS(true);
    if (Platform.OS === 'web') pan.minDistance(GESTURE.webDragDistance);
    else pan.activateAfterLongPress(GESTURE.longPressMs);
    return pan
      .onStart((e) => {
        active.current = true;
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
