/**
 * モバイルのドロワーで共通利用する「内容を切り替えてから閉じる」遷移管理。
 * ボードと設定は別々の ScrollView を持つが、遷移要求の消費・キャンセル規則は共通にする。
 */
interface TransitionRequest {
  token: number;
  target: string;
}

interface ActiveTransition extends TransitionRequest {
  phase: 'scheduled' | 'closing';
  interrupt?: () => void;
  firstFrame?: number;
  secondFrame?: number;
}

let nextToken = 0;
let pending: TransitionRequest | null = null;
let active: ActiveTransition | null = null;

/** 対象画面の描画後にドロワーを閉じる要求を登録する。新しい要求は古い要求を置き換える。 */
export function requestDrawerCloseAfterRender(target: string): number {
  cancelDrawerCloseTransition();
  const token = ++nextToken;
  pending = { token, target };
  return token;
}

/** 対象画面が描画された側で要求を一度だけ取得する。 */
export function takeDrawerCloseAfterRender(target: string): number | null {
  if (!pending || pending.target !== target) return null;
  active = { ...pending, phase: 'scheduled' };
  pending = null;
  return active.token;
}

/** 描画後の閉じる処理を開始する。ユーザー操作でキャンセル済みなら何もしない。 */
export function startDrawerCloseAfterRender(
  token: number,
  close: () => void,
  interrupt: () => void,
): boolean {
  if (!active || active.token !== token || active.phase !== 'scheduled') return false;
  active.phase = 'closing';
  active.interrupt = interrupt;
  active.firstFrame = undefined;
  active.secondFrame = undefined;
  close();
  return true;
}

/** コンテンツ側の初期レイアウト後、共通の2フレーム待機でドロワー閉じを開始する。 */
export function scheduleDrawerCloseAfterRender(
  token: number,
  isAlreadyClosed: () => boolean,
  close: () => void,
  interrupt: () => void,
): () => void {
  if (!active || active.token !== token || active.phase !== 'scheduled') return () => {};
  active.firstFrame = requestAnimationFrame(() => {
    if (!active || active.token !== token || active.phase !== 'scheduled') return;
    active.firstFrame = undefined;
    active.secondFrame = requestAnimationFrame(() => {
      if (!active || active.token !== token || active.phase !== 'scheduled') return;
      active.secondFrame = undefined;
      if (isAlreadyClosed()) {
        finishDrawerCloseAfterRender(token);
        return;
      }
      startDrawerCloseAfterRender(token, close, interrupt);
    });
  });
  return () => {
    // ルートや寸法が再度変わって scheduled 段階の effect が破棄されたら、
    // 古い表示のクローズ要求を残さない。閉じるアニメーション開始後は中断しない。
    if (!active || active.token !== token || active.phase !== 'scheduled') return;
    const scheduled = active;
    active = null;
    if (scheduled.firstFrame !== undefined) cancelAnimationFrame(scheduled.firstFrame);
    if (scheduled.secondFrame !== undefined) cancelAnimationFrame(scheduled.secondFrame);
  };
}

/** 閉じるアニメーションが終端へ到達したことを記録する。 */
export function finishDrawerCloseAfterRender(token: number): void {
  if (active?.token === token) active = null;
}

/**
 * 新たなユーザー操作が始まったときに保留中の自動クローズを破棄する。
 * アニメーション中なら現在位置で止め、以後の操作を優先する。
 */
export function cancelDrawerCloseTransition(): void {
  const previous = active;
  pending = null;
  active = null;
  if (previous?.firstFrame !== undefined) cancelAnimationFrame(previous.firstFrame);
  if (previous?.secondFrame !== undefined) cancelAnimationFrame(previous.secondFrame);
  previous?.phase === 'closing' && previous.interrupt?.();
}
