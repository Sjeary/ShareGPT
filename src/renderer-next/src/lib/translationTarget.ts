import type { TranslationProvider } from '../types/settings.ts'

export interface TranslationTargetDisplay {
  label: string
  title: string
}

export function describeTranslationTarget(
  provider: TranslationProvider,
  baseUrl: string,
): TranslationTargetDisplay {
  const value = baseUrl.trim()
  if (!value) return { label: '未配置', title: '尚未配置接口地址' }

  try {
    const url = new URL(value)
    const host = url.host || url.hostname
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase())
    if (provider === 'offline' && local) {
      return { label: `本机 · ${host}`, title: url.origin }
    }
    return { label: host, title: url.origin }
  } catch {
    return { label: '地址无效', title: '当前接口地址无法解析' }
  }
}
