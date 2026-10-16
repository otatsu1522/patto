import { Platform } from 'react-native';
import { UI_METRICS } from '@/config/layout';

export interface SystemBarInsets {
  top: number;
  bottom: number;
}

/**
 * Edge-to-edge の Android で safe-area-context の inset が初期描画時に 0 になる場合も、
 * システムバーの背後の描画領域とダイアログの安全な余白を確保する。
 */
export function getSystemBarInsets(insets: SystemBarInsets): SystemBarInsets {
  if (Platform.OS !== 'android') return insets;

  return {
    top: Math.max(insets.top, UI_METRICS.systemBars.androidMinimumInsetPx),
    bottom: Math.max(insets.bottom, UI_METRICS.systemBars.androidMinimumInsetPx),
  };
}
