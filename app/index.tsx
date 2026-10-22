import { Redirect } from 'expo-router';
import { useAuthStore } from '@/auth/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDataStore } from '@/store/dataStore';
import { visibleProjects } from '@/domain/selectors';

/** 起動時の振り分け: ログイン済み/ゲストならメイン、そうでなければログイン画面。 */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const ready = useDataStore((s) => s.ready);
  const projects = useDataStore((s) => s.projects);
  const lastProjectId = useSettingsStore((s) => s.settings.lastProjectId);
  if (status === 'signedOut') return <Redirect href="/login" />;
  // DBが読み込まれる前にプロジェクトIDを判定すると、アーカイブ／ごみ箱の状態を誤判定する。
  if (!ready) return null;
  if (lastProjectId) {
    const lastProjectIsAvailable = visibleProjects(projects).some(
      (project) => project.id === lastProjectId,
    );
    if (lastProjectIsAvailable) {
      return <Redirect href={{ pathname: '/project/[id]', params: { id: lastProjectId } }} />;
    }
    // 最後に開いたプロジェクトが存在しない・アーカイブ済み・削除済みなら、別のプロジェクトを選ばずホームへ。
    return <Redirect href={{ pathname: '/home', params: { selection: 'empty' } }} />;
  }
  return <Redirect href="/home" />;
}
