import { Redirect, Stack } from 'expo-router';
import { AppShell } from '@/components/shell/AppShell';
import { useAuthStore } from '@/auth/authStore';
import { useDataStore } from '@/store/dataStore';

export default function MainLayout() {
  const status = useAuthStore((s) => s.status);
  const ready = useDataStore((s) => s.ready);
  if (status === 'signedOut') return <Redirect href="/login" />;
  // ログアウト／退出の待機中は画面操作を止める。開始済みの同期や保存処理は裏で完了する。
  if (status === 'loading' || !ready) return null;
  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </AppShell>
  );
}
