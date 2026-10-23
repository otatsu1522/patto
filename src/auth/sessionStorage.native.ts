import * as SecureStore from 'expo-secure-store';
import { STORAGE } from '@/config/storage';

/**
 * Supabase セッションを Keychain / Keystore に保存する。
 * 新しいセッションを別キーに最後まで書き込んでから active ポインターを切り替え、
 * 書き込み失敗で有効な旧セッションを先に消してしまわないようにする。
 */
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;
const activeKey = (key: string) => `${key}.active`;
const versionPrefix = (key: string, version: string) => `${key}.v.${version}`;
const INACTIVE = 'inactive';

let mutationQueue: Promise<unknown> = Promise.resolve();
function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function splitUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const bytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (current && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function readChunks(prefix: string, required: boolean): Promise<string | null> {
  const rawCount = await SecureStore.getItemAsync(countKey(prefix));
  if (rawCount === null) {
    if (required) throw new Error('保存された認証セッションが不完全です。再ログインしてください。');
    return null;
  }

  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('保存された認証セッションの形式が不正です。再ログインしてください。');
  }

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(prefix, i));
    if (part === null) {
      throw new Error('保存された認証セッションが不完全です。再ログインしてください。');
    }
    parts.push(part);
  }
  return parts.join('');
}

async function cleanupChunks(prefix: string, fallbackCount = 0): Promise<void> {
  const rawCount = await SecureStore.getItemAsync(countKey(prefix));
  let count = fallbackCount;
  if (rawCount !== null) {
    const storedCount = Number(rawCount);
    if (Number.isSafeInteger(storedCount) && storedCount > 0) {
      count = Math.max(count, storedCount);
    }
  }
  // count キーが書き込めなかった途中データも、呼び出し側が把握する最大数まで掃除する。
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(prefix, i));
  }
  await SecureStore.deleteItemAsync(countKey(prefix));
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const active = await SecureStore.getItemAsync(activeKey(key));
    if (active !== null) {
      if (active === INACTIVE) return null;
      return readChunks(versionPrefix(key, active), true);
    }
    // 既存バージョンが保存した key.n / key.0... 形式を読み取る。
    return readChunks(key, false);
  },

  async setItem(key: string, value: string): Promise<void> {
    return serializeMutation(async () => {
      const previousActive = await SecureStore.getItemAsync(activeKey(key));
      const previousVersion = previousActive && previousActive !== INACTIVE ? previousActive : null;
      const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const stagedPrefix = versionPrefix(key, version);
      const chunks = splitUtf8Bytes(value, STORAGE.secureStoreChunkSize);

      // 先に新しい断片をすべて保存する。ここで失敗しても旧セッションは有効なまま。
      try {
        for (let i = 0; i < chunks.length; i++) {
          await SecureStore.setItemAsync(chunkKey(stagedPrefix, i), chunks[i]!);
        }
        await SecureStore.setItemAsync(countKey(stagedPrefix), String(chunks.length));
      } catch (error) {
        await cleanupChunks(stagedPrefix, chunks.length).catch(() => undefined);
        throw error;
      }

      // active ポインターの書き込み結果が例外だけでは判別できない場合、読み戻して確認する。
      try {
        await SecureStore.setItemAsync(activeKey(key), version);
      } catch (error) {
        let activeAfter: string | null;
        try {
          activeAfter = await SecureStore.getItemAsync(activeKey(key));
        } catch {
          // 切り替え結果が不明な間は、新しい断片を削除しない。旧セッションを壊さないことを優先する。
          throw new Error(
            '認証セッションの保存結果を確認できません。ストレージを確認してから再試行してください。',
            {
              cause: error,
            },
          );
        }
        if (activeAfter !== version) {
          await cleanupChunks(stagedPrefix, chunks.length).catch(() => undefined);
          throw error;
        }
      }

      // 新セッションは確定済み。旧データの掃除失敗で保存成功を失敗扱いにしない。
      if (previousVersion) {
        await cleanupChunks(versionPrefix(key, previousVersion)).catch(() => undefined);
      }
      await cleanupChunks(key).catch(() => undefined);
    });
  },

  async removeItem(key: string): Promise<void> {
    return serializeMutation(async () => {
      const active = await SecureStore.getItemAsync(activeKey(key));
      if (active !== null) {
        // INACTIVE マーカーを残し、旧形式のキーが残っても読み戻されないようにする。
        await SecureStore.setItemAsync(activeKey(key), INACTIVE);
        if (active !== INACTIVE) {
          await cleanupChunks(versionPrefix(key, active)).catch(() => undefined);
        }
        await cleanupChunks(key).catch(() => undefined);
        return;
      }

      // 旧形式のセッションも先に INACTIVE マーカーで無効化する。
      // count キーを先に消すと断片数が分からず、古いセッションの断片が残ってしまう。
      await SecureStore.setItemAsync(activeKey(key), INACTIVE);
      await cleanupChunks(key).catch(() => undefined);
    });
  },
};
