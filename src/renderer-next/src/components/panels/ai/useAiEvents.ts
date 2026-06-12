import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAiStore } from '@/store/useAiStore'
import type { GptTab } from '@/store/useAiStore'
import { useAppStore } from '@/store/useAppStore'
import { registerGptQuery } from './reportGptUsage'
import {
  GPT_QUERY_MARKER,
  isGptAllowedUrl,
  isGeminiAllowedUrl,
  normalizeGptUrl,
  normalizeGeminiUrl,
} from './constants'
import type { AiEventPayload, AiTabPayload } from './types'

function safeText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// 旧 rememberGptUrl / rememberGeminiUrl: url 变更时把 last_url 写回设置。
// 旧版每次 url 事件都整存一次 settings; 这里防抖合并, 仅在值真正变化时落盘。
const URL_PERSIST_DELAY = 600
const persistTimers: Record<'gpt' | 'gemini', ReturnType<typeof setTimeout> | null> = {
  gpt: null,
  gemini: null,
}
const lastPersistedUrl: Record<'gpt' | 'gemini', string> = { gpt: '', gemini: '' }

function persistLastUrl(section: 'gpt' | 'gemini', url: string) {
  const next = safeText(url)
  if (!next || next === lastPersistedUrl[section]) return
  lastPersistedUrl[section] = next

  const timer = persistTimers[section]
  if (timer) clearTimeout(timer)
  persistTimers[section] = setTimeout(() => {
    persistTimers[section] = null
    void useAppStore
      .getState()
      .patchSection(section, { last_url: next })
      .catch(() => {
        // 保存页面位置失败不阻塞工作区; 允许下次再写。
        lastPersistedUrl[section] = ''
      })
  }, URL_PERSIST_DELAY)
}

// 对齐旧 normalizeGptTab。
function normalizeTab(item: AiTabPayload): GptTab | null {
  const id = safeText(item?.id || item?.tabId)
  if (!id) return null
  return {
    id,
    title: safeText(item?.title) || 'ChatGPT',
    url: normalizeGptUrl(safeText(item?.url)),
    webviewInitialized: Boolean(item?.initialized),
    webviewLoading: Boolean(item?.loading),
    canGoBack: Boolean(item?.canGoBack),
    canGoForward: Boolean(item?.canGoForward),
  }
}

// 对齐旧 applyGptTabsPayload。
function applyGptTabsPayload(payload: AiEventPayload) {
  const rawTabs = Array.isArray(payload?.tabs) ? payload.tabs : []
  const tabs = rawTabs
    .map((item) => normalizeTab(item))
    .filter((tab): tab is GptTab => tab !== null)

  const requestedActive = safeText(payload?.activeTabId)
  const activeTabId = tabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : safeText(tabs[0]?.id)

  useAiStore.getState().setGptTabs(tabs, activeTabId)

  const activeState = payload?.activeState
  if (activeState && safeText(activeState.tabId)) {
    applyGptState(activeState)
  }
}

// 对齐旧 applyAiWorkspaceState(kind==="gpt") 的单标签更新。
function applyGptState(payload: AiEventPayload) {
  const store = useAiStore.getState()
  const tabId = safeText(payload.tabId) || store.gptActiveTabId
  if (!tabId) return

  const patch: Partial<GptTab> = {}
  if (typeof payload.initialized === 'boolean') patch.webviewInitialized = payload.initialized
  if (typeof payload.loading === 'boolean') patch.webviewLoading = payload.loading
  if (typeof payload.canGoBack === 'boolean') patch.canGoBack = payload.canGoBack
  if (typeof payload.canGoForward === 'boolean') patch.canGoForward = payload.canGoForward

  const nextTitle = safeText(payload.title)
  if (nextTitle) patch.title = nextTitle

  const nextUrl = safeText(payload.url)
  if (nextUrl && isGptAllowedUrl(nextUrl)) patch.url = normalizeGptUrl(nextUrl)

  if (Object.keys(patch).length) store.patchGptTab(tabId, patch)

  // 旧 rememberGptUrl: 仅活动标签的 url 变更写回 last_url。
  if (patch.url && tabId === store.gptActiveTabId) persistLastUrl('gpt', patch.url)
}

// 对齐旧 applyAiWorkspaceState(kind==="gemini")。
function applyGeminiState(payload: AiEventPayload) {
  const store = useAiStore.getState()
  const patch: Partial<typeof store.gemini> = {}
  if (typeof payload.initialized === 'boolean') patch.webviewInitialized = payload.initialized
  if (typeof payload.loading === 'boolean') patch.webviewLoading = payload.loading
  if (typeof payload.canGoBack === 'boolean') patch.canGoBack = payload.canGoBack
  if (typeof payload.canGoForward === 'boolean') patch.canGoForward = payload.canGoForward

  const nextUrl = safeText(payload.url)
  if (nextUrl && isGeminiAllowedUrl(nextUrl)) patch.lastUrl = normalizeGeminiUrl(nextUrl)

  if (Object.keys(patch).length) store.patchGemini(patch)

  // 旧 rememberGeminiUrl: gemini-allowed url 变更写回 last_url。
  if (patch.lastUrl) persistLastUrl('gemini', patch.lastUrl)
}

