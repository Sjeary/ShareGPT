import { AuthExpiredError } from '../types/admin.ts'
import type {
  AdminAirport,
  AdminInvite,
  AdminReleases,
  AdminUser,
  AiUsageFilters,
  AiUsageReport,
  Bootstrap,
  CreateInviteInput,
  CreateUserInput,
  FeedbackItem,
  ProxyMissingItem,
  ProxyRoute,
  ProxyRouteCatalog,
  ProxyRouteHealth,
  ReleaseUploadInput,
  TranslationProfileCatalog,
  TranslationUsageFilters,
  TranslationUsageReport,
  UpdateUserInput,
} from '../types/admin.ts'

export class AdminApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

export class AdminUnsupportedError extends AdminApiError {
  constructor(operation: string) {
    super(`当前服务端不支持${operation}`, 405)
    this.name = 'AdminUnsupportedError'
  }
}

// These operations have no server endpoint. Do not emulate deletion by disabling
// an account or changing global developer releases under administrator authority.
export const adminCapabilities = Object.freeze({
  deleteUser: false,
  deleteFeedback: false,
  clearProxyMissing: false,
  deleteRelease: false,
  uploadLegacyRelease: true,
  activeProxyProbe: false,
  developerReleaseManagement: false,
})

export function normalizeServerUrl(raw: string): string {
  const url = new URL(raw.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AdminApiError('服务地址必须是无凭据、查询参数和片段的 HTTP/HTTPS 地址')
  }
  return url.href.replace(/\/+$/, '')
}

export interface AdminRequestOptions extends RequestInit {
  timeoutMs?: number
}

function errorMessage(text: string, status: number): string {
  try {
    const value = JSON.parse(text)
    for (const candidate of [value?.message, value?.error?.message, value?.error]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  } catch {
    /* plain text server errors are supported */
  }
  return text.trim() || `请求失败（${status}）`
}

export async function adminFetch<T>(
  serverUrl: string,
  token: string,
  pathname: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const base = normalizeServerUrl(serverUrl)
  if (!token) throw new AuthExpiredError()
  if (
    !pathname.startsWith('/api/admin/') ||
    new URL(`${base}${pathname}`).origin !== new URL(base).origin
  ) {
    throw new AdminApiError('无效的管理接口地址')
  }
  const { timeoutMs = 15000, signal, ...init } = options
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(
    () => controller.abort(new DOMException('请求超时', 'TimeoutError')),
    timeoutMs,
  )
  try {
    controller.signal.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${base}${pathname}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    })
    const body = await response.text()
    controller.signal.throwIfAborted()
    if (response.status === 401 || response.status === 403) {
      throw new AuthExpiredError(errorMessage(body, response.status))
    }
    if (!response.ok) throw new AdminApiError(errorMessage(body, response.status), response.status)
    try {
      return (body ? JSON.parse(body) : {}) as T
    } catch {
      throw new AdminApiError('服务端返回了无效的 JSON', response.status)
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

function query(filters: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') params.set(key, String(value))
  return params.size ? `?${params}` : ''
}

export function createAdminApi(serverUrl: string, token: string, signal?: AbortSignal) {
  const request = <T>(path: string, options?: AdminRequestOptions) =>
    adminFetch<T>(serverUrl, token, `/api/admin/${path}`, { ...options, signal })
  const json = <T>(path: string, method: string, body: unknown) =>
    request<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return {
    loadUsers: () => request<{ users: AdminUser[] }>('users').then((r) => r.users),
    createUser: (input: CreateUserInput) =>
      json<{ user: AdminUser }>('users', 'POST', input).then((r) => r.user),
    updateUser: (username: string, input: UpdateUserInput) =>
      json<{ user: AdminUser }>(`users/${encodeURIComponent(username)}`, 'PATCH', input).then(
        (r) => r.user,
      ),
    resetPassword: (username: string, password: string) =>
      json<{ user: AdminUser }>(`users/${encodeURIComponent(username)}`, 'PATCH', {
        password,
      }).then((r) => r.user),
    deleteUser: async (_username: string): Promise<never> => {
      throw new AdminUnsupportedError('删除用户；可使用禁用账号')
    },
    loadInvites: () => request<{ invites: AdminInvite[] }>('invites').then((r) => r.invites),
    createInvite: (input: CreateInviteInput) =>
      json<{ invite: AdminInvite }>('invites', 'POST', input).then((r) => r.invite),
    revokeInvite: (id: string) =>
      json<{ ok: boolean }>(`invites/${encodeURIComponent(id)}/revoke`, 'POST', {}),
    loadBootstrap: () => request<Bootstrap>('bootstrap'),
    saveBootstrap: (input: Bootstrap) =>
      json<{ bootstrap: Bootstrap }>('bootstrap', 'PUT', input).then((r) => r.bootstrap),
    loadProxyRoutes: () => request<ProxyRouteCatalog>('proxy-routes'),
    saveProxyRoutes: (routes: ProxyRoute[]) =>
      json<ProxyRouteCatalog>('proxy-routes', 'PUT', { routes }),
    // Reports are produced by clients; this endpoint does not initiate a probe.
    checkProxyRouteHealth: () =>
      request<{ reports: ProxyRouteHealth[] }>('proxy-route-health').then((r) => r.reports),
    loadAiUsage: (filters: AiUsageFilters = {}) =>
      request<AiUsageReport>(`ai-usage${query({ ...filters, service: filters.service || 'gpt' })}`),
    loadTranslationProfiles: () => request<TranslationProfileCatalog>('translation-profiles'),
    saveTranslationProfiles: (
      defaultProfileId: string,
      profiles: TranslationProfileCatalog['profiles'],
    ) =>
      json<TranslationProfileCatalog>('translation-profiles', 'PUT', {
        defaultProfileId,
        profiles,
      }),
    loadTranslationUsage: (filters: TranslationUsageFilters = {}) =>
      request<TranslationUsageReport>(`translation-usage${query(filters)}`),
    loadFeedback: () => request<{ feedback: FeedbackItem[] }>('feedback').then((r) => r.feedback),
    deleteFeedback: async (_id: string): Promise<never> => {
      throw new AdminUnsupportedError('删除反馈')
    },
    loadProxyMissing: () =>
      request<{ domains: ProxyMissingItem[] }>('proxy-missing').then((r) => r.domains),
    clearProxyMissing: async (): Promise<never> => {
      throw new AdminUnsupportedError('清空缺失域名')
    },
    loadReleases: () => request<Bootstrap>('bootstrap').then((r): AdminReleases => r.update),
    deleteRelease: async (_version: string): Promise<never> => {
      throw new AdminUnsupportedError('删除发布版本')
    },
    loadAirport: () => request<AdminAirport>('airport'),
    saveAirport: (airport: AdminAirport) =>
      json<{ airport: AdminAirport }>('airport', 'PUT', airport).then((r) => r.airport),
    // Legacy per-server upload only. Global /api/dev publishing needs a separate
    // developer identity. File picking and upload progress are UI responsibilities.
    uploadRelease: (input: ReleaseUploadInput) =>
      request<{ bootstrap: Bootstrap; fileName: string; url: string }>(
        `releases/upload${query({ platform: input.platform, fileName: input.fileName, version: input.version, notes: input.notes })}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: input.file,
          timeoutMs: 300000,
        },
      ),
  }
}

export type IntegratedAdminApi = ReturnType<typeof createAdminApi>
