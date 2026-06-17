import { useCallback, useEffect, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  PanelLeftClose,
  PanelLeftOpen,
  Home,
  RotateCw,
  Bot,
  Sparkles,
  Asterisk,
} from 'lucide-react'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store/useAppStore'
import { useAiStore } from '@/store/useAiStore'
import type { AiKind } from '@/store/useAiStore'
import { isSenderRunning } from '@/components/panels/service/helpers'
import { api } from '@/lib/api'
import { useAiHostSync } from '@/hooks/useAiWorkspace'
import { useAiEvents, applyAiTabsPayload } from './useAiEvents'
import { GptTabBar } from './GptTabBar'
import {
  GPT_PROXY_HOST,
  GPT_PROXY_PORT,
  embeddedUserAgent,
  homeUrlFor,
  partitionFor,
  normalizeGptUrl,
  normalizeGeminiUrl,
  normalizeClaudeUrl,
} from './constants'
import type { AiEventPayload } from './types'

function safeText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// 旧 resolveGptProxyPort: 优先用发送服务的本地 socks 监听端口, 否则回落默认。
function resolveProxyPort(socksPort: unknown): string {
  const value = safeText(socksPort) || GPT_PROXY_PORT
  return /^\d+$/.test(value) ? value : GPT_PROXY_PORT
}

function normalizeUrlFor(kind: AiKind, url: string): string {
  if (kind === 'gpt') return normalizeGptUrl(url)
  if (kind === 'claude') return normalizeClaudeUrl(url)
  return normalizeGeminiUrl(url)
}

interface AiMeta {
  title: string
  hint: string
  icon: typeof Bot
}

const META: Record<AiKind, AiMeta> = {
  gpt: { title: 'ChatGPT', hint: '内嵌 ChatGPT 网页 · 经发送服务代理访问', icon: Bot },
  gemini: { title: 'Gemini', hint: '内嵌 Gemini 网页 · 经发送服务代理访问', icon: Sparkles },
  claude: { title: 'Claude', hint: '内嵌 Claude 网页 · 经发送服务代理访问', icon: Asterisk },
}

