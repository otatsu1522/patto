import { Platform } from 'react-native';

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
    top: Math.max(insets.top, 24),
    bottom: Math.max(insets.bottom, 24),
  };
}
