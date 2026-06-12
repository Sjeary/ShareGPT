import { create } from 'zustand'

// AI 网页工作区状态切片 (GPT 多标签 + Gemini 单视图)。
// 真正的 WebContentsView 在主进程, 这里只镜像运行态用于渲染控制条/标签/遮罩。
// 对应旧 renderer.js state.gpt / state.gemini 中与网页相关的字段。

export type AiKind = 'gpt' | 'gemini'

export interface GptTab {
  id: string
  title: string
  url: string
  webviewInitialized: boolean
  webviewLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

// Gemini 单视图运行态。
export interface AiViewState {
  webviewInitialized: boolean
  webviewLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastUrl: string
}

interface AiStore {
  // GPT 多标签
  gptTabs: GptTab[]
  gptActiveTabId: string
  // 网页加载/导航错误反馈 (控制条下方提示)
  gptFeedback: { text: string; tone: string }

  // Gemini 单视图
  gemini: AiViewState
  geminiFeedback: { text: string; tone: string }

  setGptTabs: (tabs: GptTab[], activeTabId: string) => void
  patchGptTab: (tabId: string, patch: Partial<GptTab>) => void
  setGptFeedback: (text: string, tone?: string) => void

  patchGemini: (patch: Partial<AiViewState>) => void
  setGeminiFeedback: (text: string, tone?: string) => void
}

const EMPTY_GEMINI: AiViewState = {
  webviewInitialized: false,
  webviewLoading: false,
  canGoBack: false,
  canGoForward: false,
  lastUrl: '',
}

export const useAiStore = create<AiStore>((set) => ({
  gptTabs: [],
  gptActiveTabId: '',
  gptFeedback: { text: '', tone: '' },

  gemini: { ...EMPTY_GEMINI },
  geminiFeedback: { text: '', tone: '' },

  setGptTabs: (tabs, activeTabId) => set({ gptTabs: tabs, gptActiveTabId: activeTabId }),

  patchGptTab: (tabId, patch) =>
    set((s) => ({
      gptTabs: s.gptTabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
    })),

  setGptFeedback: (text, tone = '') => set({ gptFeedback: { text, tone } }),

  patchGemini: (patch) => set((s) => ({ gemini: { ...s.gemini, ...patch } })),

  setGeminiFeedback: (text, tone = '') => set({ geminiFeedback: { text, tone } }),
}))
