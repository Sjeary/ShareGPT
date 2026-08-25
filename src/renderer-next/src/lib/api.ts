import type { ShareGptApi } from '@/types/api'

// 主进程 IPC 桥。dev 在浏览器(无 preload)时给出空安全实现, 便于纯前端调试。
const noop = () => undefined
const fallback = {
  platform: 'web',
  setThemeSource: async () => undefined,
  loadSettings: async () => ({}),
  saveSettings: async () => undefined,
  patchSettings: async () => ({}),
  importSettings: async () => undefined,
  loadChatHistory: async () => ({}),
  saveChatHistory: async () => undefined,
  loadCalendar: async () => ({ version: 1, calendars: [], events: [] }),
  saveCalendar: async () => undefined,
  loadTasks: async () => ({ version: 1, lists: [], tasks: [], memos: [] }),
  saveTasks: async () => undefined,
  loadFocus: async () => ({ version: 1, sessions: [], settings: null }),
  saveFocus: async () => undefined,
  vault: {
    start: async () => undefined,
    getRoot: async () => '',
    chooseRoot: async () => null,
    chooseImport: async () => null,
    list: async () => [],
    readAll: async () => [],
    read: async () => ({ path: '', content: '', mtime: 0, ctime: 0 }),
    readBinary: async () => null,
    write: async () => ({ path: '', mtime: 0 }),
    create: async () => ({ path: '', content: '', mtime: 0, ctime: 0 }),
    rename: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  },
  onVaultChanged: () => noop,
  notesAi: {
    complete: async () => ({ streamId: '' }),
    cancel: async () => ({ ok: true }),
  },
  onNotesAiEvent: () => noop,
  translateText: async () => {
    throw new Error('仅桌面客户端支持翻译接口')
  },
  cancelTranslation: async () => ({ ok: false }),
  captureAiPageText: async () => {
    throw new Error('仅桌面客户端支持整页读取')
  },
  exportUserData: async () => undefined,
  importUserData: async () => undefined,
  readClipboardAttachment: async () => undefined,
  getStatus: async () => ({}),
  getPaths: async () => ({}),
  getAppMeta: async () => ({}),
  getDeviceInfo: async () => ({}),
  getMode: async () => 'all',
  checkAppUpdate: async () => null,
  isUpdateSupported: async () => false,
  installAppUpdate: async () => ({ updated: false }),
  downloadAppUpdate: async () => undefined,
  openAppUpdate: async () => undefined,
  showSystemNotification: async () => undefined,
  openExternal: async () => undefined,
  listAiViews: async () => ({ tabs: [], activeTabId: '', activeState: null }),
  createAiView: async () => undefined,
  switchAiView: async () => undefined,
  closeAiView: async () => undefined,
  setActiveAiKind: async () => ({ activeKind: '' }),
  closeAllAiWorkspaces: async () => ({ ok: true }),
  ensureAiWorkspace: async () => undefined,
  activateAiEnvironment: async () => ({ ok: true }),
  deleteAiEnvironment: async () => ({ ok: true }),
  checkAiEnvironmentEgress: async () => {
    throw new Error('仅桌面客户端支持出口检测')
  },
  syncAiViewHost: async () => undefined,
  navigateAiWorkspace: async () => undefined,
  checkAiProxy: async () => ({ ok: false, reason: 'unavailable' }),
  clearAiBrowserData: async () => ({
    ok: false,
    kind: 'gpt',
    clearedAt: '',
    homeUrl: '',
  }),
  rebuildAiBrowserProfile: async () => ({
    ok: false,
    kind: 'gpt',
    rebuiltAt: '',
    partition: '',
    homeUrl: '',
  }),
  captureBrowserFingerprint: async () => {
    throw new Error('仅桌面客户端支持网页可见信息采集')
  },
  applyBrowserPrivacy: async () => ({ ok: false, results: [] }),
  detectProxyEnvironment: async () => {
    throw new Error('仅桌面客户端支持出口环境检测')
  },
  installAiQueryTracker: async () => false,
  openProfileEditor: async () => undefined,
  emitProfileUpdated: noop,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => undefined,
  closeWindow: async () => undefined,
  isWindowMaximized: async () => false,
  isWindowFullScreen: async () => false,
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

export const api: ShareGptApi = typeof window !== 'undefined' && window.api ? window.api : fallback

export const hasNativeBridge = typeof window !== 'undefined' && Boolean(window.api)
