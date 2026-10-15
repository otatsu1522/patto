import { create } from 'zustand';
import { isSupabaseConfigured } from '@/config/env';
import { destroyLocalDb } from '@/db/sqliteDb';
import { normalizeEmail } from '@/domain/validation';
import { visibleProjects } from '@/domain/selectors';
import { t } from '@/i18n';
import { kv } from '@/lib/kv';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/sync/controller';
import { isNetworkError, mapAuthError } from './errors';
import { getSupabase } from './supabase';

const IDENTITY_KEY = 'patto:identity';
/** Supabase 未設定のときのゲストが使う、端末内だけのユーザーID */
const LOCAL_USER_ID = 'local';

export type AuthStatus = 'loading' | 'signedOut' | 'guest' | 'account';

/** 端末に保存する「誰として使っているか」。オフラインでも再ログイン不要にするための情報。 */
export interface Identity {
  mode: 'guest' | 'account';
  /** Supabase のユーザーID（ゲストは匿名ユーザーのID）。データの持ち主 */
  userId: string;
  email: string;
  displayName: string;
  /** Supabase を使わない端末内だけのゲスト（Supabase 未設定時） */
  local?: boolean;
}

export type AuthResult = { ok: true; message?: string } | { ok: false; message: string };

interface AuthState {
  status: AuthStatus;
  identity: Identity | null;
  /** ログインの有効期限切れなどで、再ログインが必要な状態 */
  needsReauth: boolean;

  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  continueAsGuest: () => Promise<AuthResult>;
  /** ゲストにメールとパスワードを紐付け、同じユーザーIDのままアカウントにする */
  upgradeGuest: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  leaveGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  reauthenticate: (password: string) => Promise<AuthResult>;
  changePassword: (current: string, next: string) => Promise<AuthResult>;
  changeEmail: (email: string) => Promise<AuthResult>;
  updateDisplayName: (name: string) => Promise<void>;
  deleteAccount: () => Promise<AuthResult>;
  setNeedsReauth: (v: boolean) => void;
}

const notConfigured = (): AuthResult => ({ ok: false, message: t('auth.notConfigured') });
const fail = (e: unknown, offlineMessage = t('auth.needOnlineFirst')): AuthResult => ({
  ok: false,
  message: isNetworkError(e) ? offlineMessage : mapAuthError(e),
});

type SbUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };
const displayNameOf = (u: SbUser): string => String(u.user_metadata?.display_name ?? '');

