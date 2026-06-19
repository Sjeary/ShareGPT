// 主进程 preload 暴露的 window.adminApi 契约 (对应 admin_console/src/main/preload.js)。

export interface ReleaseFilePick {
  filePath: string
  fileName: string
  size: number
}

export interface ReleaseUploadProgress {
  platformKey: 'windows' | 'macos'
  fileName: string
  transferred: number
  total: number
  percent: number
  done?: boolean
}

export interface ReleaseUploadPayload {
  serverUrl: string
  token: string
  filePath: string
  platformKey: 'windows' | 'macos'
  version: string
  notes: string
  // 上传端点: 群管理员默认 /api/admin/releases/upload; 开发者用 /api/dev/releases/upload。
  uploadPath?: string
}

export interface AdminPrefs {
  serverUrl: string
  username: string
}

export interface AdminApi {
  platform: NodeJS.Platform | string
  loadPrefs: () => Promise<AdminPrefs>
  savePrefs: (payload: AdminPrefs) => Promise<AdminPrefs>
  minimizeWindow: () => Promise<unknown>
  toggleMaximizeWindow: () => Promise<boolean>
  isWindowMaximized: () => Promise<boolean>
  isWindowFullScreen: () => Promise<boolean>
  closeWindow: () => Promise<unknown>
  selectReleaseFile: () => Promise<ReleaseFilePick | null>
  uploadRelease: (payload: ReleaseUploadPayload) => Promise<{ bootstrap?: unknown }>
  onReleaseUploadProgress: (handler: (payload: ReleaseUploadProgress) => void) => () => void
}

declare global {
  interface Window {
    adminApi: AdminApi
  }
}

export {}
