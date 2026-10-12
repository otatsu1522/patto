import { create } from 'zustand';

interface UiState {
  /** 開いているダイアログの数（ショートカットを止める判断に使う） */
  dialogCount: number;
  sidebarCollapsed: boolean;
  helpOpen: boolean;
  /** 検索欄にフォーカスさせたいときに増やす */
  searchFocusTick: number;
  boardSearchFocusTick: number;
  newProjectOpen: boolean;
  pushDialog: () => void;
  popDialog: () => void;
  toggleSidebarCollapsed: () => void;
  setHelpOpen: (v: boolean) => void;
  focusSidebarSearch: () => void;
  focusBoardSearch: () => void;
  requestNewProject: () => void;
  setNewProjectOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  dialogCount: 0,
  sidebarCollapsed: false,
  helpOpen: false,
  searchFocusTick: 0,
  boardSearchFocusTick: 0,
  newProjectOpen: false,
  pushDialog: () => set((s) => ({ dialogCount: s.dialogCount + 1 })),
  popDialog: () => set((s) => ({ dialogCount: Math.max(0, s.dialogCount - 1) })),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setHelpOpen: (v) => set({ helpOpen: v }),
  focusSidebarSearch: () => set((s) => ({ searchFocusTick: s.searchFocusTick + 1, sidebarCollapsed: false })),
  focusBoardSearch: () => set((s) => ({ boardSearchFocusTick: s.boardSearchFocusTick + 1 })),
  requestNewProject: () => set({ newProjectOpen: true }),
  setNewProjectOpen: (v) => set({ newProjectOpen: v }),
}));
