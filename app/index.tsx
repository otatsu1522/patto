import { Redirect } from 'expo-router';
import { useAuthStore } from '@/auth/authStore';
import { useSettingsStore } from '@/store/settingsStore';

/** 起動時の振り分け: ログイン済み/ゲストならメイン、そうでなければログイン画面。 */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const lastProjectId = useSettingsStore((s) => s.settings.lastProjectId);
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (lastProjectId)
    return <Redirect href={{ pathname: '/project/[id]', params: { id: lastProjectId } }} />;
  return <Redirect href="/home" />;
}
