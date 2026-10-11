import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BOARD } from '@/config/layout';
import { visibleProjects } from '@/domain/selectors';
import { popUndo } from '@/features/undo';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useShortcuts } from '@/shortcuts/useShortcuts';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { syncNow } from '@/sync/controller';
import { useTheme } from '@/theme';
import { ProjectDialog } from '../board/NameDialogs';
import { ReauthBanner } from './ReauthBanner';
import { ShortcutHelp } from './ShortcutHelp';
import { Sidebar } from './Sidebar';

/** 画面全体の枠。PCは左にメニューを常設、スマホは開閉式のメニュー（ドロワー）にする。 */
export function AppShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const { mode } = useLayoutMode();
  const router = useRouter();
  const pathname = usePathname();
  const open = useUiStore((s) => s.sidebarOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);

  const permanent = mode === 'expanded';
  const showSidebar = permanent ? !collapsed : open;

  const stepProject = (delta: number) => {
    const list = visibleProjects(useDataStore.getState().projects);
    if (list.length === 0) return;
    const current = pathname.startsWith('/project/') ? pathname.split('/')[2] : null;
    const i = list.findIndex((p) => p.id === current);
    const next = list[(i + delta + list.length) % list.length]!;
    useSettingsStore.getState().update({ lastProjectId: next.id });
    router.push({ pathname: '/project/[id]', params: { id: next.id } });
  };

  useShortcuts({
    toggleSidebar: () => (permanent ? toggleCollapsed() : setOpen(!open)),
    search: () => (pathname.startsWith('/project/') ? useUiStore.getState().focusBoardSearch() : useUiStore.getState().focusSidebarSearch()),
    openSettings: () => router.push('/settings'),
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

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {permanent && showSidebar ? <Sidebar onNavigate={() => {}} /> : null}
      <View style={styles.content}>
        <ReauthBanner />
        <View style={styles.fill}>{children}</View>
      </View>
      {!permanent && showSidebar ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable accessibilityLabel={t('common.close')} onPress={() => setOpen(false)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
          <View style={[styles.drawer, { width: Math.min(BOARD.drawerWidth, 360) }]}>
            <Sidebar onNavigate={() => setOpen(false)} />
          </View>
        </View>
      ) : null}
      <ShortcutHelp />
      <ProjectDialog
        visible={newProjectOpen}
        project={null}
        onClose={() => setNewProjectOpen(false)}
        onSubmit={async (v) => {
          setNewProjectOpen(false);
          const p = await useDataStore.getState().createProject(v);
          useSettingsStore.getState().update({ lastProjectId: p.id });
          router.push({ pathname: '/project/[id]', params: { id: p.id } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
