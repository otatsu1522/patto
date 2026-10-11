import * as Crypto from 'expo-crypto';

/** 端末で生成する UUID（オフラインで作成しても重複しない）。 */
export const newId = (): string => Crypto.randomUUID();
