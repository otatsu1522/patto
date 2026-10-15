import { Platform } from 'react-native';
import { create } from 'zustand';

interface UiState {
  /** 開いているダイアログの数（ショートカットを止める判断に使う） */
  dialogCount: number;
  sidebarCollapsed: boolean;
  helpOpen: boolean;
  /** スマホ: メニューが画面に見えている（ヘッダーのメニューアイコンを隠す） */
  menuVisible: boolean;
  /** 検索欄にフォーカスさせたいときに増やす */
  searchFocusTick: number;
  boardSearchFocusTick: number;
  /** 全体検索から遷移した後に開くタスク詳細 */
  pendingTaskDetail: { projectId: string; taskId: string } | null;
  newProjectOpen: boolean;
  pushDialog: () => void;
  popDialog: () => void;
  toggleSidebarCollapsed: () => void;
  setHelpOpen: (v: boolean) => void;
  focusSidebarSearch: () => void;
  focusBoardSearch: () => void;
  requestTaskDetail: (projectId: string, taskId: string) => void;
  consumePendingTaskDetail: (projectId: string) => string | null;
  requestNewProject: () => void;
  setNewProjectOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  dialogCount: 0,
  sidebarCollapsed: Platform.OS === 'web',
  helpOpen: false,
  menuVisible: false,
  searchFocusTick: 0,
  boardSearchFocusTick: 0,
  pendingTaskDetail: null,
  newProjectOpen: false,
  pushDialog: () => set((s) => ({ dialogCount: s.dialogCount + 1 })),
  popDialog: () => set((s) => ({ dialogCount: Math.max(0, s.dialogCount - 1) })),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setHelpOpen: (v) => set({ helpOpen: v }),
  focusSidebarSearch: () =>
    set((s) => ({ searchFocusTick: s.searchFocusTick + 1, sidebarCollapsed: false })),
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
