import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAiStore } from '@/store/useAiStore'
import type { AiKind, AiTab } from '@/store/useAiStore'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { canUseTranslation } from '@/lib/aiAccess'
import { useTranslationStore } from '@/store/useTranslationStore'
import { registerAcceptedAiSend } from './reportGptUsage'
import { settingsPrincipalRuntime } from '@/lib/settingsPrincipalRuntime'
import { createPrincipalUrlPersistence } from '@/lib/principalUrlPersistence'
import {
  isGptAllowedUrl,
  isGeminiAllowedUrl,
  isClaudeAllowedUrl,
  normalizeGptUrl,
  normalizeGeminiUrl,
  normalizeClaudeUrl,
  normalizeHttpUrl,
} from './constants'
import type { AiEventPayload, AiTabPayload } from './types'

function safeText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// 各 kind 的 url 归一 / 白名单 / 默认标题。
function normalizeUrlFor(kind: AiKind, url: string): string {
  if (kind === 'gpt') return normalizeGptUrl(url)
  if (kind === 'claude') return normalizeClaudeUrl(url)
  return normalizeGeminiUrl(url)
}
function isAllowedUrlFor(kind: AiKind, url: string): boolean {
  if (kind === 'gpt') return isGptAllowedUrl(url)
  if (kind === 'claude') return isClaudeAllowedUrl(url)
  return isGeminiAllowedUrl(url)
}
function defaultTitleFor(kind: AiKind): string {
  return kind === 'gpt' ? 'ChatGPT' : kind === 'claude' ? 'Claude' : 'Gemini'
}

// 旧 rememberGptUrl / rememberGeminiUrl: url 变更时把 last_url 写回设置。
// 旧版每次 url 事件都整存一次 settings; 这里防抖合并, 仅在值真正变化时落盘。
const URL_PERSIST_DELAY = 600
const principalUrlPersistence = createPrincipalUrlPersistence({
  delayMs: URL_PERSIST_DELAY,
  runtime: settingsPrincipalRuntime,
  patch: (section, lastUrl) =>
    useAppStore.getState().patchSection(section as AiKind, { last_url: lastUrl }),
})

function persistLastUrl(section: AiKind, url: string) {
  principalUrlPersistence.persist(section, url)
}

// 对齐旧 normalizeGptTab (泛化到任意 kind)。
function normalizeTab(kind: AiKind, item: AiTabPayload): AiTab | null {
  const id = safeText(item?.id || item?.tabId)
  if (!id) return null
  const allowExternalBrowsing = kind === 'claude' && Boolean(item.allowExternalBrowsing)
  return {
    id,
    title: safeText(item?.title) || defaultTitleFor(kind),
    url: allowExternalBrowsing
      ? normalizeHttpUrl(safeText(item?.url)) || normalizeClaudeUrl('')
      : normalizeUrlFor(kind, safeText(item?.url)),
    allowExternalBrowsing,
    webviewInitialized: Boolean(item?.initialized),
    webviewLoading: Boolean(item?.loading),
    canGoBack: Boolean(item?.canGoBack),
    canGoForward: Boolean(item?.canGoForward),
  }
}

// 对齐旧 applyGptTabsPayload (泛化)。
function applyTabsPayload(kind: AiKind, payload: AiEventPayload) {
  const rawTabs = Array.isArray(payload?.tabs) ? payload.tabs : []
  const tabs = rawTabs
    .map((item) => normalizeTab(kind, item))
    .filter((tab): tab is AiTab => tab !== null)

  const requestedActive = safeText(payload?.activeTabId)
  const activeTabId = tabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : safeText(tabs[0]?.id)

  useAiStore.getState().setTabs(kind, tabs, activeTabId)

  const activeState = payload?.activeState
  if (activeState && safeText(activeState.tabId)) {
    applyState(kind, activeState)
  }
}

