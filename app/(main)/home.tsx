import { Redirect } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { BoardHeader } from '@/components/board/BoardHeader';
import { Sidebar } from '@/components/shell/Sidebar';
import { ProjectSelectionEmptyState } from '@/components/shell/ProjectSelectionEmptyState';
import { visibleProjects } from '@/domain/selectors';
import { useLayoutMode } from '@/hooks/useLayout';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';

/** プロジェクトが開かれていないときの画面。最後に開いたプロジェクトがあればそちらへ移動する。 */
export default function HomeScreen() {
  const projects = useDataStore((s) => s.projects);
  const lastId = useSettingsStore((s) => s.settings.lastProjectId);
  const { mode } = useLayoutMode();
  const { width } = useWindowDimensions();
  const list = visibleProjects(projects);
  // 選択履歴がない初回ログインや、別ユーザーの古いIDが残っている場合は先頭を開く。
  const target = list.find((p) => p.id === lastId) ?? list[0] ?? null;
  if (target) return <Redirect href={{ pathname: '/project/[id]', params: { id: target.id } }} />;

  if (mode !== 'expanded') {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Sidebar width={width} showMenuIcon={false} onToggle={() => {}} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <BoardHeader menuOnly />
      <ProjectSelectionEmptyState />
    </View>
  );
}
