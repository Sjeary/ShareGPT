export interface ManagedTranslationProfile {
  id: string
  name: string
  type: 'ai' | 'api'
  model: string
}

export interface ManagedTranslationCatalog {
  version: 1
  defaultProfileId: string
  profiles: ManagedTranslationProfile[]
}

function normalizeServerUrl(raw: string) {
  const value = String(raw || '')
    .trim()
    .replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) throw new Error('请先登录协作服务器')
  return value
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw new Error('协作服务器登录已失效，请重新登录')
  }
  if (!response.ok) throw new Error(text || `托管翻译请求失败（${response.status}）`)
  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new Error('协作服务器返回了无效数据')
  }
}

export async function fetchManagedTranslationProfiles(
  serverUrl: string,
  token: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ManagedTranslationCatalog> {
  if (!token) throw new Error('请先登录协作服务器')
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(`${normalizeServerUrl(serverUrl)}/api/translation/profiles`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  })
  const payload = await readResponse<Partial<ManagedTranslationCatalog>>(response)
  return {
    version: 1,
    defaultProfileId: String(payload.defaultProfileId || ''),
    profiles: Array.isArray(payload.profiles)
      ? payload.profiles
          .map((profile) => ({
            id: String(profile?.id || ''),
            name: String(profile?.name || ''),
            type: profile?.type === 'api' ? ('api' as const) : ('ai' as const),
            model: String(profile?.model || ''),
          }))
          .filter((profile) => profile.id && profile.name)
      : [],
  }
}

export async function managedTranslate(
  serverUrl: string,
  token: string,
  request: {
    profileId?: string
    text: string
    source: string
    target: string
    style: string
    glossary: string
    requestId: string
  },
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<{ translatedText: string; profileId: string }> {
  if (!token) throw new Error('请先登录协作服务器')
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(`${normalizeServerUrl(serverUrl)}/api/translation/translate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: options.signal,
  })
  const payload = await readResponse<{ translatedText?: string; profileId?: string }>(response)
  const translatedText = String(payload.translatedText || '').trim()
  if (!translatedText) throw new Error('托管翻译服务没有返回译文')
  return { translatedText, profileId: String(payload.profileId || '') }
}

export function createManagedTranslationRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `managed-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}
