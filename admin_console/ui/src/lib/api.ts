import type { AdminApi } from '@/types/adminApi'
import { AuthExpiredError } from '@/types/admin'

// 浏览器/SSR 兜底: 真实运行在 Electron 渲染进程, window.adminApi 由 preload 注入。
const fallback: AdminApi = {
  platform: 'unknown',
  loadPrefs: async () => ({ serverUrl: '', username: '' }),
  savePrefs: async (p) => p,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => false,
  isWindowMaximized: async () => false,
  isWindowFullScreen: async () => false,
  closeWindow: async () => undefined,
  selectReleaseFile: async () => null,
  uploadRelease: async () => ({}),
  onReleaseUploadProgress: () => () => undefined,
}

export const adminApi: AdminApi =
  typeof window !== 'undefined' && window.adminApi ? window.adminApi : fallback

export function normalizeServerUrl(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
}

// 统一服务端请求: 带鉴权头, 非 2xx 抛错; 401/403 抛 AuthExpiredError 供 store 自动登出。
export async function serverFetch<T = unknown>(
  serverUrl: string,
  token: string,
  pathname: string,
  options: RequestInit = {},
): Promise<T> {
  const base = normalizeServerUrl(serverUrl)
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) {
    throw new AuthExpiredError(text || '登录已失效，请重新登录')
  }
  if (!res.ok) {
    throw new Error(text || `请求失败（${res.status}）`)
  }
  return (text ? JSON.parse(text) : {}) as T
}
