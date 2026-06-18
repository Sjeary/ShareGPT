import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  Home,
  RotateCw,
  Bot,
  Sparkles,
  Asterisk,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  X,
} from 'lucide-react'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AiProxyReport } from '@/types/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useAiStore } from '@/store/useAiStore'
import type { AiKind } from '@/store/useAiStore'
import { isSenderRunning } from '@/components/panels/service/helpers'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAiHostSync } from '@/hooks/useAiWorkspace'
import { useAiEvents, applyAiTabsPayload } from './useAiEvents'
import { reportMissingDomains } from './reportGptUsage'
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

  // 代理检测面板 (展示该页面流量是否全部经发送代理)。作为宿主上方的可折叠块渲染,
  // 这样不会被原生 webview 盖住 (centered Dialog 会被原生 view 覆盖)。
  const [proxyOpen, setProxyOpen] = useState(false)
  const [proxyChecking, setProxyChecking] = useState(false)
  const [proxyReport, setProxyReport] = useState<AiProxyReport | null>(null)

  // 窗口全屏 (类似 F11): 工具栏按钮切换; 用 resize 事件同步图标状态。
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    let alive = true
    const sync = () => {
      void api.isWindowFullScreen?.().then((v) => {
        if (alive) setIsFullscreen(Boolean(v))
      })
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      alive = false
      window.removeEventListener('resize', sync)
    }
  }, [])
  const toggleFullscreen = useCallback(() => {
    void api.toggleWindowFullScreen?.().then((v) => setIsFullscreen(Boolean(v)))
  }, [])

  const runProxyCheck = useCallback(async () => {
    setProxyChecking(true)
    try {
      const report = await api.checkAiProxy(kind, activeTabId)
      setProxyReport(report)
    } catch (err) {
      setProxyReport({ ok: false, reason: err instanceof Error ? err.message : String(err) })
    } finally {
      setProxyChecking(false)
    }
  }, [kind, activeTabId])

  const toggleProxyPanel = useCallback(() => {
    setProxyOpen((open) => {
      const next = !open
      if (next) void runProxyCheck()
      return next
    })
  }, [runProxyCheck])

  // 自动巡检: 发送服务运行 + 页面已初始化时, 周期性跑代理检测, 让"有域名没走代理"能自动爆红,
  // 不必每次手点。(检测只是被动读取已记录的主机, 开销很小。)
  // 注意: 不立即检测 —— 页面刚加载时流量尚未稳定, 马上检测容易误报爆红。前 20s 保持中性默认色,
  // 首次自动检测延后到 interval 第一次触发(约 20s)后, 之后每 20s 一次; 用户手点仍即时检测。
  useEffect(() => {
    if (!senderRunning || !activeTab?.webviewInitialized || !activeTabId) return
    const id = window.setInterval(() => void runProxyCheck(), 20000)
    return () => window.clearInterval(id)
  }, [senderRunning, activeTab?.webviewInitialized, activeTabId, runProxyCheck])

  // 代理检测发现"会用到但没走代理"的域名: 自动累积到本机额外清单(持久化) + 上报管理员。
  // 实际生效需重启 singbox —— 由代理面板的"一键加入并重启"按钮触发, 避免静默打断当前会话。
  const reportedDomainsRef = useRef<Set<string>>(new Set())
  const [restartingProxy, setRestartingProxy] = useState(false)
  const fallbackDomains = useMemo(
    () =>
      Array.from(
        new Set(
          (proxyReport?.hosts ?? [])
            .filter((h) => h.via === 'fallback')
            .map((h) => String(h.host || '').trim())
            .filter(Boolean),
        ),
      ),
    [proxyReport],
  )
  useEffect(() => {
    if (!fallbackDomains.length) return
    const sender = useAppStore.getState().settings?.sender
    const existing = new Set(sender?.auto_domains ?? [])
    const fresh = fallbackDomains.filter((d) => !existing.has(d))
    if (fresh.length) {
      void useAppStore
        .getState()
        .patchSection('sender', { auto_domains: [...existing, ...fresh] })
        .catch(() => undefined)
    }
    const toReport = fallbackDomains.filter((d) => !reportedDomainsRef.current.has(d))
    if (toReport.length) {
      toReport.forEach((d) => reportedDomainsRef.current.add(d))
      void reportMissingDomains(toReport)
    }
  }, [fallbackDomains])

  // 一键加入并重启 singbox: 用已持久化(含 auto_domains)的发送端配置重启, 使新域名即时走代理。
  const applyMissingDomains = useCallback(async () => {
    const sender = useAppStore.getState().settings?.sender
    if (!sender) return
    setRestartingProxy(true)
    try {
      await api.startSender(sender)
      toast.success('已加入并重启发送代理，正在重新检测…')
      window.setTimeout(() => void runProxyCheck(), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重启发送代理失败')
    } finally {
      setRestartingProxy(false)
    }
  }, [runProxyCheck])

  // 代理检测状态色: 只要有任何域名没走代理(回落) 或会话未走代理/检测失败 -> 直接爆红;
  // 全部走代理才是绿。(按需求: 一旦发现有域名没走代理就红色告警, 提醒补进清单。)
  const fallbackCount = proxyReport?.fallbackCount ?? 0
  const proxyTone: 'ok' | 'bad' | 'idle' = !proxyReport
    ? 'idle'
    : !proxyReport.ok || !proxyReport.sessionProxied || fallbackCount > 0
      ? 'bad'
      : 'ok'

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
  const overlayKey = `${senderRunning}|${activeTabId}|${view.initialized}|${proxyOpen}|${proxyReport?.hosts?.length ?? 0}|${feedback.text ? 1 : 0}`
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

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 gap-1.5 px-2',
                // 有域名没走代理 -> 爆红: 红底红字, 醒目提示去看/补清单。
                proxyTone === 'bad' &&
                  'bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive',
              )}
              title={
                proxyTone === 'bad'
                  ? `警告: 有 ${fallbackCount} 个域名没走代理！点击查看`
                  : '检测此页面流量是否全部经发送代理'
              }
              disabled={!senderRunning}
              onClick={toggleProxyPanel}
            >
              {proxyTone === 'ok' ? (
                <ShieldCheck className="size-4 text-emerald-500" />
              ) : proxyTone === 'bad' ? (
                <ShieldX className="size-4 text-destructive" />
              ) : (
                // 未检测(前 20s / 未点击): 中性默认色 (夜间白 / 白天黑)。
                <ShieldCheck className="size-4 text-foreground" />
              )}
              <span className="text-xs font-medium">代理检测</span>
              {proxyTone === 'bad' && fallbackCount > 0 && (
                <span className="ml-0.5 grid min-w-4 animate-pulse place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {fallbackCount}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={sidebarHidden ? '显示侧栏' : '隐藏侧栏 (只看网页, 按 Esc 恢复)'}
              onClick={toggleSidebarHidden}
            >
              {sidebarHidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={isFullscreen ? '退出全屏 (F11)' : '全屏 (F11)'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
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

        {proxyOpen && (
          <div className="shrink-0 border-b border-border bg-muted/30">
            <ProxyReportPanel
              report={proxyReport}
              checking={proxyChecking}
              tone={proxyTone}
              applying={restartingProxy}
              onApply={applyMissingDomains}
              onRefresh={() => void runProxyCheck()}
              onClose={() => setProxyOpen(false)}
            />
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

// 代理检测结果面板 (宿主上方的可折叠块)。逐域展示页面流量去向:
// 走发送代理(梯子) vs 回落(本机代理/直连)。回落域名即未走发送代理, 可补进路由清单。
function ProxyReportPanel({
  report,
  checking,
  tone,
  applying,
  onApply,
  onRefresh,
  onClose,
}: {
  report: AiProxyReport | null
  checking: boolean
  tone: 'ok' | 'warn' | 'bad' | 'idle'
  applying: boolean
  onApply: () => void
  onRefresh: () => void
  onClose: () => void
}) {
  const hosts = report?.hosts ?? []
  const proxyHosts = hosts.filter((h) => h.via === 'proxy')
  const fallbackHosts = hosts.filter((h) => h.via === 'fallback')

  const summary =
    !report || !report.ok
      ? checking
        ? '正在检测页面流量去向…'
        : report?.reason === 'no-workspace'
          ? '请先打开一个网页标签，再进行检测。'
          : '暂时无法检测，请刷新页面后重试。'
      : !report.sessionProxied
        ? '此页面未走代理（发送服务可能未开启，或代理未生效）。'
        : fallbackHosts.length > 0
          ? `共 ${hosts.length} 个域名：${proxyHosts.length} 个经发送代理（梯子），${fallbackHosts.length} 个回落（本机代理/直连，未走发送代理）。`
          : `此页面流量已全部经发送代理（梯子）访问，共 ${hosts.length} 个域名。`

  const SummaryIcon =
    tone === 'ok' ? ShieldCheck : tone === 'warn' ? ShieldAlert : tone === 'bad' ? ShieldX : ShieldCheck
  const summaryColor =
    tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-destructive'
          : 'text-muted-foreground'

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <SummaryIcon className={`size-4 shrink-0 ${summaryColor}`} />
        <span className="text-sm font-medium">代理检测</span>
        {report?.socksEndpoint && (
          <Badge variant="outline" className="font-mono text-[11px]">
            出口 socks5://{report.socksEndpoint}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" title="重新检测" disabled={checking} onClick={onRefresh}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title="收起" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <p className={`mb-2 text-xs ${summaryColor}`}>{summary}</p>

      {report?.ok && fallbackHosts.length > 0 && (
        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="flex items-start gap-2">
            <ShieldX className="mt-0.5 size-4 shrink-0" />
            <span>
              <b>有 {fallbackHosts.length} 个域名没走代理！</b>
              这些流量从你的真实 IP 出网（未经梯子）。已自动加入本机代理清单并上报管理员，
              点下方按钮重启发送代理即可生效。
            </span>
          </div>
          <Button
            size="sm"
            className="mt-2 h-7 gap-1.5"
            disabled={applying}
            onClick={onApply}
          >
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {applying ? '重启中…' : `一键加入并重启 singbox（${fallbackHosts.length}）`}
          </Button>
        </div>
      )}

      {hosts.length > 0 && (
        <ScrollArea className="max-h-44 rounded-md border border-border bg-background/60">
          <div className="selectable space-y-2 p-2">
            {fallbackHosts.length > 0 && (
              <div>
                <div className="mb-1 px-1 text-[11px] font-bold text-destructive">
                  未走发送代理 · 回落本机代理/直连（{fallbackHosts.length}）
                </div>
                <div className="flex flex-wrap gap-1">
                  {fallbackHosts.map((h) => (
                    <span
                      key={h.host}
                      className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-destructive"
                    >
                      {h.host}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 px-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                走发送代理 · 梯子（{proxyHosts.length}）
              </div>
              <div className="flex flex-wrap gap-1">
                {proxyHosts.map((h) => (
                  <span
                    key={h.host}
                    className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300"
                  >
                    {h.host}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      )}

      {report?.ok && fallbackHosts.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          提示：回落域名未经发送代理（梯子）出网。若希望它们也走梯子，需要把对应域名加入发送路由清单。
        </p>
      )}
    </div>
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
