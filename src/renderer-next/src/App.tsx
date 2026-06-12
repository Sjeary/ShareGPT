import { useEffect, useState } from 'react'
import {
  Cable,
  MessageCircle,
  Bot,
  Sparkles,
  BarChart3,
  UserRound,
  ScrollText,
  Moon,
  Sun,
  Minus,
  Square,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavKey =
  | 'service'
  | 'chat'
  | 'gpt'
  | 'gemini'
  | 'stats'
  | 'account'
  | 'logs'

const NAV: { key: NavKey; label: string; icon: typeof Cable; hint: string }[] = [
  { key: 'service', label: '连接服务', icon: Cable, hint: '发送 / 接收 代理服务' },
  { key: 'chat', label: '协作聊天', icon: MessageCircle, hint: '团队消息与文件' },
  { key: 'gpt', label: 'ChatGPT', icon: Bot, hint: '内嵌 ChatGPT 网页' },
  { key: 'gemini', label: 'Gemini', icon: Sparkles, hint: '内嵌 Gemini 网页' },
  { key: 'stats', label: '使用统计', icon: BarChart3, hint: '查询量与排行' },
  { key: 'account', label: '账户', icon: UserRound, hint: '登录与协作服务' },
  { key: 'logs', label: '运行日志', icon: ScrollText, hint: '服务输出日志' },
]

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('sharegpt-theme', dark ? 'dark' : 'light')
  } catch {
    /* ignore */
  }
}

function useTheme() {
  // 初值读自 <html> 当前 class（main.tsx 在渲染前已据 localStorage/默认深色设好），
  // 切换走命令式 applyTheme，不放进 effect，避免 StrictMode 双调用把 class 抹掉。
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  return {
    dark,
    toggle: () =>
      setDark((v) => {
        applyTheme(!v)
        return !v
      }),
  }
}

function WindowControls() {
  const api = window.api
  return (
    <div className="app-no-drag flex items-center gap-1">
      <button
        onClick={() => api?.minimizeWindow?.()}
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        aria-label="最小化"
      >
        <Minus className="size-4" />
      </button>
      <button
        onClick={() => api?.toggleMaximizeWindow?.()}
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        aria-label="最大化"
      >
        <Square className="size-3.5" />
      </button>
      <button
        onClick={() => api?.closeWindow?.()}
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive hover:text-destructive-foreground"
        aria-label="关闭"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export default function App() {
  const { dark, toggle } = useTheme()
  const [active, setActive] = useState<NavKey>('service')
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)
  const [mode, setMode] = useState<string>('')

  useEffect(() => {
    window.api?.getAppMeta?.().then(setMeta).catch(() => {})
    window.api?.getMode?.().then(setMode).catch(() => {})
  }, [])

  const activeNav = NAV.find((n) => n.key === active)!

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 自定义标题栏 (可拖拽) */}
      <header className="app-drag flex h-11 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <Cable className="size-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">ShareGPT</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {mode || '…'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="app-no-drag grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="切换主题"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <WindowControls />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Telegram 式左侧导航栏 */}
        <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2">
          {NAV.map(({ key, label, icon: Icon, hint }) => {
            const on = key === active
            return (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                  on
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                )}
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full transition',
                    on
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-sidebar-accent text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                </span>
              </button>
            )
          })}
          <div className="mt-auto rounded-lg bg-sidebar-accent/50 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">
              {(meta?.productName as string) || 'ShareGPT'}
            </div>
            <div>v{(meta?.version as string) || '4.2.x'} · 新界面预览</div>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center gap-3 border-b border-border px-6">
            <activeNav.icon className="size-5 text-primary" />
            <div>
              <h1 className="text-base font-semibold leading-tight">{activeNav.label}</h1>
              <p className="text-xs text-muted-foreground">{activeNav.hint}</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8 text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
                <activeNav.icon className="size-6" />
              </div>
              <h2 className="text-lg font-semibold">{activeNav.label}面板</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                新 UI 骨架已就绪（React + TypeScript + Tailwind v4 + shadcn 主题）。
                此面板将由团队按 Telegram 式布局逐个重建。
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-success" />
                IPC 已连通 · 平台 {window.api?.platform || '—'} · 模式 {mode || '—'}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
