import { Redirect } from 'expo-router';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { visibleProjects } from '@/domain/selectors';
import { BoardHeader } from '@/components/board/BoardHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/i18n';
import { View } from 'react-native';

/** プロジェクトが開かれていないときの画面。最後に開いたプロジェクトがあればそちらへ移動する。 */
export default function HomeScreen() {
  const projects = useDataStore((s) => s.projects);
  const lastId = useSettingsStore((s) => s.settings.lastProjectId);
  const list = visibleProjects(projects);
  const target = list.find((p) => p.id === lastId) ?? null;
  if (target) return <Redirect href={{ pathname: '/project/[id]', params: { id: target.id } }} />;
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
