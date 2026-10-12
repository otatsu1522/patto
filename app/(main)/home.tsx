import { Redirect } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { BoardHeader } from '@/components/board/BoardHeader';
import { Sidebar } from '@/components/shell/Sidebar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { visibleProjects } from '@/domain/selectors';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';

/**
 * プロジェクトが開かれていないときの画面。最後に開いたプロジェクトがあればそちらへ移動する。
 * スマホでは、メニュー（プロジェクト一覧）をそのまま画面いっぱいに表示する。
 */
export default function HomeScreen() {
  const projects = useDataStore((s) => s.projects);
  const lastId = useSettingsStore((s) => s.settings.lastProjectId);
  const { mode } = useLayoutMode();
  const { width } = useWindowDimensions();
  const list = visibleProjects(projects);
  const target = list.find((p) => p.id === lastId) ?? null;
  if (target) return <Redirect href={{ pathname: '/project/[id]', params: { id: target.id } }} />;

  if (mode !== 'expanded') {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Sidebar width={width} showMenuIcon={false} onToggle={() => {}} onNavigate={() => {}} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <BoardHeader title="" />
      <EmptyState
        title={t('project.empty')}
        hint={t('project.emptyHint')}
        action={<Button label={t('menu.newProject')} icon="add" onPress={() => useUiStore.getState().requestNewProject()} />}
      />
    </View>
  );
}
