/** Web ではブラウザの localStorage にセッションを保存する。保存失敗を握りつぶさない。 */
function getStorage(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('認証セッションの保存領域を利用できません。ブラウザーで開き直してください。');
  }
  // localStorage へのアクセス自体が SecurityError になる環境もあるため、呼び出し側で検出可能にする。
  return window.localStorage;
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return getStorage().getItem(key);
    } catch (error) {
      throw new Error(
        '認証セッションを読み取れません。ブラウザーのストレージ設定を確認してください。',
        {
          cause: error,
        },
      );
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      getStorage().setItem(key, value);
    } catch (error) {
      throw new Error(
        '認証セッションを保存できません。ブラウザーのストレージ容量・設定を確認してください。',
        {
          cause: error,
        },
      );
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      getStorage().removeItem(key);
    } catch (error) {
      throw new Error(
        '認証セッションを削除できません。ブラウザーのストレージ設定を確認してください。',
        {
          cause: error,
        },
      );
    }
  },
};
