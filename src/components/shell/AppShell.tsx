import { usePathname, useRouter } from 'expo-router';
import { TIMING } from '@/config/timing';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { visibleProjects } from '@/domain/selectors';
import { popUndo, showUndoToast } from '@/features/undo';
import { closeBoardMenu, toggleBoardMenu } from '@/hooks/boardMenu';
import { sidebarWidthFor, useLayoutMode } from '@/hooks/useLayout';
import { consumeSettingsMenuCloseAfterRender, registerSettingsMenu } from '@/hooks/settingsMenu';
import {
  cancelDrawerCloseTransition,
  finishDrawerCloseAfterRender,
  scheduleDrawerCloseAfterRender,
} from '@/hooks/drawerTransition';
import { useProjectNavigation } from '@/hooks/useProjectNavigation';
import { useManualSync } from '@/hooks/useManualSync';
import { useShortcuts } from '@/shortcuts/useShortcuts';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { GESTURE, UI_METRICS } from '@/config/layout';
import { useTheme } from '@/theme';
import { GlobalSearchDialog } from '../board/GlobalSearchDialog';
import { ProjectDialog } from '../board/NameDialogs';
import { useFeedback } from '../ui/FeedbackProvider';
import { t } from '@/i18n';
import { ReauthBanner } from './ReauthBanner';
import { ShortcutHelp } from './ShortcutHelp';
import { Sidebar } from './Sidebar';
import { isTouchWeb } from '@/lib/hover';

interface SettingsDrawerTouch {
  startX: number;
  startY: number;
  baseX: number;
  opening: boolean | null;
  claimed: boolean;
}