// 对齐旧 applyAiWorkspaceState 的单标签更新 (泛化)。
function applyState(kind: AiKind, payload: AiEventPayload) {
  const store = useAiStore.getState()
  const tabId = safeText(payload.tabId) || store.activeTabIdByKind[kind]
  if (!tabId) return
  const currentTab = store.tabsByKind[kind].find((item) => item.id === tabId)
  const allowExternalBrowsing =
    kind === 'claude' &&
    (typeof payload.allowExternalBrowsing === 'boolean'
      ? payload.allowExternalBrowsing
      : Boolean(currentTab?.allowExternalBrowsing))

  const patch: Partial<AiTab> = {}
  if (typeof payload.allowExternalBrowsing === 'boolean') {
    patch.allowExternalBrowsing = allowExternalBrowsing
  }
  if (typeof payload.initialized === 'boolean') patch.webviewInitialized = payload.initialized
  if (typeof payload.loading === 'boolean') patch.webviewLoading = payload.loading
  if (typeof payload.canGoBack === 'boolean') patch.canGoBack = payload.canGoBack
  if (typeof payload.canGoForward === 'boolean') patch.canGoForward = payload.canGoForward

  const nextTitle = safeText(payload.title)
  if (nextTitle) patch.title = nextTitle

  const nextUrl = safeText(payload.url)
  const normalizedUrl = allowExternalBrowsing
    ? normalizeHttpUrl(nextUrl)
    : isAllowedUrlFor(kind, nextUrl)
      ? normalizeUrlFor(kind, nextUrl)
      : ''
  if (normalizedUrl) patch.url = normalizedUrl

  if (Object.keys(patch).length) store.patchTab(kind, tabId, patch)

  // 旧 rememberGptUrl/rememberGeminiUrl: 仅活动标签的 url 变更写回 last_url。
  if (patch.url && tabId === store.activeTabIdByKind[kind] && !allowExternalBrowsing) {
    persistLastUrl(kind, patch.url)
  }
}

let bound = false

// 全局只绑定一次 onAiEvent (对齐旧 bindAiWorkspaceEvents 的 aiEventsBound 守卫)。
// 在面板挂载时调用; 多面板共用同一订阅, 通过 store 分发到 gpt/gemini。
export function useAiEvents() {
  useEffect(() => {
    if (bound || !api.onAiEvent) return
    bound = true

    api.onAiEvent((raw) => {
      const payload = (raw || {}) as AiEventPayload
      const principal = settingsPrincipalRuntime.current()
      if (
        safeText(payload.principalId) !== principal.principalId ||
        Number(payload.principalGeneration) !== principal.generation
      ) {
        return
      }
      const kind = safeText(payload?.kind) as AiKind
      if (kind !== 'gpt' && kind !== 'gemini' && kind !== 'claude') return

      if (payload?.type === 'translate-selection') {
        const auth = useAuthStore.getState()
        if (!canUseTranslation(auth.token, auth.profile)) return
        useTranslationStore
          .getState()
          .openSelection(
            kind,
            safeText(payload.tabId),
            safeText(payload.environmentId),
            safeText(payload.text),
          )
        return
      }

      if (payload?.type === 'tabs-changed') {
        applyTabsPayload(kind, payload)
        return
      }

      applyState(kind, payload)

      if (payload?.type === 'accepted-send') {
        registerAcceptedAiSend(kind, safeText(payload.usageId))
      }

      if (payload?.type === 'composer-confirmation') {
        const requestId = safeText(payload.requestId)
        const tabId = safeText(payload.tabId)
        const expiresAt = Number(payload.expiresAt)
        if (requestId && tabId && Number.isFinite(expiresAt)) {
          useTranslationStore.getState().setPendingComposerConfirmation({
            kind,
            tabId,
            environmentId: safeText(payload.environmentId),
            requestId,
            targetLanguage: safeText(payload.targetLanguage) || 'en',
            expiresAt,
          })
        }
      }

      if (payload?.type === 'composer-confirmation-invalidated') {
        const current = useTranslationStore.getState().pendingComposerConfirmation
        if (current?.requestId === safeText(payload.requestId)) {
          useTranslationStore.getState().setPendingComposerConfirmation(null)
        }
      }

      if (payload?.type === 'did-fail-load') {
        const store = useAiStore.getState()
        if (safeText(payload.tabId) !== store.activeTabIdByKind[kind]) return
        const errorText =
          safeText(payload.errorDescription) || String(payload.errorCode || '未知错误')
        const label = kind === 'gpt' ? 'GPT' : kind === 'claude' ? 'Claude' : 'Gemini'
        store.setFeedback(kind, `${label} 页面加载失败：${errorText}`, 'error')
      }

      if (payload?.type === 'raw-document-detected' && kind === 'gpt') {
        useAiStore
          .getState()
          .setFeedback(
            kind,
            '检测到 GPT 登录页返回异常文本，程序已自动重试。若仍异常，请刷新一次页面。',
            'warning',
          )
      }

      if (payload?.type === 'external-open-failed') {
        const errorText = safeText(payload.message) || '未知错误'
        useAiStore.getState().setFeedback(kind, `外部链接打开失败：${errorText}`, 'error')
      }

      if (payload?.type === 'dom-ready') {
        const store = useAiStore.getState()
        const tabId = safeText(payload.tabId)
        if (!tabId || tabId === store.activeTabIdByKind[kind]) {
          store.setFeedback(kind, '')
        }
      }
    })
  }, [])
}

// 兼容旧导出名 (AiWorkspace 调用)。
export function applyGptTabsPayload(payload: AiEventPayload) {
  applyTabsPayload('gpt', payload)
}
export function applyAiTabsPayload(kind: AiKind, payload: AiEventPayload) {
  applyTabsPayload(kind, payload)
}
