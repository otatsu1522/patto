import { Platform } from 'react-native';

/**
 * ホバー（マウスを乗せた状態）の見た目を使ってよいか。
 * スマホのブラウザでは、タップしたあとホバーの状態が残って、色が付いたままになる。
 * そのため、マウスのように「ホバーできる」端末のときだけホバーの色を使う。
 */
export const canHover: boolean =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: hover)').matches === true;

/** 指で操作する端末（スマホ・タブレット）のブラウザか */
export const isTouchWeb: boolean =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches === true;
