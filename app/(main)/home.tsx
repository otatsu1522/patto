import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardView } from '@/components/board/BoardView';
import { ProjectSelectionEmptyState } from '@/components/shell/ProjectSelectionEmptyState';
import { visibleProjects } from '@/domain/selectors';
import { useLayoutMode } from '@/hooks/useLayout';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';

/** プロジェクト未選択時の画面。明示的に選択画面へ戻された場合は自動選択しない。 */
export default function HomeScreen() {
  const projects = useDataStore((s) => s.projects);
  const lastId = useSettingsStore((s) => s.settings.lastProjectId);
  const params = useLocalSearchParams<{ selection?: string }>();
  const forceSelection = params.selection === 'empty';
  const { mode } = useLayoutMode();
  const list = visibleProjects(projects);
  // 通常起動では最後のプロジェクト、なければ先頭を開く。設定からの明示的な戻りでは自動選択しない。
  const target = forceSelection ? null : (list.find((p) => p.id === lastId) ?? list[0] ?? null);
  if (target) return <Redirect href={{ pathname: '/project/[id]', params: { id: target.id } }} />;

  if (mode !== 'expanded') {
    // モバイルではメニューと選択画面を縦に積まず、通常のボードと同じ横スライド構造にする。
    return (
      <View style={{ flex: 1 }}>
        <BoardView
          header={() => <BoardHeader menuOnly />}
          columns={[]}
          showEmptyState={false}
          emptyContent={<ProjectSelectionEmptyState />}
          tasksOf={() => []}
          cursor={null}
          compactCards={false}
          detailedCards={false}
          showTaskDescription={false}
          showTaskDueDate={false}
          showTaskUpdatedAt={false}
          menuItemsFor={() => []}
          taskMenuFor={() => []}
          onAdvance={() => {}}
          onTaskDrop={() => {}}
          onColumnDrop={() => {}}
          onAddTask={() => {}}
          onCopyTitle={() => {}}
          onCopyDescription={() => {}}
        />
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
