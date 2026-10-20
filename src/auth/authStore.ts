import { create } from 'zustand';
import {
  acquireAccountWork,
  beginAccountShutdown,
  endAccountShutdown,
  isAccountShutdownInProgress,
} from './accountWork';
import { isSupabaseConfigured } from '@/config/env';
import { TIMING } from '@/config/timing';
import { normalizeEmail } from '@/domain/validation';
import { visibleProjects } from '@/domain/selectors';
import { t } from '@/i18n';
import { kv } from '@/lib/kv';
import { destroyLocalDbWhenUnused, useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  resumeSyncAfterAccountExit,
  syncNow,
  waitForSyncBeforeAccountExit,
} from '@/sync/controller';
import { isAuthRequiredError, isNetworkError, mapAuthError } from './errors';
import { createSyncSupabaseClient, getFreshSession, getSupabase } from './supabase';

const IDENTITY_KEY = 'patto:identity';
const NEEDS_REAUTH_KEY = 'patto:needs-reauth';
const LOGIN_SYNC_PENDING_KEY = 'patto:login-sync-pending';
let bootstrapInFlight: Promise<void> | null = null;
let bootstrapGeneration = 0;
let authListenerAttached = false;
const identityRefreshInFlight = new Map<string, Promise<void>>();
let needsReauthPersistence: Promise<void> = Promise.resolve();
let identityPersistence: Promise<void> = Promise.resolve();
/** Supabase 未設定のときのゲストが使う、端末内だけのユーザーID */
const LOCAL_USER_ID = 'local';

