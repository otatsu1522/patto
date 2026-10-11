import { SYNC } from '@/config/limits';

/** サーバー時刻との差（ms）。同期のたびに更新して端末時計のずれを補正する。 */
let offsetMs = 0;

export const setClockOffset = (ms: number) => {
  offsetMs = ms;
};

/** 補正済みの現在時刻（epoch ms）。レコードの更新日時はこれで付ける。 */
export const nowMs = (): number => Date.now() + offsetMs;

/** 未来すぎる時刻を許容上限に丸める（端末時計が大きく進んでいる場合の保護）。 */
export const clampFuture = (ts: number, serverNow: number): number =>
  Math.min(ts, serverNow + SYNC.maxClockSkewMs);
