import Storage from 'expo-sqlite/kv-store';

/** 小さな設定値を保存するキーバリューストア（ネイティブ: expo-sqlite の kv-store）。 */
export const kv = {
  get: (key: string): Promise<string | null> => Storage.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => Storage.setItemAsync(key, value),
  remove: async (key: string): Promise<void> => {
    await Storage.removeItemAsync(key);
  },
};
