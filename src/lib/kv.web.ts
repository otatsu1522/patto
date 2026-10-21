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
      /* 通常設定の保存失敗は既存どおり無視する。重要な記録には setRequired を使う。 */
    }
  },
  remove: async (key: string): Promise<void> => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
  getRequired: async (key: string): Promise<string | null> => window.localStorage.getItem(key),
  setRequired: async (key: string, value: string): Promise<void> => {
    window.localStorage.setItem(key, value);
  },
  removeRequired: async (key: string): Promise<void> => {
    window.localStorage.removeItem(key);
  },
};
