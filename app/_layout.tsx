import { Slot } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '@/auth/authStore';
import { isSupabaseConfigured } from '@/config/env';
import { FeedbackProvider } from '@/components/ui/FeedbackProvider';
import { SystemBars } from '@/components/ui/SystemBars';
import { MenuProvider } from '@/components/ui/MenuHost';
import { autoPurgeLocal } from '@/features/maintenance';
import { nowMs } from '@/lib/clock';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { configureSync, startAutoSync } from '@/sync/controller';
import { AppText } from '@/components/ui/AppText';
import { t } from '@/i18n';
import { ThemeProvider, useTheme } from '@/theme';

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
  const { colors, isDark } = useTheme();
  const loaded = useSettingsStore((s) => s.loaded);
  const status = useAuthStore((s) => s.status);
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
    void useSettingsStore
      .getState()
      .load()
      .then(() => useAuthStore.getState().bootstrap());
  }, []);

  useEffect(() => {
    configureSync({
      isEnabled: () => {
        const identity = useAuthStore.getState().identity;
        return (
          !!identity &&
          !identity.local &&
          isSupabaseConfigured &&
          useSettingsStore.getState().settings.syncMode !== 'off'
        );
      },
      onAuthRequired: () => useAuthStore.getState().setNeedsReauth(true),
    });
  }, []);

  // 自動同期（モードが「自動」のときだけ動く。ゲストも同期がオンならサーバーに保存する）
  useEffect(() => {
    if (
      (status !== 'account' && status !== 'guest') ||
      !ready ||
      !ownerId ||
      isLocal ||
      !isSupabaseConfigured
    )
      return;
    return startAutoSync(ownerId);
  }, [status, ready, ownerId, isLocal, syncMode]);

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
      <SafeAreaProvider>
        <ThemeProvider>
          <FeedbackProvider>
            <Boot />
          </FeedbackProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  notice: { textAlign: 'center', maxWidth: 480 },
});
