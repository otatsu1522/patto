import { Slot } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import { UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import { FeedbackProvider } from '@/components/ui/FeedbackProvider';
import { ScreenFrame } from '@/components/ui/ScreenFrame';
import { SystemBars } from '@/components/ui/SystemBars';
import { MenuProvider } from '@/components/ui/MenuHost';
import { autoPurgeLocal } from '@/features/maintenance';
import { nowMs } from '@/lib/clock';
import { getDb, useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { configureSync, startAutoSync } from '@/sync/controller';
import { useSyncStore } from '@/sync/status';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import { SPACING, ThemeProvider, useTheme } from '@/theme';

/**
 * Web版の expo-sqlite は SharedArrayBuffer が必要で、ページが「クロスオリジン分離」されている必要がある。
 * 本番は public/_headers のヘッダーで満たされる。開発サーバーは「/」だけヘッダーが付かないため、
 * 分離されていない状態で「/」を開いたときは、ヘッダーの付く /login から読み込み直す（1回だけ）。
 */
const isolated = (): boolean =>
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false;
const RETRY_KEY = 'patto:isolation-retry';
if (
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  !isolated() &&
  window.location.pathname === '/'
) {
  if (!window.sessionStorage.getItem(RETRY_KEY)) {
    window.sessionStorage.setItem(RETRY_KEY, '1');
    window.location.replace('/login');
  }
}

function Boot() {
  const { colors } = useTheme();
  const loaded = useSettingsStore((s) => s.loaded);
  const status = useAuthStore((s) => s.status);
  const needsReauth = useAuthStore((s) => s.needsReauth);
  const bootstrapError = useAuthStore((s) => s.bootstrapError);
  const remoteAccountId = useAuthStore((s) =>
    s.identity?.mode === 'account' && !s.identity.local ? s.identity.userId : null,
  );
  const ready = useDataStore((s) => s.ready);
  const ownerId = useAuthStore((s) => s.identity?.userId);
  const isLocal = useAuthStore((s) => !!s.identity?.local);
  const syncMode = useSettingsStore((s) => s.settings.syncMode);
  const autoDelete = useSettingsStore((s) => s.settings.trashAutoDelete);
  const retention = useSettingsStore((s) => s.settings.trashRetentionDays);

  // システムバーの背後にあるネイティブ Root View 背景を、アプリのテーマに同期する。
  // Root View の背景色をテーマに同期する。各画面／Modal のシステムバー表示は SystemBars に統一する。
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {
      // 未対応環境では SystemBars が描画する上下の背景 View に任せる。
    });
  }, [colors.bg]);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (cancelled || useAuthStore.getState().status !== 'loading') return;
      timedOut = true;
      useAuthStore.getState().setBootstrapError(t('app.startupTimeout'));
    }, TIMING.startupTimeoutMs);

    void (async () => {
      try {
        await useSettingsStore.getState().load();
        if (cancelled || timedOut) return;
        await useAuthStore.getState().bootstrap();
      } catch (error) {
        if (cancelled) return;
        useAuthStore
          .getState()
          .setBootstrapError(error instanceof Error ? error.message : t('app.startupErrorMessage'));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // 同期状態はアカウントごとに表示し、切り替え前の状態を引き継がない。
  // 最終同期時刻はローカルDBから読むため、オフ／手動モードでも通信は発生しない。
  useEffect(() => {
    useSyncStore
      .getState()
      .set({ status: 'idle', activeSource: null, lastSyncedAt: null, error: null });
    if (!ready || !ownerId) return;
    let cancelled = false;
    void getDb()
      .getMeta('lastSyncedAt')
      .then((value) => {
        if (cancelled) return;
        const identity = useAuthStore.getState().identity;
        const dataState = useDataStore.getState();
        if (identity?.userId === ownerId && dataState.ready && dataState.ownerId === ownerId) {
          useSyncStore.getState().set({ lastSyncedAt: value ? Number(value) : null });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ownerId, ready]);

  // アカウント情報の確認はサーバー通信を伴うため、自動同期モードのアカウントだけに限定する。
  // 60秒ごとのポーリングは行わず、起動時とバックグラウンドからの復帰時にだけ確認する。
  // ゲスト、オフ、手動では、表示用のアカウント情報確認を理由とした通信を行わない。
  useEffect(() => {
    if (syncMode !== 'auto' || !remoteAccountId || !isSupabaseConfigured || needsReauth) return;

    const isForeground = () =>
      Platform.OS === 'web'
        ? typeof document !== 'undefined' && document.visibilityState === 'visible'
        : AppState.currentState === 'active';
    let wasForeground = isForeground();
    if (wasForeground) void useAuthStore.getState().refreshRemoteIdentity();

    const handleForegroundChange = () => {
      const foreground = isForeground();
      if (foreground && !wasForeground) {
        void useAuthStore.getState().refreshRemoteIdentity();
      }
      wasForeground = foreground;
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.addEventListener('focus', handleForegroundChange);
      document.addEventListener('visibilitychange', handleForegroundChange);
      return () => {
        window.removeEventListener('focus', handleForegroundChange);
        document.removeEventListener('visibilitychange', handleForegroundChange);
      };
    }
    const subscription = AppState.addEventListener('change', handleForegroundChange);
    return () => subscription.remove();
  }, [remoteAccountId, needsReauth, syncMode]);

  useEffect(() => {
    configureSync({
      // アカウント／接続設定の確認と同期モードの判断を分離する。
      // トークン自動更新は supabase.ts が同期モードと前景状態で制御し、データ同期の可否は controller が判断する。
      isAccountAvailable: () => {
        const authState = useAuthStore.getState();
        const identity = authState.identity;
        const dataState = useDataStore.getState();
        return (
          !!identity &&
          !identity.local &&
          !authState.needsReauth &&
          isSupabaseConfigured &&
          dataState.ready &&
          dataState.ownerId === identity.userId
        );
      },
      getAccountId: () => {
        const identity = useAuthStore.getState().identity;
        const dataState = useDataStore.getState();
        return identity &&
          !identity.local &&
          isSupabaseConfigured &&
          dataState.ready &&
          dataState.ownerId === identity.userId
          ? identity.userId
          : null;
      },
      onAuthRequired: (ownerId) => {
        const identity = useAuthStore.getState().identity;
        const dataState = useDataStore.getState();
        if (identity?.userId === ownerId && dataState.ready && dataState.ownerId === ownerId) {
          useAuthStore.getState().setNeedsReauth(true);
        }
      },
    });
  }, []);

  // 自動同期（モードが「自動」のときだけ動く。ゲストも同期がオンならサーバーに保存する）
  useEffect(() => {
    if (
      (status !== 'account' && status !== 'guest') ||
      !ready ||
      !ownerId ||
      isLocal ||
      needsReauth ||
      !isSupabaseConfigured
    )
      return;
    return startAutoSync(ownerId);
  }, [status, ready, ownerId, isLocal, syncMode, needsReauth]);

  // 同期がオフ・端末内のみのときの、ごみ箱の自動削除（同期ありのときは同期処理が行う）
  useEffect(() => {
    if (!ready || !autoDelete) return;
    if (syncMode === 'off' || isLocal) void autoPurgeLocal(retention, nowMs());
  }, [ready, autoDelete, retention, syncMode, isLocal]);

  if (Platform.OS === 'web' && !isolated()) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <SystemBars />
        <View style={styles.center}>
          <AppText style={styles.notice}>{t('app.webNotIsolated')}</AppText>
        </View>
      </View>
    );
  }
  if (status === 'error') {
    const retryStartup = async () => {
      useAuthStore.getState().setBootstrapError(null);
      try {
        await useSettingsStore.getState().load();
        await useAuthStore.getState().bootstrap();
      } catch (error) {
        useAuthStore
          .getState()
          .setBootstrapError(error instanceof Error ? error.message : t('app.startupErrorMessage'));
      }
    };
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <SystemBars />
        <View style={[styles.center, { gap: SPACING.lg }]}>
          <AppText variant="title">{t('app.startupErrorTitle')}</AppText>
          <AppText style={styles.notice}>{bootstrapError ?? t('app.startupErrorMessage')}</AppText>
          {Platform.OS === 'web' ? (
            <AppText style={styles.notice}>{t('app.startupWebHint')}</AppText>
          ) : null}
          <Button label={t('common.retry')} onPress={() => void retryStartup()} />
        </View>
      </View>
    );
  }
  if (!loaded || status === 'loading') {
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <SystemBars />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }
  return (
    <MenuProvider>
      <Slot />
      {/* ルート画面より後ろに描画されないよう最後に置き、システム領域の背景を最前面で描画する。 */}
      <SystemBars />
    </MenuProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider initialMetrics={Platform.OS === 'web' ? undefined : initialWindowMetrics}>
        <ThemeProvider>
          <ScreenFrame>
            <FeedbackProvider>
              <Boot />
            </FeedbackProvider>
          </ScreenFrame>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  notice: { textAlign: 'center', maxWidth: UI_METRICS.startup.noticeMaxWidth },
});
