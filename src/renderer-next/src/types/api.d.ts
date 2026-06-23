// ShareGPT 主进程 IPC 契约 (对应 src/main/preload.js 暴露的 window.api)
// 新渲染层通过此契约与主进程通信; 不可破坏既有方法签名。

export type Unsubscribe = () => void

// AI 页面代理检测结果 (ai:proxy-check)。
export interface AiProxyHost {
  host: string
  via: 'proxy' | 'fallback'
}
export interface AiProxyReport {
  ok: boolean
  reason?: string
  kind?: 'gpt' | 'gemini' | 'claude'
  tabId?: string
  currentUrl?: string
  socksEndpoint?: string
  sessionProxy?: string
  sessionProxied?: boolean
  proxyCount?: number
  fallbackCount?: number
  hosts?: AiProxyHost[]
}

// 本地功能存储的文件壳 (具体条目类型见各功能 store)。
export interface CalendarStoreFile {
  version?: number
  updatedAt?: string
  calendars?: unknown[]
  events?: unknown[]
}
export interface TasksStoreFile {
  version?: number
  updatedAt?: string
  lists?: unknown[]
  tasks?: unknown[]
  memos?: unknown[]
}

// —— 知识库 vault (笔记文件 IO; 解析/索引在渲染层) ——
export interface VaultFileMeta {
  path: string // vault 内相对路径 (正斜杠)
  mtime: number
  ctime: number
  size?: number
}
export interface VaultFile {
  path: string
  content: string
  mtime: number
  ctime: number
}
export interface VaultImportReport {
  notes: number
  attachments: number
  skipped: number
  root: string
}
export interface VaultChangeEvent {
  events: { type: 'add' | 'change' | 'unlink'; path: string }[]
}
export interface VaultApi {
  start: () => Promise<void>
  getRoot: () => Promise<string>
  setRoot: (absPath: string) => Promise<{ ok: boolean; root: string; count: number }>
  pickFolder: () => Promise<string | null>
  list: () => Promise<VaultFileMeta[]>
  readAll: () => Promise<VaultFile[]>
  read: (path: string) => Promise<VaultFile>
  readBinary: (path: string) => Promise<{ dataUrl: string; mime: string } | null>
  write: (path: string, content: string) => Promise<{ path: string; mtime: number }>
  create: (path: string, content?: string) => Promise<VaultFile>
  rename: (from: string, to: string) => Promise<{ ok: boolean }>
  remove: (path: string) => Promise<{ ok: boolean }>
  importFrom: (src: string) => Promise<VaultImportReport>
}

export interface ShareGptApi {
  platform: NodeJS.Platform | string

  // 让内嵌网页明暗跟随 app 主题 (nativeTheme.themeSource)。
  setThemeSource: (source: 'dark' | 'light' | 'system') => Promise<unknown>

  // 设置 / 数据
  loadSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<unknown>
  importSettings: () => Promise<unknown>
  loadChatHistory: () => Promise<unknown>
  saveChatHistory: (payload: unknown) => Promise<unknown>
  // 个人日历 / 任务+备忘录 本地存储 (结构由各自 store 维护; 这里用宽松的文件壳类型)。
  loadCalendar: () => Promise<CalendarStoreFile>
  saveCalendar: (payload: CalendarStoreFile) => Promise<unknown>
  loadTasks: () => Promise<TasksStoreFile>
  saveTasks: (payload: TasksStoreFile) => Promise<unknown>
  // 知识库 vault
  vault: VaultApi
  onVaultChanged: (handler: (payload: VaultChangeEvent) => void) => Unsubscribe
  exportUserData: () => Promise<unknown>
  importUserData: () => Promise<unknown>
  readClipboardAttachment: () => Promise<unknown>

  // 应用 / 状态
  getStatus: () => Promise<unknown>
  getPaths: () => Promise<unknown>
  getAppMeta: () => Promise<Record<string, unknown>>
  getDeviceInfo: () => Promise<unknown>
  getMode: () => Promise<'sender' | 'receiver' | 'all' | string>
  checkAppUpdate: () => Promise<unknown>
  isUpdateSupported: () => Promise<boolean>
  installAppUpdate: () => Promise<unknown>
  downloadAppUpdate: (payload: unknown) => Promise<unknown>
  openAppUpdate: (payload: unknown) => Promise<unknown>
  showSystemNotification: (payload: unknown) => Promise<unknown>
  openExternal: (url: string) => Promise<unknown>

  // GPT / AI webview (原生 WebContentsView, 主进程管理)
  // AI 标签 (GPT / Gemini / Claude 通用, 传 kind)
  listAiViews: (kind: 'gpt' | 'gemini' | 'claude') => Promise<unknown>
  createAiView: (kind: 'gpt' | 'gemini' | 'claude', payload?: unknown) => Promise<unknown>
  switchAiView: (kind: 'gpt' | 'gemini' | 'claude', payload?: unknown) => Promise<unknown>
  closeAiView: (kind: 'gpt' | 'gemini' | 'claude', payload?: unknown) => Promise<unknown>
  ensureAiWorkspace: (payload: unknown) => Promise<unknown>
  syncAiViewHost: (payload: unknown) => Promise<unknown>
  navigateAiWorkspace: (payload: unknown) => Promise<unknown>
  // 代理检测: 检查该 AI 页面流量是否全部经发送代理 (梯子)。
  checkAiProxy: (kind: 'gpt' | 'gemini' | 'claude', tabId?: string) => Promise<AiProxyReport>
  executeAiJavaScript: (payload: unknown) => Promise<unknown>

  // profile 独立窗口
  openProfileEditor: (payload: unknown) => Promise<unknown>
  emitProfileUpdated: (payload: unknown) => void

  // 窗口控制
  minimizeWindow: () => Promise<unknown>
  toggleMaximizeWindow: () => Promise<unknown>
  closeWindow: () => Promise<unknown>
  isWindowMaximized: () => Promise<boolean>
  isWindowFullScreen: () => Promise<boolean>
  toggleWindowFullScreen: (value?: boolean) => Promise<boolean>

  // 服务启停
  startSender: (settings: unknown) => Promise<unknown>
  stopSender: () => Promise<unknown>
  startReceiver: (settings: unknown) => Promise<unknown>
  stopReceiver: () => Promise<unknown>

  // 事件订阅 (返回退订函数)
  onLog: (handler: (payload: unknown) => void) => Unsubscribe
  onStatus: (handler: (payload: unknown) => void) => Unsubscribe
  onProfileUpdated: (handler: (payload: unknown) => void) => Unsubscribe
  onAiEvent: (handler: (payload: unknown) => void) => Unsubscribe
  onAppEvent: (handler: (payload: unknown) => void) => Unsubscribe
  onAppUpdateProgress: (handler: (payload: unknown) => void) => Unsubscribe
}

declare global {
  interface Window {
    api: ShareGptApi
  }
}

export {}
