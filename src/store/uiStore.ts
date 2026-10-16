import { Platform } from 'react-native';
import { create } from 'zustand';

interface UiState {
  /** 実際に開いているダイアログの数。ネイティブの戻る操作の優先判定にも使う。 */
  dialogCount: number;
  /** ショートカット設定など、画面単位でキーボードショートカットを停止する状態。 */
  shortcutsSuspended: boolean;
  sidebarCollapsed: boolean;
  helpOpen: boolean;
  /** スマホ: メニューが画面に見えている（ヘッダーのメニューアイコンを隠す） */
  menuVisible: boolean;
  /** 全タスク検索ダイアログ */
  globalSearchOpen: boolean;
  /** 全タスク検索を開く際、最初に選択するプロジェクト（null はすべて） */
  globalSearchProjectId: string | null;
  boardSearchFocusTick: number;
  /** 全体検索から遷移した後に開くタスク詳細 */
  pendingTaskDetail: { projectId: string; taskId: string } | null;
  newProjectOpen: boolean;
  pushDialog: () => void;
  popDialog: () => void;
  setShortcutsSuspended: (v: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setHelpOpen: (v: boolean) => void;
  setGlobalSearchOpen: (v: boolean, projectId?: string | null) => void;
  focusBoardSearch: () => void;
  requestTaskDetail: (projectId: string, taskId: string) => void;
  consumePendingTaskDetail: (projectId: string) => string | null;
  requestNewProject: () => void;
  setNewProjectOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  dialogCount: 0,
  shortcutsSuspended: false,
  sidebarCollapsed: Platform.OS === 'web',
  helpOpen: false,
  menuVisible: false,
  globalSearchOpen: false,
  globalSearchProjectId: null,
  boardSearchFocusTick: 0,
  pendingTaskDetail: null,
  newProjectOpen: false,
  pushDialog: () => set((s) => ({ dialogCount: s.dialogCount + 1 })),
  popDialog: () => set((s) => ({ dialogCount: Math.max(0, s.dialogCount - 1) })),
  setShortcutsSuspended: (v) => set({ shortcutsSuspended: v }),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setHelpOpen: (v) => set({ helpOpen: v }),
  setGlobalSearchOpen: (v, projectId = null) =>
    set({ globalSearchOpen: v, globalSearchProjectId: v ? projectId : null }),
  focusBoardSearch: () => set((s) => ({ boardSearchFocusTick: s.boardSearchFocusTick + 1 })),
  requestTaskDetail: (projectId, taskId) => set({ pendingTaskDetail: { projectId, taskId } }),
  consumePendingTaskDetail: (projectId) => {
    let taskId: string | null = null;
    set((s) => {
      if (s.pendingTaskDetail?.projectId !== projectId) return s;
      taskId = s.pendingTaskDetail.taskId;
      return { pendingTaskDetail: null };
    });
    return taskId;
  },
  requestNewProject: () => set({ newProjectOpen: true }),
  setNewProjectOpen: (v) => set({ newProjectOpen: v }),
}));
