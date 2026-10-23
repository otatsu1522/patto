/** プラットフォームの保存先に合わせた保存形式の制限値。 */
export const STORAGE = {
  /** SecureStore の1値あたりの制限を避ける UTF-8 バイト数 */
  secureStoreChunkSize: 1800,
} as const;