export const useAuthStore = create<AuthState>((set, get) => {
  async function persist(identity: Identity | null) {
    if (identity) await kv.set(IDENTITY_KEY, JSON.stringify(identity));
    else await kv.remove(IDENTITY_KEY);
  }

  /** この端末でこのユーザーとして使い始める（端末内DBを開き、状態を保存する）。 */
  async function enter(identity: Identity, options: { seedTutorial?: boolean } = {}) {
    await useDataStore.getState().open(identity.userId, identity.userId);

    // 新規登録・ゲスト開始では TUTORIAL を優先して選択する。
    const tutorialProjectId = options.seedTutorial
      ? await useDataStore.getState().seedTutorial()
      : null;
    const availableProjects = visibleProjects(useDataStore.getState().projects);
    const savedProjectId = useSettingsStore.getState().settings.lastProjectId;
    const savedProject = availableProjects.find((p) => p.id === savedProjectId);
    const initialProjectId =
      tutorialProjectId ?? savedProject?.id ?? availableProjects[0]?.id ?? null;

    // 保存済みのプロジェクトがこのユーザーのデータに存在しない場合も、先頭のプロジェクトへ合わせる。
    if (savedProjectId !== initialProjectId) {
      useSettingsStore.getState().update({ lastProjectId: initialProjectId });
    }

    await persist(identity);
    set({ identity, status: identity.mode, needsReauth: false });
  }

  /** 端末内のデータを消してログイン画面へ戻す。 */
  async function leave() {
    const identity = get().identity;
    await useDataStore.getState().close();
    if (identity) await destroyLocalDb(identity.userId);
    await persist(null);
    useSettingsStore.getState().update({ lastProjectId: null });
    set({ identity: null, status: 'signedOut', needsReauth: false });
  }

  async function signOutRemote() {
    try {
      await getSupabase()?.auth.signOut({ scope: 'local' });
    } catch {
      /* 端末側の情報だけ消えればよい */
    }
  }

  return {
    status: 'loading',
    identity: null,
    needsReauth: false,

    async bootstrap() {
      let identity: Identity | null = null;
      try {
        const raw = await kv.get(IDENTITY_KEY);
        identity = raw ? (JSON.parse(raw) as Identity) : null;
      } catch {
        identity = null;
      }
      // 通信せず、端末に保存した情報だけで判断する（オフラインでもそのままメイン画面へ）
      if (identity) await enter(identity);
      else set({ status: 'signedOut' });

      getSupabase()?.auth.onAuthStateChange((event, session) => {
        const current = get();
        if (event === 'SIGNED_OUT' && current.status === 'account' && !current.identity?.local) {
          set({ needsReauth: true });
        } else if (event === 'USER_UPDATED' && current.identity && session?.user.email) {
          const next = { ...current.identity, email: session.user.email };
          void persist(next);
          set({ identity: next });
        }
      });
    },

    async signIn(email, password) {
      const client = getSupabase();
      if (!client) return notConfigured();
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
        });
        if (error) return { ok: false, message: mapAuthError(error) };
        await enter({
          mode: 'account',
          userId: data.user.id,
          email: data.user.email ?? '',
          displayName: displayNameOf(data.user),
        });

        // 初めてこのアカウントを使う端末ではローカルDBが空の場合がある。
        // 同期が有効なら初回ログイン時に一度取り込み、先頭プロジェクトをすぐ選べるようにする。
        const hasLocalProjects = visibleProjects(useDataStore.getState().projects).length > 0;
        if (!hasLocalProjects && useSettingsStore.getState().settings.syncMode !== 'off') {
          await syncNow();
        }
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async signUp(email, password, displayName) {
      const client = getSupabase();
      if (!client) return notConfigured();
      try {
        const { data, error } = await client.auth.signUp({
          email: normalizeEmail(email),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) return { ok: false, message: mapAuthError(error) };
        if (!data.session || !data.user)
          return { ok: false, message: t('auth.error.signupFailed') };
        await enter(
          {
            mode: 'account',
            userId: data.user.id,
            email: data.user.email ?? '',
            displayName: displayName.trim(),
          },
          { seedTutorial: true },
        );
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async continueAsGuest() {
      const client = getSupabase();
      // Supabase 未設定: 端末内だけで使うゲスト
      if (!client) {
        await enter(
          { mode: 'guest', userId: LOCAL_USER_ID, email: '', displayName: '', local: true },
          { seedTutorial: true },
        );
        return { ok: true };
      }
      try {
        // 初回だけ通信して匿名ユーザーを作る。以降はオフラインでも使える
        const { data, error } = await client.auth.signInAnonymously();
        if (error || !data.user) return { ok: false, message: mapAuthError(error) };
        await enter(
          { mode: 'guest', userId: data.user.id, email: '', displayName: '' },
          { seedTutorial: true },
        );
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async upgradeGuest(email, password, displayName) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity || identity.mode !== 'guest' || identity.local)
        return notConfigured();
      try {
        const mail = normalizeEmail(email);
        // 1) 匿名ユーザーにメールアドレスを紐付ける
        const step1 = await client.auth.updateUser({
          email: mail,
          data: { display_name: displayName.trim() },
        });
        if (step1.error) return { ok: false, message: mapAuthError(step1.error) };
        // メール確認が必要な設定だと、メールが反映されずに「確認待ち」のままになる
        const applied = step1.data.user.email === mail && !step1.data.user.new_email;
        if (!applied) return { ok: false, message: t('auth.error.upgradeBlocked') };
        // 2) パスワードを設定する
        const step2 = await client.auth.updateUser({ password });
        if (step2.error) return { ok: false, message: mapAuthError(step2.error) };
        const next: Identity = {
          mode: 'account',
          userId: identity.userId,
          email: mail,
          displayName: displayName.trim(),
        };
        await persist(next);
        set({ identity: next, status: 'account' });
        return { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      }
    },

    async leaveGuest() {
      const identity = get().identity;
      // サーバー側のゲストのデータも消す（オンラインのときのみ。できなくても端末側は消す）
      if (identity && !identity.local) {
        try {
          await getSupabase()?.functions.invoke('delete-account');
        } catch {
          /* オフラインなど */
        }
        await signOutRemote();
      }
      await leave();
    },

    async signOut() {
      await signOutRemote();
      await leave();
    },

    async reauthenticate(password) {
      const identity = get().identity;
      if (!identity?.email) return notConfigured();
      const res = await get().signIn(identity.email, password);
      if (res.ok) set({ needsReauth: false });
      return res;
    },

    async changePassword(current, next) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity?.email) return notConfigured();
      try {
        const check = await client.auth.signInWithPassword({
          email: identity.email,
          password: current,
        });
        if (check.error) return { ok: false, message: mapAuthError(check.error) };
        const { error } = await client.auth.updateUser({ password: next });
        return error ? { ok: false, message: mapAuthError(error) } : { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      }
    },

    async changeEmail(email) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity || identity.local || identity.mode !== 'account')
        return notConfigured();
      try {
        const normalized = normalizeEmail(email);
        const { data, error } = await client.auth.updateUser({ email: normalized });
        if (error) return { ok: false, message: mapAuthError(error) };
        if (data.user.new_email) {
          return { ok: true, message: t('settings.emailChangePending') };
        }
        const next = { ...identity, email: data.user.email ?? normalized };
        await persist(next);
        set({ identity: next });
        return { ok: true, message: t('settings.emailChanged') };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      }
    },

    async updateDisplayName(name) {
      const identity = get().identity;
      if (!identity) return;
      const next = { ...identity, displayName: name.trim() };
      await persist(next);
      set({ identity: next });
      if (!identity.local) {
        try {
          await getSupabase()?.auth.updateUser({ data: { display_name: next.displayName } });
        } catch {
          /* オフライン時は端末内のみ更新 */
        }
      }
    },

    async deleteAccount() {
      const client = getSupabase();
      if (!client) return notConfigured();
      try {
        const { error } = await client.functions.invoke('delete-account');
        if (error) return { ok: false, message: mapAuthError(error) };
        await get().signOut();
        return { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      }
    },

    setNeedsReauth: (v) => set({ needsReauth: v }),
  };
});

export { isSupabaseConfigured };
