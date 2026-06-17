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
} from 'lucide-react'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store/useAppStore'
import { useAiStore } from '@/store/useAiStore'
import type { AiKind, GptTab } from '@/store/useAiStore'
import { isSenderRunning } from '@/components/panels/service/helpers'
import { api } from '@/lib/api'
import { useAiHostSync } from '@/hooks/useAiWorkspace'
import { useAiEvents, applyGptTabsPayload } from './useAiEvents'
import { GptTabBar } from './GptTabBar'
import {
  GPT_HOME_URL,
  GEMINI_HOME_URL,
  GPT_PROXY_HOST,
  GPT_PROXY_PORT,
  GPT_PARTITION,
  GEMINI_PARTITION,
  embeddedUserAgent,
  homeUrlFor,
  normalizeGptUrl,
  normalizeGeminiUrl,
} from './constants'
import type { AiEventPayload } from './types'

function safeText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// 旧 resolveGptProxyPort: 优先用发送服务的本地 socks 监听端口, 否则回落 1080。
function resolveProxyPort(socksPort: unknown): string {
  const value = safeText(socksPort) || GPT_PROXY_PORT
  return /^\d+$/.test(value) ? value : GPT_PROXY_PORT
}

interface AiMeta {
  title: string
  hint: string
  icon: typeof Bot
}

const META: Record<AiKind, AiMeta> = {
  gpt: { title: 'ChatGPT', hint: '内嵌 ChatGPT 网页 · 经发送服务代理访问', icon: Bot },
  gemini: { title: 'Gemini', hint: '内嵌 Gemini 网页 · 经发送服务代理访问', icon: Sparkles },
}