export type AuthStatus = 'loading' | 'signedOut' | 'guest' | 'account' | 'error';

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
  /** 起動処理に失敗した場合の表示用メッセージ。 */
  bootstrapError: string | null;

  bootstrap: () => Promise<void>;
  setBootstrapError: (message: string | null) => void;
  /** サーバーの最新 user_metadata / email を取得して他端末の変更を反映する。 */
  refreshRemoteIdentity: () => Promise<void>;
  signIn: (
    email: string,
    password: string,
    options?: { syncAfterLogin?: boolean },
  ) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  continueAsGuest: () => Promise<AuthResult>;
  /** ゲストにメールとパスワードを紐付け、同じユーザーIDのままアカウントにする */
  upgradeGuest: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  leaveGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  reauthenticate: (password: string) => Promise<AuthResult>;
  changePassword: (current: string, next: string) => Promise<AuthResult>;
  changeEmail: (email: string) => Promise<AuthResult>;
  updateDisplayName: (name: string) => Promise<AuthResult>;
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
    const operation = identityPersistence.then(async () => {
      if (identity) await kv.set(IDENTITY_KEY, JSON.stringify(identity));
      else await kv.remove(IDENTITY_KEY);
    });
    identityPersistence = operation.catch(() => {});
    await operation;
  }

  /** 再認証要求は、リロードで消えてしまわないよう端末にも保存する。 */
  function setNeedsReauthPersisted(required: boolean) {
    set({ needsReauth: required });
    // 非同期ストレージへの書き込み順を保ち、直前の値で上書きされないようにする。
    needsReauthPersistence = needsReauthPersistence
      .then(async () => {
        if (required) await kv.set(NEEDS_REAUTH_KEY, '1');
        else await kv.remove(NEEDS_REAUTH_KEY);
      })
      .catch(() => {});
  }

  /** この端末でこのユーザーとして使い始める（端末内DBを開き、状態を保存する）。 */
  async function enter(
    identity: Identity,
    options: { seedTutorial?: boolean; isCurrent?: () => boolean; deferStatus?: boolean } = {},
  ) {
    const currentIdentity = get().identity;
    if (currentIdentity && currentIdentity.userId !== identity.userId) {
      throw new Error(t('auth.logoutBeforeSwitch'));
    }
    if (currentIdentity && isAccountShutdownInProgress(currentIdentity.userId)) {
      throw new Error(t('settings.accountLeaving'));
    }
    await useDataStore.getState().open(identity.userId, identity.userId);
    if (options.isCurrent && !options.isCurrent()) return;
    if (isAccountShutdownInProgress(identity.userId)) return;

    // 新規登録・ゲスト開始では TUTORIAL を優先して選択する。
    const tutorialProjectId = options.seedTutorial
      ? await useDataStore.getState().seedTutorial()
      : null;
    if (options.isCurrent && !options.isCurrent()) return;
    if (isAccountShutdownInProgress(identity.userId)) return;
    const availableProjects = visibleProjects(useDataStore.getState().projects);
    const savedProjectId = useSettingsStore.getState().settings.lastProjectId;
    const savedProject = availableProjects.find((p) => p.id === savedProjectId);
    const initialProjectId =
      tutorialProjectId ?? savedProject?.id ?? availableProjects[0]?.id ?? null;

    // 保存済みのプロジェクトがこのユーザーのデータに存在しない場合も、先頭のプロジェクトへ合わせる。
    if (options.isCurrent && !options.isCurrent()) return;
    if (savedProjectId !== initialProjectId) {
      useSettingsStore.getState().update({ lastProjectId: initialProjectId });
    }

    await persist(identity);
    if (options.isCurrent && !options.isCurrent()) return;
    if (isAccountShutdownInProgress(identity.userId)) return;
    set({
      identity,
      // ログイン直後にクラウドデータを取り込む場合、画面を先に表示しない。
      status: options.deferStatus ? 'loading' : identity.mode,
      needsReauth: false,
      bootstrapError: null,
    });
  }

  async function clearLocalIdentity() {
    await persist(null);
    await kv.remove(LOGIN_SYNC_PENDING_KEY);
    setNeedsReauthPersisted(false);
    useSettingsStore.getState().update({ lastProjectId: null });
    set({ identity: null, status: 'signedOut', needsReauth: false });
  }

  async function signOutRemote(expectedUserId: string | null) {
    const client = getSupabase();
    if (!client) return;
    try {
      // 共有セッションが別アカウントに変わっている場合、そのユーザーを誤ってサインアウトしない。
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return;
      if (expectedUserId && data.session.user.id !== expectedUserId) return;
      await client.auth.signOut({ scope: 'local' });
    } catch {
      /* 端末側の情報だけ消えればよい */
    }
  }

  type AccountExitAction = 'signOut' | 'leaveGuest' | 'deleteAccount';
  let accountExitInFlight: Promise<AuthResult> | null = null;
  let accountEntryInFlight = false;

  /**
   * ログアウト／アカウント離脱を直列化する。
   * 先に新規同期と新しいアカウント作業の受付を閉じ、実行中の作業を待ってから
   * ローカルDBの close/delete と Supabase の signOut を行う。
   * すでに実行中の同期やアカウント操作はキャンセルしない。
   */
  async function performAccountExit(action: AccountExitAction): Promise<AuthResult> {
    const identity = get().identity;
    if (
      action === 'deleteAccount' &&
      (!identity || identity.local || identity.mode !== 'account')
    ) {
      return notConfigured();
    }
    if (action === 'leaveGuest' && (!identity || identity.mode !== 'guest')) {
      return notConfigured();
    }

    set({ status: 'loading' });
    const accountShutdown = identity ? beginAccountShutdown(identity.userId) : Promise.resolve();
    // この呼び出しは await より前に受付を閉じる。稼働中の同期そのものは完了まで待つ。
    const syncShutdown = waitForSyncBeforeAccountExit();

    try {
      await Promise.all([accountShutdown, syncShutdown]);

      if (action === 'deleteAccount') {
        const client = getSupabase();
        if (!client) {
          if (identity) set({ identity, status: identity.mode });
          return notConfigured();
        }
        const session = identity ? await getFreshSession(client, identity.userId) : null;
        if (!identity || !session || !session.access_token) {
          if (identity) set({ identity, status: identity.mode });
          return { ok: false, message: t('auth.sessionMismatch') };
        }
        // Edge Function も開始時の認証トークンに固定する。共有セッションが変わっても別ユーザーを削除しない。
        const scopedClient = createSyncSupabaseClient(session.access_token);
        const { error } = await scopedClient.functions.invoke('delete-account');
        if (error) {
          if (identity) set({ identity, status: identity.mode });
          return { ok: false, message: mapAuthError(error) };
        }
      } else if (action === 'leaveGuest' && identity && !identity.local) {
        // ゲスト終了時は本人のセッションを確認してからサーバー削除を試みる。
        // オフラインやセッション不一致時も、従来どおり端末からの退出は続ける。
        try {
          const client = getSupabase();
          if (client) {
            const session = await getFreshSession(client, identity.userId);
            if (session?.access_token) {
              const scopedClient = createSyncSupabaseClient(session.access_token);
              await scopedClient.functions.invoke('delete-account');
            }
          }
        } catch {
          /* オフラインなど */
        }
      }

      // すべての既存作業が終わってから DB を閉じ、ユーザー単位のファイルを削除する。
      try {
        await useDataStore.getState().close();
      } catch {
        // 認証情報を残したままサインアウトだけが失敗することを避ける。
      }
      if (identity) {
        try {
          await destroyLocalDbWhenUnused(identity.userId);
        } catch {
          // DB エラーがあってもセッションの終了とローカル認証情報の消去は続ける。
        }
      }
      await signOutRemote(identity?.userId ?? null);
      await clearLocalIdentity();
      return { ok: true };
    } catch (error) {
      // 破棄前に失敗した場合は、現在のアカウントを画面に戻す。
      if (identity && get().identity?.userId === identity.userId) {
        set({ identity, status: identity.mode });
      }
      return { ok: false, message: mapAuthError(error) };
    } finally {
      resumeSyncAfterAccountExit();
      if (identity) endAccountShutdown(identity.userId);
    }
  }

  function exitAccount(action: AccountExitAction): Promise<AuthResult> {
    if (accountExitInFlight) return accountExitInFlight;
    if (accountEntryInFlight) {
      return Promise.resolve({ ok: false, message: t('settings.accountLeaving') });
    }
    const operation = performAccountExit(action);
    accountExitInFlight = operation;
    void operation.then(
      () => {
        if (accountExitInFlight === operation) accountExitInFlight = null;
      },
      () => {
        if (accountExitInFlight === operation) accountExitInFlight = null;
      },
    );
    return operation;
  }

  return {
    status: 'loading',
    identity: null,
    needsReauth: false,
    bootstrapError: null,

    async bootstrap() {
      // React Strict Mode などで bootstrap が重複しても DB を二重に開かない。
      if (bootstrapInFlight) return bootstrapInFlight;
      const generation = ++bootstrapGeneration;
      set({ status: 'loading', bootstrapError: null });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        const [raw, savedNeedsReauth, pendingLoginSync] = await Promise.all([
          kv.get(IDENTITY_KEY),
          kv.get(NEEDS_REAUTH_KEY),
          kv.get(LOGIN_SYNC_PENDING_KEY),
        ]);
        let identity: Identity | null = null;
        try {
          const parsed = raw ? (JSON.parse(raw) as Partial<Identity>) : null;
          if (
            parsed &&
            (parsed.mode === 'guest' || parsed.mode === 'account') &&
            typeof parsed.userId === 'string' &&
            typeof parsed.email === 'string' &&
            typeof parsed.displayName === 'string'
          )
            identity = parsed as Identity;
        } catch {
          identity = null;
        }
        if (generation !== bootstrapGeneration) return;

        // 通信せず、端末に保存した情報だけで判断する（オフラインでも起動できる）。
        if (identity) {
          const shouldFinishLoginSync =
            pendingLoginSync === '1' &&
            identity.mode === 'account' &&
            !identity.local &&
            useSettingsStore.getState().settings.syncMode === 'auto';
          await enter(identity, {
            isCurrent: () => generation === bootstrapGeneration,
            deferStatus: shouldFinishLoginSync,
          });
          if (shouldFinishLoginSync) {
            try {
              const synced = await syncNow({ force: true, throwOnError: true });
              if (!synced) throw new Error(t('auth.needOnlineFirst'));
              await kv.remove(LOGIN_SYNC_PENDING_KEY);
              if (generation === bootstrapGeneration) {
                set({ identity, status: identity.mode, bootstrapError: null });
              }
            } catch {
              // ログイン時の同期が完了しない間は、空のプロジェクト一覧を表示しない。
              throw new Error(t('auth.needOnlineFirst'));
            }
          } else if (pendingLoginSync === '1') {
            await kv.remove(LOGIN_SYNC_PENDING_KEY);
          }
          // 再認証の要否はデータ同期モードとは独立して復元する。
          if (savedNeedsReauth === '1' && identity.mode === 'account' && !identity.local) {
            set({ needsReauth: true });
          } else if (savedNeedsReauth === '1') {
            setNeedsReauthPersisted(false);
          }
        } else {
          set({ status: 'signedOut', bootstrapError: null });
          if (savedNeedsReauth === '1') setNeedsReauthPersisted(false);
        }

        if (generation !== bootstrapGeneration) return;
        const client = getSupabase();
        if (client && !authListenerAttached) {
          authListenerAttached = true;
          client.auth.onAuthStateChange((event, session) => {
            const current = get();
            if (
              event === 'INITIAL_SESSION' &&
              current.identity?.mode === 'account' &&
              !current.identity.local
            ) {
              // セッションがない／別ユーザーなら再認証を要求し、その状態をリロード後も維持する。
              // セッションが存在するだけでは、直前に発生した認証エラーが解消したとは判断しない。
              if (!session || session.user.id !== current.identity.userId) {
                get().setNeedsReauth(true);
              }
            } else if (
              event === 'SIGNED_OUT' &&
              current.status === 'account' &&
              !current.identity?.local
            ) {
              get().setNeedsReauth(true);
            } else if (
              event === 'USER_UPDATED' &&
              current.identity &&
              session?.user.id === current.identity.userId
            ) {
              const next = {
                ...current.identity,
                email: session.user.email ?? current.identity.email,
                displayName: displayNameOf(session.user),
              };
              void persist(next);
              set({ identity: next });
            }
          });
        }
      })();

      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(t('app.startupTimeout'))),
          TIMING.authBootstrapTimeoutMs,
        );
      });
      let operation: Promise<void>;
      operation = Promise.race([work, timeout])
        .catch((error: unknown) => {
          // タイムアウト後に遅れて完了した処理が状態を上書きしないよう無効化する。
          bootstrapGeneration += 1;
          const message = error instanceof Error ? error.message : t('app.startupErrorMessage');
          set({ status: 'error', bootstrapError: message });
        })
        .finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
          if (bootstrapInFlight === operation) bootstrapInFlight = null;
        });
      bootstrapInFlight = operation;
      return operation;
    },

    setBootstrapError(message) {
      if (message !== null) bootstrapGeneration += 1;
      set(
        message === null
          ? { status: 'loading', bootstrapError: null }
          : { status: 'error', bootstrapError: message },
      );
    },

    async refreshRemoteIdentity() {
      const identity = get().identity;
      // getUser() は Supabase Auth への HTTP 通信。自動同期中の実アカウントに限って実行する。
      if (!identity || identity.mode !== 'account' || identity.local) return;
      const isCurrentAccountCheck = () => {
        const currentIdentity = get().identity;
        const dataState = useDataStore.getState();
        return (
          useSettingsStore.getState().settings.syncMode === 'auto' &&
          currentIdentity?.mode === 'account' &&
          !currentIdentity.local &&
          currentIdentity.userId === identity.userId &&
          dataState.ready &&
          dataState.ownerId === identity.userId
        );
      };
      if (!isCurrentAccountCheck()) return;
      const inFlight = identityRefreshInFlight.get(identity.userId);
      if (inFlight) return inFlight;
      const client = getSupabase();
      if (!client) return;
      const releaseWork = acquireAccountWork(identity.userId);
      if (!releaseWork) return;
      const request = (async () => {
        try {
          const session = await getFreshSession(client, identity.userId);
          if (!isCurrentAccountCheck()) return;
          if (!session) {
            get().setNeedsReauth(true);
            return;
          }
          const { data, error } = await client.auth.getUser();
          // モード変更／アカウント切り替え後に届いた応答で、新しい状態を上書きしない。
          if (!isCurrentAccountCheck()) return;
          if (error) {
            if (isAuthRequiredError(error)) get().setNeedsReauth(true);
            return;
          }
          if (!data.user || data.user.id !== identity.userId) {
            get().setNeedsReauth(true);
            return;
          }
          const latest: Identity = {
            ...identity,
            email: data.user.email ?? identity.email,
            displayName: displayNameOf(data.user),
          };
          if (latest.email === identity.email && latest.displayName === identity.displayName) {
            return;
          }
          await persist(latest);
          if (isCurrentAccountCheck()) set({ identity: latest });
        } catch {
          // オフラインでは端末内の表示を維持し、次回の前景復帰時に再取得する。
        } finally {
          releaseWork();
        }
      })();
      identityRefreshInFlight.set(identity.userId, request);
      try {
        await request;
      } finally {
        if (identityRefreshInFlight.get(identity.userId) === request) {
          identityRefreshInFlight.delete(identity.userId);
        }
      }
    },

    async signIn(email, password, options = {}) {
      if (accountExitInFlight || accountEntryInFlight) {
        return { ok: false, message: t('settings.accountLeaving') };
      }
      const currentIdentity = get().identity;
      const normalizedEmail = normalizeEmail(email);
      const isReauthentication =
        options.syncAfterLogin === false &&
        currentIdentity?.mode === 'account' &&
        !currentIdentity.local &&
        normalizeEmail(currentIdentity.email) === normalizedEmail;
      if (currentIdentity && !isReauthentication) {
        return { ok: false, message: t('auth.logoutBeforeSwitch') };
      }
      let releaseWork = currentIdentity ? acquireAccountWork(currentIdentity.userId) : null;
      if (currentIdentity && !releaseWork) {
        return { ok: false, message: t('settings.accountLeaving') };
      }
      const client = getSupabase();
      if (!client) {
        releaseWork?.();
        return notConfigured();
      }
      const ownsEntrySlot = !currentIdentity;
      if (ownsEntrySlot) accountEntryInFlight = true;
      const syncAfterLogin = options.syncAfterLogin !== false;
      let waitingForInitialSync = false;
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) return { ok: false, message: mapAuthError(error) };
        if (currentIdentity && isAccountShutdownInProgress(currentIdentity.userId)) {
          return { ok: false, message: t('settings.accountLeaving') };
        }
        const identity: Identity = {
          mode: 'account',
          userId: data.user.id,
          email: data.user.email ?? '',
          displayName: displayNameOf(data.user),
        };
        if (currentIdentity && identity.userId !== currentIdentity.userId) {
          return { ok: false, message: t('auth.logoutBeforeSwitch') };
        }
        if (!releaseWork) {
          releaseWork = acquireAccountWork(identity.userId);
          if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
        }
        await enter(identity, { deferStatus: syncAfterLogin });
        if (isAccountShutdownInProgress(identity.userId)) {
          return { ok: false, message: t('settings.accountLeaving') };
        }
        get().setNeedsReauth(false);

        if (syncAfterLogin) {
          waitingForInitialSync = true;
          await kv.set(LOGIN_SYNC_PENDING_KEY, '1');
          const synced = await syncNow({ force: true, throwOnError: true });
          if (!synced) throw new Error(t('auth.needOnlineFirst'));
          await kv.remove(LOGIN_SYNC_PENDING_KEY);
          if (!isAccountShutdownInProgress(identity.userId)) {
            set({ identity, status: 'account', needsReauth: false, bootstrapError: null });
          }
        }
        return { ok: true };
      } catch (e) {
        if (waitingForInitialSync) {
          if (get().identity && isAccountShutdownInProgress(get().identity!.userId)) {
            return { ok: false, message: t('settings.accountLeaving') };
          }
          // 同期が失敗した状態でアプリを表示すると、既存プロジェクトがないように見えてしまう。
          set({ status: 'error', bootstrapError: t('auth.needOnlineFirst') });
          return { ok: false, message: t('auth.needOnlineFirst') };
        }
        return fail(e);
      } finally {
        releaseWork?.();
        if (ownsEntrySlot) accountEntryInFlight = false;
      }
    },

    async signUp(email, password, displayName) {
      if (accountExitInFlight || accountEntryInFlight) {
        return { ok: false, message: t('settings.accountLeaving') };
      }
      if (get().identity) return { ok: false, message: t('auth.logoutBeforeSwitch') };
      const client = getSupabase();
      if (!client) return notConfigured();
      accountEntryInFlight = true;
      let releaseWork: (() => void) | null = null;
      try {
        const { data, error } = await client.auth.signUp({
          email: normalizeEmail(email),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) return { ok: false, message: mapAuthError(error) };
        if (!data.session || !data.user)
          return { ok: false, message: t('auth.error.signupFailed') };
        releaseWork = acquireAccountWork(data.user.id);
        if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
        await enter(
          {
            mode: 'account',
            userId: data.user.id,
            email: data.user.email ?? '',
            displayName: displayName.trim(),
          },
          { seedTutorial: true },
        );
        get().setNeedsReauth(false);
        return { ok: true };
      } catch (e) {
        return fail(e);
      } finally {
        releaseWork?.();
        accountEntryInFlight = false;
      }
    },

    async continueAsGuest() {
      if (accountExitInFlight || accountEntryInFlight) {
        return { ok: false, message: t('settings.accountLeaving') };
      }
      if (get().identity) return { ok: false, message: t('auth.logoutBeforeSwitch') };
      const client = getSupabase();
      accountEntryInFlight = true;
      let releaseWork: (() => void) | null = null;
      try {
        // Supabase 未設定: 端末内だけのゲスト。
        if (!client) {
          releaseWork = acquireAccountWork(LOCAL_USER_ID);
          if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
          await enter(
            { mode: 'guest', userId: LOCAL_USER_ID, email: '', displayName: '', local: true },
            { seedTutorial: true },
          );
          get().setNeedsReauth(false);
          return { ok: true };
        }

        // Supabase 設定済み環境では初回だけ匿名ユーザー作成の通信が必要。
        const { data, error } = await client.auth.signInAnonymously();
        if (error || !data.user) return { ok: false, message: mapAuthError(error) };
        releaseWork = acquireAccountWork(data.user.id);
        if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
        await enter(
          { mode: 'guest', userId: data.user.id, email: '', displayName: '' },
          { seedTutorial: true },
        );
        get().setNeedsReauth(false);
        return { ok: true };
      } catch (e) {
        return fail(e);
      } finally {
        releaseWork?.();
        accountEntryInFlight = false;
      }
    },

    async upgradeGuest(email, password, displayName) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity || identity.mode !== 'guest' || identity.local)
        return notConfigured();
      const releaseWork = acquireAccountWork(identity.userId);
      if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
      try {
        const mail = normalizeEmail(email);
        // 1) 匿名ユーザーにメールアドレスを紐付ける
        const session = await getFreshSession(client, identity.userId);
        if (!session) return { ok: false, message: t('auth.sessionMismatch') };
        const step1 = await client.auth.updateUser({
          email: mail,
          data: { display_name: displayName.trim() },
        });
        if (step1.error) return { ok: false, message: mapAuthError(step1.error) };
        // メール確認が必要な設定だと、メールが反映されずに「確認待ち」のままになる
        const applied = step1.data.user.email === mail && !step1.data.user.new_email;
        if (!applied) return { ok: false, message: t('auth.error.upgradeBlocked') };
        // 2) パスワードを設定する
        const currentSession = await getFreshSession(client, identity.userId);
        if (!currentSession) return { ok: false, message: t('auth.sessionMismatch') };
        const step2 = await client.auth.updateUser({ password });
        if (step2.error) return { ok: false, message: mapAuthError(step2.error) };
        get().setNeedsReauth(false);
        const next: Identity = {
          mode: 'account',
          userId: identity.userId,
          email: mail,
          displayName: displayName.trim(),
        };
        await persist(next);
        set({
          identity: next,
          status: isAccountShutdownInProgress(identity.userId) ? 'loading' : 'account',
        });
        return { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      } finally {
        releaseWork();
      }
    },

    async leaveGuest() {
      await exitAccount('leaveGuest');
    },

    async signOut() {
      await exitAccount('signOut');
    },

    async reauthenticate(password) {
      const identity = get().identity;
      if (!identity?.email) return notConfigured();
      const res = await get().signIn(identity.email, password, { syncAfterLogin: false });
      if (res.ok) get().setNeedsReauth(false);
      return res;
    },

    async changePassword(current, next) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity || identity.local || identity.mode !== 'account')
        return notConfigured();
      const releaseWork = acquireAccountWork(identity.userId);
      if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
      try {
        // 明示されたアカウント編集操作の一部として、期限切れ間近のセッションだけ更新する。
        const session = await getFreshSession(client, identity.userId);
        if (!session) return { ok: false, message: t('auth.sessionMismatch') };
        // Supabase Auth で現在のパスワードを検証し、そのまま新しいパスワードへ変更する。
        const { error } = await client.auth.updateUser({
          password: next,
          current_password: current,
        });
        if (error) {
          const code = (error.code ?? '').toLowerCase();
          const message = error.message.toLowerCase();
          if (code === 'current_password_mismatch' || message.includes('current password')) {
            return { ok: false, message: t('settings.currentPasswordIncorrect') };
          }
          if (
            code === 'same_password' ||
            message.includes('same password') ||
            message.includes('different from the old password')
          ) {
            return {
              ok: false,
              message: t('settings.passwordMustDiffer'),
            };
          }
          return { ok: false, message: mapAuthError(error) };
        }
        return { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      } finally {
        releaseWork();
      }
    },

    async changeEmail(email) {
      const client = getSupabase();
      const identity = get().identity;
      if (!client || !identity || identity.local || identity.mode !== 'account')
        return notConfigured();
      const releaseWork = acquireAccountWork(identity.userId);
      if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
      try {
        const normalized = normalizeEmail(email);
        const session = await getFreshSession(client, identity.userId);
        if (!session) return { ok: false, message: t('auth.sessionMismatch') };
        // Auth の通常 updateUser({ email }) は確認メールを伴うため、認証済みの呼び出し元を
        // Edge Function 側で検証し、Admin API で本人のメールアドレスを直接更新する。
        const { data, error } = await client.functions.invoke<{ email?: string }>('change-email', {
          body: { email: normalized },
        });
        if (error) {
          const response = (error as { context?: Response }).context;
          if (response && typeof response.clone === 'function') {
            try {
              const payload = (await response.clone().json()) as {
                code?: string;
                message?: string;
              };
              if (payload.code === 'email_in_use')
                return { ok: false, message: t('auth.error.userExists') };
              if (payload.message) return { ok: false, message: payload.message };
            } catch {
              // HTTP 応答が JSON でない場合は通常のエラー変換へ進む。
            }
          }
          return { ok: false, message: mapAuthError(error) };
        }
        const updatedEmail = data?.email ?? normalized;
        const next = { ...identity, email: updatedEmail };
        await persist(next);
        set({ identity: next });
        return { ok: true, message: t('settings.emailChanged') };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      } finally {
        releaseWork();
      }
    },

    async updateDisplayName(name) {
      const identity = get().identity;
      if (!identity) return notConfigured();
      const releaseWork = acquireAccountWork(identity.userId);
      if (!releaseWork) return { ok: false, message: t('settings.accountLeaving') };
      const normalized = name.trim();
      try {
        let next: Identity = { ...identity, displayName: normalized };
        if (!identity.local) {
          const client = getSupabase();
          if (!client) return notConfigured();
          const session = await getFreshSession(client, identity.userId);
          if (!session) return { ok: false, message: t('auth.sessionMismatch') };
          // 先にサーバーへ保存し、失敗したのに端末だけ成功表示になることを防ぐ。
          const { data, error } = await client.auth.updateUser({
            data: { display_name: normalized },
          });
          if (error) return { ok: false, message: mapAuthError(error) };
          next = {
            ...next,
            email: data.user.email ?? identity.email,
            displayName: displayNameOf(data.user),
          };
        }
        await persist(next);
        set({ identity: next });
        return { ok: true };
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      } finally {
        releaseWork();
      }
    },

    async deleteAccount() {
      const client = getSupabase();
      if (!client) return notConfigured();
      try {
        return await exitAccount('deleteAccount');
      } catch (e) {
        return fail(e, t('settings.onlineOnly'));
      }
    },

    setNeedsReauth: (v) => setNeedsReauthPersisted(v),
  };
});

export { isSupabaseConfigured };
