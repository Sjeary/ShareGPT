import { useEffect } from 'react'
import { Cable, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/useAppStore'
import { DEFAULT_TARGET_DOMAINS } from '@/components/panels/service/helpers'
import { Titlebar } from '@/components/layout/Titlebar'
import { Shell } from '@/components/layout/Shell'
import { LoginScreen } from '@/components/LoginScreen'

// 应用级工作区门: 个人工作区无需登录；组织工作区只在服务器确认登录后进入。
export default function App() {
  const authed = useAppStore((s) => s.authed)
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const settings = useAppStore((s) => s.settings)
  const meta = useAppStore((s) => s.meta)
  const init = useAppStore((s) => s.init)
  const initializing = useAppStore((s) => s.initializing)
  const initializationError = useAppStore((s) => s.initializationError)

  useEffect(() => {
    void init()
  }, [init])

  // 版本更新后: 把已并入最新内置清单 DEFAULT_TARGET_DOMAINS 的"自动域名"剔除,
  // 保证代理域名以最新内置清单为准, 而非一直保留旧的自动累积项。(按版本只跑一次)
  useEffect(() => {
    if (!settings || !meta) return
    const version = String((meta as Record<string, unknown>).version ?? '')
    if (!version || settings.ui?.last_version === version) return
    const patch = useAppStore.getState().patchSection
    const auto = settings.sender?.auto_domains ?? []
    const defaults = DEFAULT_TARGET_DOMAINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const covered = (d: string) => defaults.some((s) => d === s || d.endsWith('.' + s))
    const pruned = auto.filter((d) => !covered(d))
    void patch('ui', { last_version: version })
    if (pruned.length !== auto.length) void patch('sender', { auto_domains: pruned })
  }, [settings, meta])

  if (!settings) {
    return (
      <div className="flex h-full flex-col bg-background text-foreground">
        <Titlebar />
        <div className="motion-ambient-stage grid min-h-0 flex-1 place-items-center p-6">
          {initializationError ? (
            <div className="workspace-entry-step flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/90 bg-card p-6 text-center shadow-md">
              <div className="grid size-12 place-items-center rounded-xl bg-destructive/12 text-destructive">
                <Cable className="size-6" />
              </div>
              <h1 className="text-lg font-semibold tracking-tight">暂时无法打开 ShareGPT</h1>
              <p role="alert" className="break-words text-sm text-destructive">
                {initializationError}
              </p>
              <p className="text-sm text-muted-foreground">
                本机资料已保留。请检查文件访问权限或恢复有效备份后，再重新尝试。
              </p>
              <Button onClick={() => void init()} disabled={initializing} className="mt-1">
                重新尝试
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3.5">
              <div className="motion-pulse-soft grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md ring-4 ring-primary/15">
                <Cable className="size-7" />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2
                  aria-label="正在加载 ShareGPT"
                  className="size-4 animate-spin text-primary"
                />
                <span>正在准备 ShareGPT 工作区…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (workspaceMode === 'organization' && authed) || workspaceMode === 'personal' ? (
    <Shell />
  ) : (
    <LoginScreen />
  )
}
