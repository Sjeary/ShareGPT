// ShareGPT 主进程 IPC 契约 (对应 src/main/preload.js 暴露的 window.api)
// 新渲染层通过此契约与主进程通信; 不可破坏既有方法签名。

export type Unsubscribe = () => void

export interface ShareGptApi {
  platform: NodeJS.Platform | string

  // 设置 / 数据
  loadSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<unknown>
  importSettings: () => Promise<unknown>
  loadChatHistory: () => Promise<unknown>
  saveChatHistory: (payload: unknown) => Promise<unknown>
  exportUserData: () => Promise<unknown>
  importUserData: () => Promise<unknown>
  readClipboardAttachment: () => Promise<unknown>

  // 应用 / 状态
  getStatus: () => Promise<unknown>
  getPaths: () => Promise<unknown>
  getAppMeta: () => Promise<Record<string, unknown>>
  getDeviceInfo: () => Promise<unknown>
  getMode: () => Promise<'sender' | 'receiver' | 'all' | string>
  downloadAppUpdate: (payload: unknown) => Promise<unknown>
  openAppUpdate: (payload: unknown) => Promise<unknown>
  showSystemNotification: (payload: unknown) => Promise<unknown>
  openExternal: (url: string) => Promise<unknown>

  // GPT / AI webview (原生 WebContentsView, 主进程管理)
  listGptViews: () => Promise<unknown>
  createGptView: (payload: unknown) => Promise<unknown>
  switchGptView: (payload: unknown) => Promise<unknown>
  closeGptView: (payload: unknown) => Promise<unknown>
  ensureAiWorkspace: (payload: unknown) => Promise<unknown>
  syncAiViewHost: (payload: unknown) => Promise<unknown>
  navigateAiWorkspace: (payload: unknown) => Promise<unknown>
  executeAiJavaScript: (payload: unknown) => Promise<unknown>

  // profile 独立窗口
  openProfileEditor: (payload: unknown) => Promise<unknown>
  emitProfileUpdated: (payload: unknown) => void

  // 窗口控制
  minimizeWindow: () => Promise<unknown>
  toggleMaximizeWindow: () => Promise<unknown>
  closeWindow: () => Promise<unknown>
  isWindowMaximized: () => Promise<boolean>

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
