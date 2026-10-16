import { usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { closeBoardMenu } from '@/hooks/boardMenu';
import { useLayoutMode } from '@/hooks/useLayout';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';

/** プロジェクトの内容を即時に切り替える。メニューから選んだ場合はメニューを開いたまま保つ。 */
export function useProjectNavigation(): (id: string, options?: { keepMenuOpen?: boolean }) => void {
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();

  return useCallback(
    (id: string, options: { keepMenuOpen?: boolean } = {}) => {
      useSettingsStore.getState().update({ lastProjectId: id });
      const onProject = pathname.startsWith('/project/');
      if (mode !== 'expanded' && options.keepMenuOpen) {
        useUiStore.setState({ menuVisible: true, menuIconOpen: true });
      } else if (onProject && mode !== 'expanded' && useUiStore.getState().menuVisible) {
        // タスク検索など、メニューを閉じてから目的の内容を表示する操作も待ち時間は入れない。
        closeBoardMenu();
      }
      if (onProject) router.setParams({ id });
      else router.push({ pathname: '/project/[id]', params: { id } });
    },
    [router, pathname, mode],
  );
}
