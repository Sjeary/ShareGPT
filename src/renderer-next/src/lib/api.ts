import type { ShareGptApi } from '@/types/api'

// 主进程 IPC 桥。dev 在浏览器(无 preload)时给出空安全实现, 便于纯前端调试。
const noop = () => undefined
const fallback = {
  platform: 'web',
  setThemeSource: async () => undefined,
  loadSettings: async () => ({}),
  saveSettings: async () => undefined,
  importSettings: async () => undefined,
  loadChatHistory: async () => ({}),
  saveChatHistory: async () => undefined,
  exportUserData: async () => undefined,
  importUserData: async () => undefined,
  readClipboardAttachment: async () => undefined,
  getStatus: async () => ({}),
  getPaths: async () => ({}),
  getAppMeta: async () => ({}),
  getDeviceInfo: async () => ({}),
  getMode: async () => 'all',
  downloadAppUpdate: async () => undefined,
  openAppUpdate: async () => undefined,
  showSystemNotification: async () => undefined,
  openExternal: async () => undefined,
  listAiViews: async () => ({ tabs: [], activeTabId: '', activeState: null }),
  createAiView: async () => undefined,
  switchAiView: async () => undefined,
  closeAiView: async () => undefined,
  ensureAiWorkspace: async () => undefined,
  syncAiViewHost: async () => undefined,
  navigateAiWorkspace: async () => undefined,
  checkAiProxy: async () => ({ ok: false, reason: 'unavailable' }),
  executeAiJavaScript: async () => undefined,
  openProfileEditor: async () => undefined,
  emitProfileUpdated: noop,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => undefined,
  closeWindow: async () => undefined,
  isWindowMaximized: async () => false,
  startSender: async () => undefined,
  stopSender: async () => undefined,
  startReceiver: async () => undefined,
  stopReceiver: async () => undefined,
  onLog: () => noop,
  onStatus: () => noop,
  onProfileUpdated: () => noop,
  onAiEvent: () => noop,
  onAppEvent: () => noop,
  onAppUpdateProgress: () => noop,
} as unknown as ShareGptApi

export const api: ShareGptApi =
  typeof window !== 'undefined' && window.api ? window.api : fallback

export const hasNativeBridge =
  typeof window !== 'undefined' && Boolean(window.api)
