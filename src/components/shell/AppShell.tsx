import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Keyboard, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/** 画面の左端から、この幅の範囲で右へスワイプするとメニューが開く */
const EDGE_WIDTH = 20;
const ANIMATION_MS = 200;
const SWIPE_VELOCITY = 500;

/** メニューの幅: PCは画面の約1/4、スマホは画面の約8割。 */
export const sidebarWidthFor = (windowWidth: number, permanent: boolean): number =>
  permanent ? Math.round(Math.min(400, Math.max(220, windowWidth * 0.25))) : Math.round(Math.min(340, Math.max(260, windowWidth * 0.82)));

/**
 * 画面全体の枠。PCは左にメニューを常設、スマホはドロワー（左端スワイプで開き、左スワイプ・メニューアイコンで閉じる）。
 * ステータスバーやナビゲーションバーに文字が重ならないよう、画面の余白（セーフエリア）を確保する。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const { mode } = useLayoutMode();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const open = useUiStore((s) => s.sidebarOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const newProjectOpen = useUiStore((s) => s.newProjectOpen);
  const setNewProjectOpen = useUiStore((s) => s.setNewProjectOpen);

  const permanent = mode === 'expanded';
  const width = sidebarWidthFor(windowWidth, permanent);
  const progress = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  // 開閉の状態に合わせて、ドロワーをスライドさせる
  useEffect(() => {
    if (permanent) return;
    if (open) Keyboard.dismiss();
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: ANIMATION_MS, useNativeDriver: false }).start();
  }, [open, permanent, progress]);

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

  // 左端から右へスワイプ → 開く（指に合わせて動かし、離したときに開閉を決める）
  const openGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(12)
    .failOffsetY([-20, 20])
    .onUpdate((e) => progress.setValue(Math.max(0, Math.min(1, e.translationX / width))))
    .onEnd((e) => setOpen(e.translationX > width * 0.3 || e.velocityX > SWIPE_VELOCITY));

  // 開いているメニューを左へスワイプ → 閉じる
  const closeGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onUpdate((e) => progress.setValue(Math.max(0, Math.min(1, 1 + e.translationX / width))))
    .onEnd((e) => {
      const keepOpen = !(e.translationX < -width * 0.25 || e.velocityX < -SWIPE_VELOCITY);
      setOpen(keepOpen);
      // 状態が変わらない（開いたまま）ときも、元の位置へ戻す
      if (keepOpen) Animated.timing(progress, { toValue: 1, duration: ANIMATION_MS, useNativeDriver: false }).start();
    });

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        {permanent && !collapsed ? (
          <Sidebar width={width} topInset={0} bottomInset={0} onToggle={toggleCollapsed} onNavigate={() => {}} />
        ) : null}
        <View style={[styles.content, { paddingBottom: insets.bottom }]}>
          <ReauthBanner />
          <View style={styles.fill}>{children}</View>
        </View>
      </View>

      {!permanent ? (
        <>
          {!open ? (
            <GestureDetector gesture={openGesture}>
              <View style={[styles.edge, { top: insets.top }]} />
            </GestureDetector>
          ) : null}
          <Animated.View
            pointerEvents={open ? 'auto' : 'none'}
            style={[styles.backdrop, { backgroundColor: colors.overlay, opacity: progress }]}
          >
            <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.close')} onPress={() => setOpen(false)} />
          </Animated.View>
          <GestureDetector gesture={closeGesture}>
            <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.drawer, { width, transform: [{ translateX }] }]}>
              <Sidebar width={width} topInset={insets.top} bottomInset={insets.bottom} onToggle={() => setOpen(false)} onNavigate={() => setOpen(false)} />
            </Animated.View>
          </GestureDetector>
        </>
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
  root: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  edge: { position: 'absolute', left: 0, bottom: 0, width: EDGE_WIDTH, zIndex: 5 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 10 },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 11, flexDirection: 'row' },
});
