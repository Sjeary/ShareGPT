import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HelpCircle,
  Languages,
  Moon,
  PanelLeft,
  Play,
  Search,
  Square,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { NAV } from '@/lib/nav'
import { canUseAdvancedAi, canUseTranslation } from '@/lib/aiAccess'
import { workspaceNavAvailable } from '@/lib/workspaceCapabilities'
import { showErrorToast } from '@/lib/errorToast'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import { useAiStore } from '@/store/useAiStore'
import { useTranslationStore } from '@/store/useTranslationStore'
import { isSenderRunning } from '@/components/panels/service/helpers'
import { startWorkspaceSender } from '@/components/panels/service/startSenderAction'
import { normalizeAdvancedAiSettings } from '@/lib/aiEnvironments'

interface PaletteItem {
  id: string
  group: '导航跳转' | '快捷操作'
  label: string
  hint: string
  keywords: string
  icon: LucideIcon
  run: () => void | Promise<void>
}

export function GlobalCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!open) return null
  return <GlobalCommandPaletteInner open={open} onOpenChange={onOpenChange} />
}

function GlobalCommandPaletteInner({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = useAppStore((s) => s.active)
  const setActive = useAppStore((s) => s.setActive)
  const dark = useAppStore((s) => s.dark)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const setTourOpen = useAppStore((s) => s.setTourOpen)
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const showGemini = useAppStore((s) => s.showGemini)
  const showClaude = useAppStore((s) => s.showClaude)
  const hiddenNav = useAppStore((s) => s.hiddenNav)
  const status = useAppStore((s) => s.status)
  const advancedAiRaw = useAppStore((s) => s.settings?.advancedAi)
  const token = useAuthStore((s) => s.token)
  const profile = useAuthStore((s) => s.profile)
  const connection = useChatStore((s) => s.connection)

  const senderRunning = isSenderRunning(status)
  const isAdmin = workspaceMode === 'organization' && Boolean(token) && profile?.isAdmin === true
  const terminalAllowed = canUseAdvancedAi(workspaceMode, token, profile)
  const chatDisabled = Boolean(profile?.chatDisabled)
  const translationAllowed = canUseTranslation(workspaceMode, token, profile)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = NAV.filter(
      (item) =>
        (item.key !== 'terminal' || terminalAllowed) &&
        (item.key !== 'gemini' || showGemini) &&
        (item.key !== 'claude' || showClaude) &&
        workspaceNavAvailable(workspaceMode, item.key, { chatDisabled, isAdmin }) &&
        !hiddenNav.includes(item.key),
    ).map((item) => ({
      id: `nav:${item.key}`,
      group: '导航跳转',
      label: item.label,
      hint: item.hint,
      keywords: `${item.key} ${item.label} ${item.hint}`.toLowerCase(),
      icon: item.icon,
      run: () => setActive(item.key),
    }))

    const actions: PaletteItem[] = [
      senderRunning
        ? {
            id: 'action:stop-proxy',
            group: '快捷操作',
            label: '停止代理',
            hint: '停止内置 sing-box 代理服务',
            keywords: 'stop proxy 停止 代理 网络 sing-box',
            icon: Square,
            run: async () => {
              try {
                await api.stopSender()
                toast.success('已发送停止指令')
              } catch (err) {
                showErrorToast(err, '停止代理')
              }
            },
          }
        : {
            id: 'action:start-proxy',
            group: '快捷操作',
            label: '一键开启代理',
            hint: '立即启动当前工作区的代理出口',
            keywords: 'start proxy 开启 代理 网络 sing-box',
            icon: Play,
            run: async () => {
              try {
                await startWorkspaceSender({
                  workspaceMode,
                  online: connection === 'online',
                })
                toast.success('代理已开启')
              } catch (err) {
                showErrorToast(err, '开启代理')
                setActive('service')
              }
            },
          },
      {
        id: 'action:toggle-theme',
        group: '快捷操作',
        label: dark ? '切换为浅色主题' : '切换为深色主题',
        hint: '同步切换界面与内嵌 AI 网页明暗模式',
        keywords: 'theme dark light 主题 深色 浅色 夜间 白天',
        icon: dark ? Sun : Moon,
        run: () => toggleTheme(),
      },
      {
        id: 'action:toggle-sidebar',
        group: '快捷操作',
        label: sidebarCollapsed ? '展开左侧导航栏' : '收起左侧导航栏',
        hint: '在图标轨与完整导航栏之间切换',
        keywords: 'sidebar 侧栏 导航 收起 展开',
        icon: PanelLeft,
        run: () => toggleSidebar(),
      },
      {
        id: 'action:tour',
        group: '快捷操作',
        label: '重新查看新手引导',
        hint: '分步高亮介绍当前工作区功能',
        keywords: 'tour onboarding guide 新手 引导 帮助',
        icon: HelpCircle,
        run: () => setTourOpen(true),
      },
    ]

    if (translationAllowed && (active === 'gpt' || active === 'claude' || active === 'gemini')) {
      const activeTabId = useAiStore.getState().activeTabIdByKind[active]
      const advancedAi = normalizeAdvancedAiSettings(advancedAiRaw)
      const environmentId =
        terminalAllowed && advancedAi.enabled ? String(advancedAi.activeByKind[active] || '') : ''
      actions.unshift({
        id: 'action:toggle-translation',
        group: '快捷操作',
        label: '打开 / 关闭翻译侧栏',
        hint: '阅读翻译与写给 AI 译文预览',
        keywords: 'translate 翻译 侧栏',
        icon: Languages,
        run: () => useTranslationStore.getState().toggle(active, activeTabId, environmentId),
      })
    }

    return [...navItems, ...actions]
  }, [
    active,
    advancedAiRaw,
    chatDisabled,
    connection,
    dark,
    hiddenNav,
    senderRunning,
    setActive,
    setTourOpen,
    showClaude,
    showGemini,
    sidebarCollapsed,
    terminalAllowed,
    isAdmin,
    toggleSidebar,
    toggleTheme,
    translationAllowed,
    workspaceMode,
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.keywords.includes(q))
  }, [items, query])

  const safeSelectedIndex = filtered.length ? Math.min(selectedIndex, filtered.length - 1) : 0

  function execute(item: PaletteItem | undefined) {
    if (!item) return
    onOpenChange(false)
    void item.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">快速跳转与命令</DialogTitle>
        <DialogDescription className="sr-only">
          输入功能名称或命令，按回车执行跳转或快捷操作
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex((i) =>
                  filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
                )
              } else if (e.key === 'Enter') {
                e.preventDefault()
                execute(filtered[safeSelectedIndex])
              }
            }}
            placeholder="搜索页面或命令（如 ChatGPT、代理、翻译、主题…）"
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的页面或命令</p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon
              const prevGroup = index > 0 ? filtered[index - 1]?.group : null
              const selected = index === safeSelectedIndex
              return (
                <div key={item.id}>
                  {item.group !== prevGroup && (
                    <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground first:pt-1">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => execute(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                      selected
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent/60',
                    )}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
