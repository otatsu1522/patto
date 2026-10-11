import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/auth/authStore';

export default function AuthGroupLayout() {
  const status = useAuthStore((s) => s.status);
  if (status === 'account' || status === 'guest') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
