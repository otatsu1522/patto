import { Redirect, Stack } from 'expo-router';
import { AppShell } from '@/components/shell/AppShell';
import { useAuthStore } from '@/auth/authStore';
import { useDataStore } from '@/store/dataStore';

export default function MainLayout() {
  const status = useAuthStore((s) => s.status);
  const ready = useDataStore((s) => s.ready);
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (!ready) return null;
  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </AppShell>
  );
}
