import { usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { closeBoardMenu, requestBoardMenuCloseAfterProjectRender } from '@/hooks/boardMenu';
import { useLayoutMode } from '@/hooks/useLayout';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';

/** プロジェクトの内容を先に切り替え、描画後にモバイルメニューを閉じる。 */
export function useProjectNavigation(): (id: string, options?: { keepMenuOpen?: boolean }) => void {
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();

  return useCallback(
    (id: string, options: { keepMenuOpen?: boolean } = {}) => {
      useSettingsStore.getState().update({ lastProjectId: id });
      const onProject = pathname.startsWith('/project/');
      const mobile = mode !== 'expanded';
      const menuOpen = useUiStore.getState().menuVisible;
      const currentProjectId = onProject ? pathname.split('/')[2] : null;

      const navigate = () => {
        if (onProject) router.setParams({ id });
        else if (pathname.startsWith('/settings')) {
          // 設定を開く前の画面を履歴に残さず、右側の表示をプロジェクト画面へ置き換える。
          router.replace({ pathname: '/project/[id]', params: { id } });
        } else router.push({ pathname: '/project/[id]', params: { id } });
      };

      if (mobile && options.keepMenuOpen) {
        useUiStore.setState({ menuVisible: true, menuIconOpen: true });
        navigate();
        return;
      }

      if (mobile && menuOpen) {
        if (onProject && currentProjectId === id) {
          // 選択中のプロジェクトを再選択した場合は、画面を再遷移せずメニューだけ閉じる。
          closeBoardMenu();
          return;
        }

        // 先に右側の内容を選択したプロジェクトへ切り替える。
        // BoardView が新しいプロジェクトの初期配置を反映した後にメニューを閉じる。
        requestBoardMenuCloseAfterProjectRender(id);
        navigate();
        return;
      }

      navigate();
    },
    [router, pathname, mode],
  );
}
