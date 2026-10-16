import { usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { closeBoardMenu } from '@/hooks/boardMenu';
import { useLayoutMode } from '@/hooks/useLayout';
import { useSettingsStore } from '@/store/settingsStore';

/** メニューを閉じるアニメーションが終わるまでの待ち時間(ms)。終わってから中身を入れ替える */
const MENU_CLOSE_MS = 280;

/**
 * プロジェクトを開く。
 * - すでにプロジェクトの画面にいるときは、新しい画面を重ねず、同じ画面の中身（id）だけを入れ替える。
 *   画面の作り直しが起きないので、切り替えがなめらか。
 * - スマホでは、メニューが閉じ終わってから入れ替える（動きと描画が重なって、ごちゃつかないように）。
 */
export function useProjectNavigation(): (id: string, options?: { keepMenuOpen?: boolean }) => void {
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();

  return useCallback(
    (id: string, options: { keepMenuOpen?: boolean } = {}) => {
      useSettingsStore.getState().update({ lastProjectId: id });
      const onProject = pathname.startsWith('/project/');
      const go = () =>
        onProject
          ? router.setParams({ id })
          : router.push({ pathname: '/project/[id]', params: { id } });
      if (onProject && mode !== 'expanded' && !options.keepMenuOpen) {
        closeBoardMenu();
        setTimeout(go, MENU_CLOSE_MS);
      } else {
        go();
      }
    },
    [router, pathname, mode],
  );
}