/**
 * 画面全体の枠。PCは左にメニューを常設し、スマホではボード／設定画面を横にスライドしてメニューを表示する。
 * ステータスバーやナビゲーションバーに文字が重ならないよう、画面の余白（セーフエリア）を確保する。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const { mode, width: windowWidth } = useLayoutMode();
  // レイアウトにはOSが実際に返すinsetsだけを使う。最低値の補正を使うと、
  // システム側ですでにバー領域を確保するネイティブ構成で余白が二重になる。
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigateToProject = useProjectNavigation();
  const { toast } = useFeedback();
  const syncManually = useManualSync();
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  const globalSearchOpen = useUiStore((s) => s.globalSearchOpen);
  const globalSearchProjectId = useUiStore((s) => s.globalSearchProjectId);
  const setGlobalSearchOpen = useUiStore((s) => s.setGlobalSearchOpen);
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);

  const permanent = mode === 'expanded';
  const lastBackPress = useRef(0);
  const currentPathRef = useRef(pathname);
  const browserHistoryEntryRef = useRef<{ href: string; state: History['state'] } | null>(null);
  useLayoutEffect(() => {
    if (currentPathRef.current !== pathname) lastBackPress.current = 0;
    currentPathRef.current = pathname;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      browserHistoryEntryRef.current = {
        href: window.location.href,
        state: window.history.state,
      };
    }
  }, [pathname]);
  const settingsDrawerRef = useRef<ScrollView>(null);
  const settingsDrawerXRef = useRef(0);
  const settingsMenuTargetRef = useRef<boolean | null>(null);
  const pendingSettingsCloseRef = useRef<(() => void) | null>(null);
  const settingsAfterCloseFrameRef = useRef<number | null>(null);
  const automaticSettingsCloseTokenRef = useRef<number | null>(null);
  const settingsDrawerActive = mode !== 'expanded' && pathname.startsWith('/settings');
  const settingsDrawerWidth = sidebarWidthFor(windowWidth, false);
  // contentOffset is only the native ScrollView's initial offset. Do not bind it to the
  // live menuVisible state, or React Native may reset the offset while scrollTo is animating.
  const settingsDrawerContentOffset = useMemo(
    () => ({ x: useUiStore.getState().menuVisible ? 0 : settingsDrawerWidth, y: 0 }),
    [settingsDrawerWidth],
  );

  const interruptAutomaticSettingsClose = useCallback(() => {
    if (automaticSettingsCloseTokenRef.current === null) return;
    const x = Math.max(0, Math.min(settingsDrawerWidth, settingsDrawerXRef.current));
    settingsDrawerRef.current?.scrollTo({ x, y: 0, animated: false });
    settingsDrawerXRef.current = x;
    automaticSettingsCloseTokenRef.current = null;
    settingsMenuTargetRef.current = null;
    if (settingsAfterCloseFrameRef.current !== null) {
      cancelAnimationFrame(settingsAfterCloseFrameRef.current);
      settingsAfterCloseFrameRef.current = null;
    }
    pendingSettingsCloseRef.current = null;
    const opened = x < settingsDrawerWidth - GESTURE.menuEdgeTolerancePx;
    useUiStore.setState({ menuVisible: opened, menuIconOpen: opened });
  }, [settingsDrawerWidth]);

  // ユーザーがメニューへ触れたら、自動クローズの残り処理を取り消して現在位置を優先する。
  const cancelSettingsMenuTransitionForUser = useCallback(() => {
    const shouldStopNativeMotion =
      settingsMenuTargetRef.current !== null ||
      automaticSettingsCloseTokenRef.current !== null ||
      pendingSettingsCloseRef.current !== null ||
      settingsAfterCloseFrameRef.current !== null;
    cancelDrawerCloseTransition();
    if (settingsAfterCloseFrameRef.current !== null) {
      cancelAnimationFrame(settingsAfterCloseFrameRef.current);
      settingsAfterCloseFrameRef.current = null;
    }
    pendingSettingsCloseRef.current = null;
    automaticSettingsCloseTokenRef.current = null;
    if (!shouldStopNativeMotion) return;

    const x = Math.max(0, Math.min(settingsDrawerWidth, settingsDrawerXRef.current));
    settingsDrawerRef.current?.scrollTo({ x, y: 0, animated: false });
    settingsDrawerXRef.current = x;
    settingsMenuTargetRef.current = null;
    const opened = x < settingsDrawerWidth - GESTURE.menuEdgeTolerancePx;
    useUiStore.setState({ menuVisible: opened, menuIconOpen: opened });
  }, [settingsDrawerWidth]);

  const onSettingsDrawerScrollBeginDrag = useCallback(() => {
    cancelSettingsMenuTransitionForUser();
  }, [cancelSettingsMenuTransitionForUser]);

  const openSettingsDrawer = useCallback(() => {
    cancelDrawerCloseTransition();
    if (settingsAfterCloseFrameRef.current !== null) {
      cancelAnimationFrame(settingsAfterCloseFrameRef.current);
      settingsAfterCloseFrameRef.current = null;
    }
    pendingSettingsCloseRef.current = null;
    settingsMenuTargetRef.current = true;
    useUiStore.setState({ menuVisible: true, menuIconOpen: true });
    // 現在位置をrefへ反映させたまま目標位置へ動かす。0へ先回りしてrefを書き換えない。
    settingsDrawerRef.current?.scrollTo({ x: 0, y: 0, animated: true });
  }, []);

  const closeSettingsDrawerInternal = useCallback(
    (
      options: { automaticToken?: number; preserveAfterClose?: boolean; skipCancel?: boolean } = {},
    ) => {
      if (options.automaticToken === undefined && !options.skipCancel)
        cancelDrawerCloseTransition();
      if (!options.preserveAfterClose) {
        if (settingsAfterCloseFrameRef.current !== null) {
          cancelAnimationFrame(settingsAfterCloseFrameRef.current);
          settingsAfterCloseFrameRef.current = null;
        }
        pendingSettingsCloseRef.current = null;
      }
      if (options.automaticToken !== undefined) {
        automaticSettingsCloseTokenRef.current = options.automaticToken;
      }
      settingsMenuTargetRef.current = false;
      useUiStore.setState({ menuVisible: false, menuIconOpen: false });
      settingsDrawerRef.current?.scrollTo({ x: settingsDrawerWidth, y: 0, animated: true });
      if (
        options.automaticToken !== undefined &&
        settingsDrawerXRef.current >= settingsDrawerWidth - GESTURE.menuEdgeTolerancePx
      ) {
        automaticSettingsCloseTokenRef.current = null;
        finishDrawerCloseAfterRender(options.automaticToken);
      }
    },
    [settingsDrawerWidth],
  );

  const closeSettingsDrawer = useCallback(() => {
    cancelDrawerCloseTransition();
    if (settingsAfterCloseFrameRef.current !== null) {
      cancelAnimationFrame(settingsAfterCloseFrameRef.current);
      settingsAfterCloseFrameRef.current = null;
    }
    pendingSettingsCloseRef.current = null;
    closeSettingsDrawerInternal({ skipCancel: true });
  }, [closeSettingsDrawerInternal]);

  const toggleSettingsDrawer = useCallback(() => {
    // cancel は close/open 内で行い、実際のスクロール位置からトグル先を決める。
    if (useUiStore.getState().menuIconOpen) closeSettingsDrawer();
    else openSettingsDrawer();
  }, [closeSettingsDrawer, openSettingsDrawer]);

  const finishSettingsCloseIfReached = useCallback(
    (x: number) => {
      if (x < settingsDrawerWidth - GESTURE.menuEdgeTolerancePx) return;
      const automaticToken = automaticSettingsCloseTokenRef.current;
      if (automaticToken !== null) {
        automaticSettingsCloseTokenRef.current = null;
        finishDrawerCloseAfterRender(automaticToken);
      }
      const afterClose = pendingSettingsCloseRef.current;
      if (!afterClose || settingsAfterCloseFrameRef.current !== null) return;
      settingsAfterCloseFrameRef.current = requestAnimationFrame(() => {
        settingsAfterCloseFrameRef.current = null;
        if (pendingSettingsCloseRef.current !== afterClose) return;
        pendingSettingsCloseRef.current = null;
        afterClose();
      });
    },
    [settingsDrawerWidth],
  );

  const closeSettingsDrawerThen = useCallback(
    (afterClose: () => void) => {
      if (
        !useUiStore.getState().menuVisible &&
        settingsDrawerXRef.current >= settingsDrawerWidth - GESTURE.menuEdgeTolerancePx
      ) {
        cancelDrawerCloseTransition();
        pendingSettingsCloseRef.current = null;
        afterClose();
        return;
      }
      cancelDrawerCloseTransition();
      if (settingsAfterCloseFrameRef.current !== null) {
        cancelAnimationFrame(settingsAfterCloseFrameRef.current);
        settingsAfterCloseFrameRef.current = null;
      }
      pendingSettingsCloseRef.current = afterClose;
      closeSettingsDrawerInternal({ preserveAfterClose: true, skipCancel: true });
    },
    [closeSettingsDrawerInternal, settingsDrawerWidth],
  );

  useLayoutEffect(() => {
    if (!settingsDrawerActive) return;
    // 設定画面へ移動する前にメニューが開いていた場合は、その状態を引き継ぐ。
    const initialX = useUiStore.getState().menuVisible ? 0 : settingsDrawerWidth;
    settingsDrawerXRef.current = initialX;
    settingsMenuTargetRef.current = null;
    settingsDrawerRef.current?.scrollTo({ x: initialX, y: 0, animated: false });
  }, [settingsDrawerActive, settingsDrawerWidth, windowWidth]);

  useLayoutEffect(() => {
    if (!settingsDrawerActive) return;
    return registerSettingsMenu({
      open: openSettingsDrawer,
      close: closeSettingsDrawer,
      closeAndThen: closeSettingsDrawerThen,
      toggle: toggleSettingsDrawer,
    });
  }, [
    settingsDrawerActive,
    openSettingsDrawer,
    closeSettingsDrawer,
    closeSettingsDrawerThen,
    toggleSettingsDrawer,
  ]);

  // 設定側もボード側と同じスケジューラを使い、内容が切り替わった後に2フレーム待って閉じる。
  // 横スクロール実装は別でも、閉じ開始のタイミング・キャンセル規則は共通にする。
  useEffect(() => {
    if (!settingsDrawerActive) return;
    const token = consumeSettingsMenuCloseAfterRender(pathname);
    if (token === null) return;
    return scheduleDrawerCloseAfterRender(
      token,
      () => settingsDrawerXRef.current >= settingsDrawerWidth - GESTURE.menuEdgeTolerancePx,
      () => closeSettingsDrawerInternal({ automaticToken: token }),
      interruptAutomaticSettingsClose,
    );
  }, [
    settingsDrawerActive,
    pathname,
    settingsDrawerWidth,
    closeSettingsDrawerInternal,
    interruptAutomaticSettingsClose,
  ]);

  // RN Web の入れ子 ScrollView では、設定ページ内の縦スクロールが横スワイプを
  // 先に取得する端末がある。横方向と判定した間だけ指の移動量を親の横スクロールへ
  // 反映し、プロジェクト画面と同じく、指を離した後も同じ位置へスナップさせる。
  useEffect(() => {
    if (
      !settingsDrawerActive ||
      Platform.OS !== 'web' ||
      !isTouchWeb ||
      typeof document === 'undefined'
    ) {
      return;
    }

    let gesture: SettingsDrawerTouch | null = null;
    const isDialogTarget = (target: EventTarget | null) =>
      target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"]') !== null;

    const onTouchStart = (event: TouchEvent) => {
      // 自動クローズ中でも新しい操作を優先し、閉じるアニメーションを停止した現在位置から追跡する。
      cancelSettingsMenuTransitionForUser();
      if (event.touches.length !== 1 || isDialogTarget(event.target)) {
        gesture = null;
        return;
      }
      // 新しいジェスチャーは途中のアニメーションを引き継ぎ、現在位置から操作する。
      settingsMenuTargetRef.current = null;
      const touch = event.touches[0];
      const baseX = Math.max(0, Math.min(settingsDrawerWidth, settingsDrawerXRef.current));
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        baseX,
        opening: null,
        claimed: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;

      if (!gesture.claimed) {
        if (
          Math.abs(dx) < GESTURE.webScrollAxisThresholdPx &&
          Math.abs(dy) < GESTURE.webScrollAxisThresholdPx
        ) {
          return;
        }
        if (Math.abs(dx) <= Math.abs(dy) * GESTURE.drawerHorizontalIntentRatio) {
          if (Math.abs(dy) >= GESTURE.webScrollAxisThresholdPx) gesture = null;
          return;
        }

        const drawerIsClosed = gesture.baseX >= settingsDrawerWidth / 2;
        const opening = drawerIsClosed && dx > 0;
        const closing = !drawerIsClosed && dx < 0;
        if (!opening && !closing) {
          gesture = null;
          return;
        }
        gesture.claimed = true;
        gesture.opening = opening;
        useUiStore.setState({ menuIconOpen: opening });
      }

      if (event.cancelable) event.preventDefault();
      const nextX = Math.max(0, Math.min(settingsDrawerWidth, gesture.baseX - dx));
      settingsDrawerXRef.current = nextX;
      settingsDrawerRef.current?.scrollTo({ x: nextX, y: 0, animated: false });
    };

    const finishGesture = (cancelled: boolean, event?: TouchEvent) => {
      if (!gesture) return;
      const active = gesture;
      gesture = null;
      if (!active.claimed || active.opening === null) return;

      const touch = event?.changedTouches[0];
      const dx = (touch?.clientX ?? active.startX) - active.startX;
      const shouldOpen = cancelled
        ? active.baseX < settingsDrawerWidth / 2
        : active.opening
          ? dx >= GESTURE.drawerOpenDistancePx
          : dx > -GESTURE.drawerCloseDistancePx;

      if (shouldOpen) openSettingsDrawer();
      else closeSettingsDrawer();
    };

    const onTouchEnd = (event: TouchEvent) => finishGesture(false, event);
    const onTouchCancel = () => finishGesture(true);

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', onTouchCancel, true);
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchCancel, true);
    };
  }, [
    settingsDrawerActive,
    settingsDrawerWidth,
    openSettingsDrawer,
    closeSettingsDrawer,
    cancelSettingsMenuTransitionForUser,
  ]);

  const onSettingsDrawerScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      const previousX = settingsDrawerXRef.current;
      const target = settingsMenuTargetRef.current;
      // 反対方向へ進む古いスクロール通知は無視し、現在の開閉指示を優先する。
      if (
        target !== null &&
        (target
          ? x > previousX + UI_METRICS.scroll.positionTolerancePx
          : x < previousX - UI_METRICS.scroll.positionTolerancePx)
      ) {
        return;
      }
      settingsDrawerXRef.current = x;
      // onScroll だけではプログラム操作を確定しない。終了イベントで到達を確認する。
      if (target !== null) return;
      finishSettingsCloseIfReached(x);

      const visible = x < settingsDrawerWidth - GESTURE.menuEdgeTolerancePx;
      const state = useUiStore.getState();
      if (state.menuVisible !== visible) useUiStore.setState({ menuVisible: visible });
    },
    [settingsDrawerWidth, finishSettingsCloseIfReached],
  );

  const onSettingsDrawerScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      const target = settingsMenuTargetRef.current;
      const reachedTarget =
        target === true
          ? x <= GESTURE.menuEdgeTolerancePx
          : target === false
            ? x >= settingsDrawerWidth - GESTURE.menuEdgeTolerancePx
            : false;
      // 古いスクロール完了イベントで、まだ進行中の新しい開閉目標を消さない。
      // 手動ドラッグ開始時には onSettingsDrawerScrollBeginDrag が target を解除するため、
      // プログラムスクロール中は実際に目標位置へ届いた場合だけ確定させる。
      if (target !== null && !reachedTarget) return;
      settingsDrawerXRef.current = x;
      if (reachedTarget) settingsMenuTargetRef.current = null;
      if (settingsMenuTargetRef.current === null) {
        const opened = x < settingsDrawerWidth / 2;
        useUiStore.setState({ menuVisible: opened, menuIconOpen: opened });
      }
      finishSettingsCloseIfReached(x);
    },
    [settingsDrawerWidth, finishSettingsCloseIfReached],
  );

  // BoardView の再マウント時にメニュー状態を失わないよう、画面外へ移動した時だけ閉じる。
  // /project/[id] の id 変更中は、メニューを開いたまま維持する。
  useEffect(() => {
    if (
      mode !== 'expanded' &&
      !pathname.startsWith('/project/') &&
      !pathname.startsWith('/settings')
    ) {
      useUiStore.setState({ menuVisible: false, menuIconOpen: false });
    }
  }, [mode, pathname]);

  const width = sidebarWidthFor(windowWidth, permanent);
  const stepProject = (delta: number) => {
    const list = visibleProjects(useDataStore.getState().projects);
    if (list.length === 0) return;
    const current = pathname.startsWith('/project/') ? pathname.split('/')[2] : null;
    const i = list.findIndex((p) => p.id === current);
    const next = list[(i + delta + list.length) % list.length]!;
    navigateToProject(next.id);
  };

  useShortcuts({
    toggleSidebar: () => {
      if (permanent) toggleCollapsed();
      else if (settingsDrawerActive) toggleSettingsDrawer();
      else toggleBoardMenu();
    },
    search: () => {
      const projectId = pathname.startsWith('/project/') ? (pathname.split('/')[2] ?? null) : null;
      setGlobalSearchOpen(true, projectId);
    },
    openSettings: () => router.navigate('/settings'),
    nextProject: () => stepProject(1),
    prevProject: () => stepProject(-1),
    newProject: () => useUiStore.getState().requestNewProject(),
    toggleTheme: () => {
      const s = useSettingsStore.getState();
      s.update({ themeMode: s.settings.themeMode === 'dark' ? 'light' : 'dark' });
    },
    showHelp: () => useUiStore.getState().setHelpOpen(true),
    sync: () => void syncManually(),
    undo: () => void popUndo(),
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Dialog コンポーネントの Modal は onRequestClose で自身を閉じる。
      if (useUiStore.getState().dialogCount > 0) return false;
      // スマホでメニューを開いている場合は、画面遷移より先にメニューを閉じる。
      if (mode !== 'expanded' && useUiStore.getState().menuVisible) {
        if (pathname.startsWith('/settings')) closeSettingsDrawer();
        else closeBoardMenu();
        lastBackPress.current = 0;
        return true;
      }
      // 設定トップはプロジェクト画面と同じ最上位画面として扱い、
      // 端末の戻る操作で直前のプロジェクトへ戻ってちらつくことを防ぐ。
      const mainScreen =
        pathname === '/home' || pathname.startsWith('/project/') || pathname === '/settings';
      if (!mainScreen && router.canGoBack()) {
        router.back();
        return true;
      }
      // 直接開かれた設定の下層画面など、戻り先が履歴にない場合のフォールバック。
      if (!mainScreen && pathname.startsWith('/settings/')) {
        lastBackPress.current = 0;
        router.replace('/settings');
        return true;
      }
      const now = Date.now();
      if (now - lastBackPress.current < TIMING.androidBackExitWindowMs) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPress.current = now;
      toast(t('app.pressBackAgain'), undefined, { category: 'system' });
      return true;
    });
    return () => subscription.remove();
  }, [mode, pathname, router, toast, closeSettingsDrawer]);

  // モバイルWebのブラウザー戻るもAndroidと同じ2段階にする。
  // 1回目は現在の履歴エントリを復元してトーストを表示し、2回目はブラウザー標準へ渡す。
  useEffect(() => {
    if (Platform.OS !== 'web' || !isTouchWeb || typeof window === 'undefined') return;

    const onPopState = (event: PopStateEvent) => {
      if (useUiStore.getState().dialogCount > 0) return;
      const currentPath = currentPathRef.current;
      const ui = useUiStore.getState();
      const inMainArea =
        currentPath === '/home' ||
        currentPath.startsWith('/project/') ||
        currentPath === '/settings' ||
        currentPath.startsWith('/settings/');

      if (inMainArea && ui.menuVisible && mode !== 'expanded') {
        const entry = browserHistoryEntryRef.current;
        if (entry) {
          event.stopImmediatePropagation();
          window.history.pushState(entry.state, '', entry.href);
        }
        if (currentPath.startsWith('/settings')) closeSettingsDrawer();
        else closeBoardMenu();
        lastBackPress.current = 0;
        return;
      }

      const mainScreen =
        currentPath === '/home' ||
        currentPath.startsWith('/project/') ||
        currentPath === '/settings';
      if (!mainScreen) return;

      const now = Date.now();
      if (now - lastBackPress.current < TIMING.androidBackExitWindowMs) {
        lastBackPress.current = 0;
        return;
      }

      const entry = browserHistoryEntryRef.current;
      if (!entry) return;
      // popstate は preventDefault で止められないため、capture で Router より先に処理し、
      // 現在のURL／履歴状態を戻してアプリ内に留まる。
      event.stopImmediatePropagation();
      window.history.pushState(entry.state, '', entry.href);
      lastBackPress.current = now;
      toast(t('app.pressBackAgain'), undefined, { category: 'system' });
    };

    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, [mode, toast, closeSettingsDrawer]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        {permanent && !collapsed ? (
          <Sidebar width={width} showMenuIcon={false} onToggle={toggleCollapsed} />
        ) : null}
        <View style={[styles.content, { paddingBottom: insets.bottom }]}>
          {settingsDrawerActive ? (
            <ScrollView
              ref={settingsDrawerRef}
              onTouchStart={cancelSettingsMenuTransitionForUser}
              onScrollBeginDrag={onSettingsDrawerScrollBeginDrag}
              horizontal
              bounces={false}
              showsHorizontalScrollIndicator={false}
              scrollEnabled
              decelerationRate="fast"
              snapToOffsets={Platform.OS === 'web' ? undefined : [0, settingsDrawerWidth]}
              disableIntervalMomentum
              scrollEventThrottle={16}
              contentOffset={settingsDrawerContentOffset}
              onScroll={onSettingsDrawerScroll}
              onScrollEndDrag={onSettingsDrawerScrollEnd}
              onMomentumScrollEnd={onSettingsDrawerScrollEnd}
              style={[
                styles.settingsDrawer,
                Platform.OS === 'web'
                  ? ({
                      // 横方向はタッチ追跡が指に追従させ、縦方向はブラウザーへ任せる。
                      touchAction: 'pan-y',
                      overscrollBehaviorX: 'contain',
                    } as never)
                  : undefined,
              ]}
              contentContainerStyle={styles.settingsDrawerContent}
            >
              <View style={[{ width: settingsDrawerWidth, height: '100%' }]}>
                <Sidebar
                  width={settingsDrawerWidth}
                  showMenuIcon={false}
                  onToggle={closeSettingsDrawer}
                />
              </View>
              <View style={[styles.settingsPage, { width: windowWidth }]}>
                <ReauthBanner />
                <View style={styles.fill}>{children}</View>
              </View>
            </ScrollView>
          ) : (
            <>
              <ReauthBanner />
              <View style={styles.fill}>{children}</View>
            </>
          )}
        </View>
      </View>

      <ShortcutHelp />
      <GlobalSearchDialog
        visible={globalSearchOpen}
        initialProjectId={globalSearchProjectId}
        onClose={() => setGlobalSearchOpen(false)}
        onSelect={(task) => {
          setGlobalSearchOpen(false);
          useUiStore.getState().requestTaskDetail(task.projectId, task.id);
          navigateToProject(task.projectId);
        }}
      />
      <ProjectDialog
        visible={newProjectOpen}
        project={null}
        onClose={() => setNewProjectOpen(false)}
        onSubmit={async (v) => {
          setNewProjectOpen(false);
          const created = await useDataStore.getState().createProject(v);
          showUndoToast(
            toast,
            t('toast.projectCreated'),
            () => useDataStore.getState().deleteProject(created.id),
            'editing',
          );
          navigateToProject(created.id, { keepMenuOpen: true });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
  fill: { flex: 1, minWidth: 0 },
  settingsDrawer: { flex: 1, minWidth: 0 },
  settingsDrawerContent: { flexDirection: 'row', height: '100%' },
  settingsPage: { height: '100%', minWidth: 0 },
});
