/** 小さな設定値を保存するキーバリューストア（Web: localStorage）。 */
export const kv = {
  get: async (key: string): Promise<string | null> => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string): Promise<void> => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 容量超過などは無視 */
    }
  },
  remove: async (key: string): Promise<void> => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};