// 共享 AI 网页工作区。GPT / Gemini 完全同构: 控制条 + 多标签 + 原生 view 宿主 + 遮罩。
// 真正的 WebContentsView 在主进程, 这里只渲染宿主 div 并同步其矩形定位。
export function AiWorkspace({ kind }: { kind: AiKind }) {
  const meta = META[kind]
  const status = useAppStore((s) => s.status)
  const settings = useAppStore((s) => s.settings)
  const sidebarHidden = useAppStore((s) => s.sidebarHidden)
  const toggleSidebarHidden = useAppStore((s) => s.toggleSidebarHidden)
  const senderRunning = isSenderRunning(status)

  // 隐藏侧栏时按 Esc 快速恢复 (隐藏态持久化, 离开 GPT/Gemini 面板会自动恢复显示, 见 Shell)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useAppStore.getState().setSidebarHidden(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tabs = useAiStore((s) => s.tabsByKind[kind])
  const activeTabId = useAiStore((s) => s.activeTabIdByKind[kind])
  const feedback = useAiStore((s) => s.feedbackByKind[kind])
  const setFeedback = useAiStore((s) => s.setFeedback)

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  // 视图运行态 (供遮罩/导航按钮判断)。
  const view = {
    initialized: Boolean(activeTab?.webviewInitialized),
    loading: Boolean(activeTab?.webviewLoading),
    canGoBack: Boolean(activeTab?.canGoBack),
    canGoForward: Boolean(activeTab?.canGoForward),
    lastUrl: activeTab?.url ?? '',
  }

  const proxyHost = GPT_PROXY_HOST
  const proxyPort = resolveProxyPort(settings?.sender?.socks_listen_port)

  // 宿主可见 = 发送服务运行中 (面板已激活由 Shell 的条件渲染保证)。
  const hostVisible = senderRunning
  const { hostRef, schedule } = useAiHostSync(kind, hostVisible)

  // 全局只绑定一次 onAiEvent。
  useAiEvents()

  // 旧 ensureGptWorkspace / ensureGeminiWorkspace (现已同构)。
  const ensureWorkspace = useCallback(
    async (forceReload = false) => {
      if (!senderRunning) return
      const store = useAiStore.getState()
      const tab = store.tabsByKind[kind].find(
        (item) => item.id === store.activeTabIdByKind[kind],
      )
      if (!tab) return
      const userAgent = embeddedUserAgent()
      const lastUrl = normalizeUrlFor(kind, tab.url || homeUrlFor(kind))
      const payload = (await api.ensureAiWorkspace({
        kind,
        tabId: tab.id,
        partition: partitionFor(kind),
        host: proxyHost,
        port: proxyPort,
        homeUrl: homeUrlFor(kind),
        lastUrl,
        userAgent,
        forceReload,
      })) as AiEventPayload | null
      if (payload && safeText(payload.tabId)) {
        useAiStore.getState().patchTab(kind, safeText(payload.tabId), {
          webviewInitialized:
            typeof payload.initialized === 'boolean'
              ? payload.initialized
              : tab.webviewInitialized,
          webviewLoading:
            typeof payload.loading === 'boolean' ? payload.loading : tab.webviewLoading,
        })
      }
    },
    [kind, senderRunning, proxyHost, proxyPort],
  )

  // 面板激活 / 发送服务就绪时: 拉取标签列表并 ensure 工作区。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = (await api.listAiViews(kind)) as AiEventPayload
        if (!cancelled) applyAiTabsPayload(kind, payload)
      } catch {
        /* ignore */
      }
      if (!cancelled && senderRunning) await ensureWorkspace()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, senderRunning])

  // 激活标签变化时重新 ensure, 让主进程切换/定位正确的 view。
  useEffect(() => {
    if (senderRunning && activeTabId) void ensureWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  // ---- 控制条动作 (旧 navigateAiWorkspace) ----
  const navigate = useCallback(
    async (action: 'back' | 'forward' | 'reload') => {
      try {
        await api.navigateAiWorkspace({ kind, tabId: activeTabId, action })
      } catch (err) {
        setFeedback(kind, err instanceof Error ? err.message : String(err), 'error')
      }
    },
    [kind, activeTabId, setFeedback],
  )

  const goHome = useCallback(async () => {
    try {
      await api.navigateAiWorkspace({
        kind,
        tabId: activeTabId,
        action: 'load',
        url: homeUrlFor(kind),
      })
    } catch (err) {
      setFeedback(kind, err instanceof Error ? err.message : String(err), 'error')
    }
  }, [kind, activeTabId, setFeedback])

  // ---- 多标签动作 (GPT / Gemini 通用) ----
  const createTab = useCallback(async () => {
    try {
      const payload = (await api.createAiView(kind, {
        lastUrl: homeUrlFor(kind),
      })) as AiEventPayload
      applyAiTabsPayload(kind, payload)
      if (senderRunning) await ensureWorkspace()
    } catch (err) {
      setFeedback(kind, err instanceof Error ? err.message : String(err), 'error')
    }
  }, [kind, senderRunning, ensureWorkspace, setFeedback])

  const switchTab = useCallback(
    async (tabId: string) => {
      if (!tabId || tabId === useAiStore.getState().activeTabIdByKind[kind]) return
      try {
        const payload = (await api.switchAiView(kind, { tabId })) as AiEventPayload
        applyAiTabsPayload(kind, payload)
        if (senderRunning) await ensureWorkspace()
      } catch (err) {
        setFeedback(kind, err instanceof Error ? err.message : String(err), 'error')
      }
    },
    [kind, senderRunning, ensureWorkspace, setFeedback],
  )

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!tabId) return
      try {
        const payload = (await api.closeAiView(kind, { tabId })) as AiEventPayload
        applyAiTabsPayload(kind, payload)
        if (senderRunning) await ensureWorkspace()
      } catch (err) {
        setFeedback(kind, err instanceof Error ? err.message : String(err), 'error')
      }
    },
    [kind, senderRunning, ensureWorkspace, setFeedback],
  )

  // 运行态 / 遮罩内容变化时, 重新同步宿主定位。
  const overlayKey = `${senderRunning}|${activeTabId}|${view.initialized}`
  const overlayRef = useRef(overlayKey)
  useEffect(() => {
    if (overlayRef.current !== overlayKey) {
      overlayRef.current = overlayKey
      schedule()
    }
  }, [overlayKey, schedule])

  const Icon = meta.icon
  const runtimeLabel = !senderRunning
    ? '等待发送服务'
    : !activeTabId
      ? '暂无会话'
      : view.loading
        ? '正在加载'
        : view.initialized
          ? '已打开'
          : '准备打开'

  const overlay = resolveOverlay(kind, {
    senderRunning,
    hasTab: Boolean(activeTabId),
    initialized: view.initialized,
    proxyHost,
    proxyPort,
  })

  return (
    <PanelScaffold
      icon={Icon}
      title={meta.title}
      hint={meta.hint}
      scrollable={false}
      toolbar={
        <Badge variant="outline" className="gap-1.5">
          <span className={view.loading ? 'size-1.5 animate-pulse rounded-full bg-primary' : 'size-1.5 rounded-full bg-muted-foreground'} />
          {runtimeLabel}
        </Badge>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* 控制条 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-8" title="主页" disabled={!senderRunning} onClick={() => void goHome()}>
              <Home className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" title="后退" disabled={!view.canGoBack} onClick={() => void navigate('back')}>
              <ArrowLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" title="前进" disabled={!view.canGoForward} onClick={() => void navigate('forward')}>
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" title="刷新" disabled={!senderRunning} onClick={() => void navigate('reload')}>
              <RotateCw className="size-4" />
            </Button>
          </div>

          <div className="h-5 w-px shrink-0 bg-border" />
          <GptTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            disabled={!senderRunning}
            onSwitch={(id) => void switchTab(id)}
            onClose={(id) => void closeTab(id)}
            onCreate={() => void createTab()}
          />

          <div className="ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={sidebarHidden ? '显示侧栏' : '隐藏侧栏 (只看网页, 按 Esc 恢复)'}
              onClick={toggleSidebarHidden}
            >
              {sidebarHidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </div>
        </div>

        {feedback.text && (
          <div
            className={
              feedback.tone === 'error'
                ? 'shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive'
                : 'shrink-0 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground'
            }
          >
            {feedback.text}
          </div>
        )}

        {/* 原生 view 宿主 + 遮罩 */}
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="absolute inset-0" />
          {overlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6">
              <div className="max-w-md text-center">
                <Icon className="mx-auto mb-3 size-10 text-muted-foreground" />
                <h2 className="mb-1.5 text-base font-semibold">{overlay.title}</h2>
                <p className="text-sm text-muted-foreground">{overlay.text}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PanelScaffold>
  )
}

// 遮罩状态决策, 对齐旧 updateGptRuntimeState / updateGeminiRuntimeState 的 overlay 分支。
function resolveOverlay(
  kind: AiKind,
  args: { senderRunning: boolean; hasTab: boolean; initialized: boolean; proxyHost: string; proxyPort: string },
): { title: string; text: string } | null {
  const { senderRunning, hasTab, initialized, proxyHost, proxyPort } = args
  const label = kind === 'gpt' ? 'ChatGPT' : kind === 'claude' ? 'Claude' : 'Gemini'

  if (!senderRunning) {
    return {
      title: '请先开启发送服务',
      text: `内置 ${label} 网页会通过 ${proxyHost}:${proxyPort} 代理访问。请先在“代理转发”中开启发送服务。`,
    }
  }

  if (!hasTab) {
    return {
      title: '当前没有打开的网页标签',
      text: `请点击上方的 + 按钮，新建一个 ${label} 标签页。`,
    }
  }

  if (!initialized) {
    if (kind === 'gemini') {
      return {
        title: '准备打开 Gemini',
        text: '正在初始化内置页面并连接本地代理。Google 登录可能会跳转到账号验证页面。',
      }
    }
    return {
      title: `准备打开 ${label}`,
      text: '正在初始化内置页面并连接本地代理。第一次进入可能稍慢。',
    }
  }

  return null
}
