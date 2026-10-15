import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { BackHandler, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { visibleProjects } from '@/domain/selectors';
import { popUndo } from '@/features/undo';
import { toggleBoardMenu, openBoardMenu } from '@/hooks/boardMenu';
import { sidebarWidthFor, useLayoutMode } from '@/hooks/useLayout';
import { useProjectNavigation } from '@/hooks/useProjectNavigation';
import { useShortcuts } from '@/shortcuts/useShortcuts';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { syncNow } from '@/sync/controller';
import { useTheme } from '@/theme';
import { getSystemBarInsets } from '@/lib/systemBarInsets';
import { ProjectDialog } from '../board/NameDialogs';
import { useFeedback } from '../ui/FeedbackProvider';
import { t } from '@/i18n';
import { ReauthBanner } from './ReauthBanner';
import { ShortcutHelp } from './ShortcutHelp';
import { Sidebar } from './Sidebar';

/**
 * 画面全体の枠。PCは左にメニューを常設する。スマホのメニューは、ボード画面の横スクロールの一部（BoardView）。
 * ステータスバーやナビゲーションバーに文字が重ならないよう、画面の余白（セーフエリア）を確保する。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const { mode } = useLayoutMode();
  const { width: windowWidth } = useWindowDimensions();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const router = useRouter();
  const navigateToProject = useProjectNavigation();
  const { toast } = useFeedback();
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);

  const permanent = mode === 'expanded';
  const lastBackPress = useRef(0);

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
    toggleSidebar: () => (permanent ? toggleCollapsed() : toggleBoardMenu()),
    search: () => {
      if (pathname.startsWith('/project/')) return useUiStore.getState().focusBoardSearch();
      if (!permanent) openBoardMenu();
      useUiStore.getState().focusSidebarSearch();
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
    sync: () => void syncNow(),
    undo: () => void popUndo(),
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Dialog コンポーネントの Modal は onRequestClose で自身を閉じる。
      if (useUiStore.getState().dialogCount > 0) return false;
      // 設定などのサブ画面では通常のナビゲーションを優先する。
      const mainScreen = pathname === '/home' || pathname.startsWith('/project/');
      if (!mainScreen && router.canGoBack()) {
        router.back();
        return true;
      }
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPress.current = now;
      toast(t('app.pressBackAgain'), undefined, { force: true });
      return true;
    });
    return () => subscription.remove();
  }, [pathname, router, toast]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        {permanent && !collapsed ? (
          <Sidebar
            width={width}
            showMenuIcon={false}
            onToggle={toggleCollapsed}
            onNavigate={() => {}}
          />
        ) : null}
        <View style={[styles.content, { paddingBottom: insets.bottom }]}>
          <ReauthBanner />
          <View style={styles.fill}>{children}</View>
        </View>
      </View>

      <ShortcutHelp />
      <ProjectDialog
        visible={newProjectOpen}
        project={null}
        onClose={() => setNewProjectOpen(false)}
        onSubmit={async (v) => {
          setNewProjectOpen(false);
          const p = await useDataStore.getState().createProject(v);
          toast(t('toast.projectCreated'));
          navigateToProject(p.id);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
});