// 旧 handleGptTrackerMessage: 解析注入脚本通过 console.log 发回的查询事件。
function handleGptTrackerMessage(message: unknown) {
  const raw = String(message || '')
  if (!raw.startsWith(GPT_QUERY_MARKER)) return
  try {
    const payload = JSON.parse(raw.slice(GPT_QUERY_MARKER.length)) as { text?: string }
    registerGptQuery(payload?.text || '')
  } catch {
    registerGptQuery('')
  }
}

// 旧 installGptQueryTracker: 在 GPT 页面注入监听 Enter / 发送按钮的脚本,
// 用户发问时通过 console.log(marker + json) 把提问文本回传, 用于统计上报。
function installGptQueryTracker(tabId: string) {
  const store = useAiStore.getState()
  const targetId = safeText(tabId) || store.gptActiveTabId
  const tab = store.gptTabs.find((item) => item.id === targetId)
  if (!api.executeAiJavaScript || !tab || !isGptAllowedUrl(tab.url)) return

  const marker = JSON.stringify(GPT_QUERY_MARKER)
  void api
    .executeAiJavaScript({
      kind: 'gpt',
      tabId: targetId,
      code: `
    (() => {
      if (window.__gptQueryTrackerInstalled) return;
      window.__gptQueryTrackerInstalled = true;

      const emit = () => {
        const textarea = document.querySelector("textarea");
        const editor = document.querySelector('[contenteditable="true"]');
        const text = String(textarea?.value || editor?.innerText || "").trim().slice(0, 160);
        console.log(${marker} + JSON.stringify({ text, stamp: Date.now() }));
      };

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        const target = event.target;
        const editable = Boolean(
          target?.closest?.("textarea")
          || target?.closest?.('[contenteditable="true"]')
          || target?.matches?.('[contenteditable="true"]'),
        );
        if (!editable) return;
        setTimeout(emit, 0);
      }, true);

      document.addEventListener("click", (event) => {
        const button = event.target?.closest?.(
          'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]',
        );
        if (!button) return;
        setTimeout(emit, 0);
      }, true);
    })();
  `,
    })
    .catch(() => undefined)
}

let bound = false

// 全局只绑定一次 onAiEvent (对齐旧 bindAiWorkspaceEvents 的 aiEventsBound 守卫)。
// 在面板挂载时调用; 多面板共用同一订阅, 通过 store 分发到 gpt/gemini。
export function useAiEvents() {
  useEffect(() => {
    if (bound || !api.onAiEvent) return
    bound = true

    // 反馈写入走 store getState (action 稳定), 不依赖闭包捕获。
    const setGptFeedback = useAiStore.getState().setGptFeedback
    const setGeminiFeedback = useAiStore.getState().setGeminiFeedback

    api.onAiEvent((raw) => {
      const payload = (raw || {}) as AiEventPayload
      const kind = safeText(payload?.kind)
      if (!kind) return

      if (kind === 'gpt' && payload?.type === 'tabs-changed') {
        applyGptTabsPayload(payload)
        return
      }

      if (kind === 'gpt') applyGptState(payload)
      else if (kind === 'gemini') applyGeminiState(payload)

      if (payload?.type === 'console-message' && kind === 'gpt') {
        handleGptTrackerMessage(payload.message)
      }

      if (payload?.type === 'did-fail-load') {
        const errorText = safeText(payload.errorDescription) || String(payload.errorCode || '未知错误')
        if (kind === 'gpt') setGptFeedback(`GPT 页面加载失败：${errorText}`, 'error')
        else if (kind === 'gemini') setGeminiFeedback(`Gemini 页面加载失败：${errorText}`, 'error')
      }

      if (payload?.type === 'raw-document-detected' && kind === 'gpt') {
        setGptFeedback(
          '检测到 GPT 登录页返回异常文本，程序已自动重试。若仍异常，请刷新一次页面。',
          'warning',
        )
      }

      if (payload?.type === 'external-open-failed') {
        const errorText = safeText(payload.message) || '未知错误'
        if (kind === 'gpt') setGptFeedback(`外部链接打开失败：${errorText}`, 'error')
        else if (kind === 'gemini') setGeminiFeedback(`外部链接打开失败：${errorText}`, 'error')
      }

      if (payload?.type === 'dom-ready' && kind === 'gpt') {
        installGptQueryTracker(safeText(payload.tabId))
      }
    })
  }, [])
}

export { applyGptTabsPayload }
