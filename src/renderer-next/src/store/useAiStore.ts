import { create } from 'zustand'

// AI 网页工作区状态切片 (GPT / Gemini 均多标签)。
// 真正的 WebContentsView 在主进程, 这里只镜像运行态用于渲染控制条/标签/遮罩。
// 状态按 kind 索引, 两种网页同构 (对齐主进程的标签泛化)。

export type AiKind = 'gpt' | 'gemini'

export interface AiTab {
  id: string
  title: string
  url: string
  webviewInitialized: boolean
  webviewLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}
// 兼容旧引用名。
export type GptTab = AiTab

interface AiStore {
  tabsByKind: Record<AiKind, AiTab[]>
  activeTabIdByKind: Record<AiKind, string>
  // 网页加载/导航错误反馈 (控制条下方提示)
  feedbackByKind: Record<AiKind, { text: string; tone: string }>

  setTabs: (kind: AiKind, tabs: AiTab[], activeTabId: string) => void
  patchTab: (kind: AiKind, tabId: string, patch: Partial<AiTab>) => void
  setFeedback: (kind: AiKind, text: string, tone?: string) => void
}

export const useAiStore = create<AiStore>((set) => ({
  tabsByKind: { gpt: [], gemini: [] },
  activeTabIdByKind: { gpt: '', gemini: '' },
  feedbackByKind: {
    gpt: { text: '', tone: '' },
    gemini: { text: '', tone: '' },
  },

  setTabs: (kind, tabs, activeTabId) =>
    set((s) => ({
      tabsByKind: { ...s.tabsByKind, [kind]: tabs },
      activeTabIdByKind: { ...s.activeTabIdByKind, [kind]: activeTabId },
    })),

  patchTab: (kind, tabId, patch) =>
    set((s) => ({
      tabsByKind: {
        ...s.tabsByKind,
        [kind]: s.tabsByKind[kind].map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
      },
    })),

  setFeedback: (kind, text, tone = '') =>
    set((s) => ({
      feedbackByKind: { ...s.feedbackByKind, [kind]: { text, tone } },
    })),
}))
