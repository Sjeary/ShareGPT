import { create } from 'zustand'

// 知识库面板的纯 UI 状态 (布局/视图/检索/叠层), 与数据 store(useVaultStore) 分离。
export type CenterMode = 'edit' | 'preview' | 'graph'
export type RightTab = 'backlinks' | 'outline' | 'properties' | 'ai'

interface NotesUiState {
  centerMode: CenterMode
  rightTab: RightTab
  showLeft: boolean
  showRight: boolean
  query: string
  tagFilter: string
  quickOpen: boolean
  paletteOpen: boolean
  graphFullscreen: boolean
  autoLinkOpen: boolean

  setCenterMode: (m: CenterMode) => void
  setRightTab: (t: RightTab) => void
  toggleLeft: () => void
  toggleRight: () => void
  setQuery: (q: string) => void
  setTagFilter: (t: string) => void
  setQuickOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  setGraphFullscreen: (v: boolean) => void
  setAutoLinkOpen: (v: boolean) => void
}

export const useNotesUi = create<NotesUiState>((set) => ({
  centerMode: 'edit',
  rightTab: 'backlinks',
  showLeft: true,
  showRight: true,
  query: '',
  tagFilter: '',
  quickOpen: false,
  paletteOpen: false,
  graphFullscreen: false,
  autoLinkOpen: false,

  setCenterMode: (centerMode) => set({ centerMode }),
  setRightTab: (rightTab) => set({ rightTab }),
  toggleLeft: () => set((s) => ({ showLeft: !s.showLeft })),
  toggleRight: () => set((s) => ({ showRight: !s.showRight })),
  setQuery: (query) => set({ query }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setQuickOpen: (quickOpen) => set({ quickOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setGraphFullscreen: (graphFullscreen) => set({ graphFullscreen }),
  setAutoLinkOpen: (autoLinkOpen) => set({ autoLinkOpen }),
}))