// 共享 AI 网页工作区。GPT / Gemini 同构: 控制条 + (GPT 多标签) + 原生 view 宿主 + 遮罩。
// 真正的 WebContentsView 在主进程, 这里只渲染宿主 div 并同步其矩形定位。
export function AiWorkspace({ kind }: { kind: AiKind }) {
  const meta = META[kind]
  const status = useAppStore((s) => s.status)
  const settings = useAppStore((s) => s.settings)
  const sidebarHidden = useAppStore((s) => s.sidebarHidden)
  const toggleSidebarHidden = useAppStore((s) => s.toggleSidebarHidden)
  const senderRunning = isSenderRunning(status)

  // 隐藏侧栏时: 按 Esc 快速恢复显示 (隐藏态本身持久化, 离开 GPT/Gemini 面板会自动恢复显示, 见 Shell)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useAppStore.getState().setSidebarHidden(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const gptTabs = useAiStore((s) => s.gptTabs)
  const gptActiveTabId = useAiStore((s) => s.gptActiveTabId)
  const gptFeedback = useAiStore((s) => s.gptFeedback)
  const gemini = useAiStore((s) => s.gemini)
  const geminiFeedback = useAiStore((s) => s.geminiFeedback)
  const setGptFeedback = useAiStore((s) => s.setGptFeedback)
  const setGeminiFeedback = useAiStore((s) => s.setGeminiFeedback)

  // 当前激活的 GPT 标签 (单视图运行态来源)。
  const activeGptTab: GptTab | null =
    kind === 'gpt' ? gptTabs.find((tab) => tab.id === gptActiveTabId) ?? null : null

  // 视图运行态 (统一抽象, 供遮罩/导航按钮判断)。
  const view =
    kind === 'gpt'
      ? {
          initialized: Boolean(activeGptTab?.webviewInitialized),
          loading: Boolean(activeGptTab?.webviewLoading),
          canGoBack: Boolean(activeGptTab?.canGoBack),
          canGoForward: Boolean(activeGptTab?.canGoForward),
          lastUrl: activeGptTab?.url ?? '',
        }
      : {
          initialized: gemini.webviewInitialized,
          loading: gemini.webviewLoading,
          canGoBack: gemini.canGoBack,
          canGoForward: gemini.canGoForward,
          lastUrl: gemini.lastUrl,
        }

  const proxyHost = GPT_PROXY_HOST
  const proxyPort = resolveProxyPort(settings?.sender?.socks_listen_port)

  // 宿主可见 = 发送服务运行中 (面板已激活由 Shell 的条件渲染保证)。
  const hostVisible = senderRunning
  const { hostRef, schedule } = useAiHostSync(kind, hostVisible)

  // 全局只绑定一次 onAiEvent。
  useAiEvents()

  // 旧 ensureGptWorkspace / ensureGeminiWorkspace。
  const ensureWorkspace = useCallback(
    async (forceReload = false) => {
      if (!senderRunning) return
      const userAgent = embeddedUserAgent()

      if (kind === 'gpt') {
        const tab = useAiStore.getState().gptTabs.find(
          (item) => item.id === useAiStore.getState().gptActiveTabId,
        )
        if (!tab) return
        const lastUrl = normalizeGptUrl(tab.url || GPT_HOME_URL)
        const payload = (await api.ensureAiWorkspace({
          kind: 'gpt',
          tabId: tab.id,
          partition: GPT_PARTITION,
          host: proxyHost,
          port: proxyPort,
          homeUrl: GPT_HOME_URL,
          lastUrl,
          userAgent,
          forceReload,
        })) as AiEventPayload | null
        if (payload && safeText(payload.tabId)) {
          useAiStore.getState().patchGptTab(safeText(payload.tabId), {
            webviewInitialized:
              typeof payload.initialized === 'boolean'
                ? payload.initialized
                : tab.webviewInitialized,
            webviewLoading:
              typeof payload.loading === 'boolean' ? payload.loading : tab.webviewLoading,
          })
        }
        return
      }

      // 读取最新运行态 (含初始化时由 settings.gemini.last_url 注入的 seed), 避免闭包旧值。
      const lastUrl = normalizeGeminiUrl(
        useAiStore.getState().gemini.lastUrl || GEMINI_HOME_URL,
      )
      const payload = (await api.ensureAiWorkspace({
        kind: 'gemini',
        partition: GEMINI_PARTITION,
        host: proxyHost,
        port: proxyPort,
        homeUrl: GEMINI_HOME_URL,
        lastUrl,
        userAgent,
        forceReload,
      })) as AiEventPayload | null
      if (payload) {
        const patch: Partial<typeof gemini> = {}
        if (typeof payload.initialized === 'boolean') patch.webviewInitialized = payload.initialized
        if (typeof payload.loading === 'boolean') patch.webviewLoading = payload.loading
        if (Object.keys(patch).length) useAiStore.getState().patchGemini(patch)
      }
    },
    // gemini.lastUrl 改为调用时从 store 读取, 不再作为依赖。
    [kind, senderRunning, proxyHost, proxyPort],
  )

  // 进入工作区时以持久化的 settings.gemini.last_url 作为初始导航地址 (旧 loadSettings)。
  // 仅在运行态 lastUrl 仍为空时生效, 避免覆盖已收到的实时 url。
  useEffect(() => {
    if (kind !== 'gemini') return
    const persisted = safeText((settings?.gemini as Record<string, unknown> | undefined)?.last_url)
    if (persisted) useAiStore.getState().seedGeminiLastUrl(normalizeGeminiUrl(persisted))
  }, [kind, settings?.gemini])

  // 面板激活 / 发送服务就绪时: 拉取 GPT 标签列表并 ensure 工作区。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (kind === 'gpt') {
        try {
          const payload = (await api.listGptViews()) as AiEventPayload
          if (!cancelled) applyGptTabsPayload(payload)
        } catch {
          /* ignore */
        }
      }
      if (!cancelled && senderRunning) await ensureWorkspace()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, senderRunning])

  // 激活标签变化时 (GPT) 重新 ensure, 让主进程切换/定位正确的 view。
  useEffect(() => {
    if (kind === 'gpt' && senderRunning && gptActiveTabId) void ensureWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gptActiveTabId])

  // ---- 控制条动作 (旧 navigateAiWorkspace / openExternal) ----
  const navigate = useCallback(
    async (action: 'back' | 'forward' | 'reload') => {
      try {
        if (kind === 'gpt') {
          await api.navigateAiWorkspace({ kind: 'gpt', tabId: gptActiveTabId, action })
        } else {
          await api.navigateAiWorkspace({ kind: 'gemini', action })
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        if (kind === 'gpt') setGptFeedback(text, 'error')
        else setGeminiFeedback(text, 'error')
      }
    },
    [kind, gptActiveTabId, setGptFeedback, setGeminiFeedback],
  )

  const goHome = useCallback(async () => {
    const url = homeUrlFor(kind)
    try {
      await api.navigateAiWorkspace(
        kind === 'gpt'
          ? { kind: 'gpt', tabId: gptActiveTabId, action: 'load', url }
          : { kind: 'gemini', action: 'load', url },
      )
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      if (kind === 'gpt') setGptFeedback(text, 'error')
      else setGeminiFeedback(text, 'error')
    }
  }, [kind, gptActiveTabId, setGptFeedback, setGeminiFeedback])

  // ---- GPT 多标签动作 ----
  const createTab = useCallback(async () => {
    try {
      const payload = (await api.createGptView({ lastUrl: GPT_HOME_URL })) as AiEventPayload
      applyGptTabsPayload(payload)
      if (senderRunning) await ensureWorkspace()
    } catch (err) {
      setGptFeedback(err instanceof Error ? err.message : String(err), 'error')
    }
  }, [senderRunning, ensureWorkspace, setGptFeedback])

  const switchTab = useCallback(
    async (tabId: string) => {
      if (!tabId || tabId === useAiStore.getState().gptActiveTabId) return
      try {
        const payload = (await api.switchGptView({ tabId })) as AiEventPayload
        applyGptTabsPayload(payload)
        if (senderRunning) await ensureWorkspace()
      } catch (err) {
        setGptFeedback(err instanceof Error ? err.message : String(err), 'error')
      }
    },
    [senderRunning, ensureWorkspace, setGptFeedback],
  )

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!tabId) return
      try {
        const payload = (await api.closeGptView({ tabId })) as AiEventPayload
        applyGptTabsPayload(payload)
        if (senderRunning) await ensureWorkspace()
      } catch (err) {
        setGptFeedback(err instanceof Error ? err.message : String(err), 'error')
      }
    },
    [senderRunning, ensureWorkspace, setGptFeedback],
  )

  // 运行态 / 遮罩内容变化时, 重新同步宿主定位 (旧逻辑在 updateRuntimeState 末尾 schedule)。
  const overlayKey = `${senderRunning}|${kind === 'gpt' ? gptActiveTabId : 'gemini'}|${view.initialized}`
  const overlayRef = useRef(overlayKey)
  useEffect(() => {
    if (overlayRef.current !== overlayKey) {
      overlayRef.current = overlayKey
      schedule()
    }
  }, [overlayKey, schedule])

  const Icon = meta.icon
  const feedback = kind === 'gpt' ? gptFeedback : geminiFeedback
  const runtimeLabel = !senderRunning
    ? '等待发送服务'
    : kind === 'gpt' && !gptActiveTabId
      ? '暂无会话'
      : view.loading
        ? '正在加载'
        : view.initialized
          ? '已打开'
          : '准备打开'

  const overlay = resolveOverlay(kind, { senderRunning, hasTab: Boolean(gptActiveTabId), initialized: view.initialized, proxyHost, proxyPort })

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

          {kind === 'gpt' && (
            <>
              <div className="h-5 w-px shrink-0 bg-border" />
              <GptTabBar
                tabs={gptTabs}
                activeTabId={gptActiveTabId}
                disabled={!senderRunning}
                onSwitch={(id) => void switchTab(id)}
                onClose={(id) => void closeTab(id)}
                onCreate={() => void createTab()}
              />
            </>
          )}

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
  const label = kind === 'gpt' ? 'ChatGPT' : 'Gemini'

  if (!senderRunning) {
    return {
      title: '请先开启发送服务',
      text: `内置 ${label} 网页会通过 ${proxyHost}:${proxyPort} 代理访问。请先在“代理转发”中开启发送服务。`,
    }
  }

  if (kind === 'gpt' && !hasTab) {
    return {
      title: '当前没有打开的网页标签',
      text: '请点击上方的 + 按钮，新建一个 ChatGPT 标签页。',
    }
  }

  if (!initialized) {
    return kind === 'gpt'
      ? { title: '准备打开 ChatGPT', text: '正在初始化内置页面并连接本地代理。第一次进入可能稍慢。' }
      : {
          title: '准备打开 Gemini',
          text: '正在初始化内置页面并连接本地代理。Google 登录可能会跳转到账号验证页面。',
        }
  }

  return null
}
