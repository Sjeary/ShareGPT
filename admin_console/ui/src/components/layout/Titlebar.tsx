import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ShieldCheck, Moon, Sun, Minus, Square, Copy, X } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'

function CtlButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-9 place-items-center rounded-md text-muted-foreground transition hover:text-foreground',
        'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        danger
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

export function Titlebar() {
  const dark = useAdminStore((s) => s.dark)
  const toggleTheme = useAdminStore((s) => s.toggleTheme)
  const role = useAdminStore((s) => s.role)
  const serverUrl = useAdminStore((s) => s.serverUrl)
  const profile = useAdminStore((s) => s.profile)

  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let alive = true
    void adminApi
      .isWindowMaximized()
      .then((v) => alive && setMaximized(Boolean(v)))
      .catch(() => alive && setMaximized(false))
    return () => {
      alive = false
    }
  }, [])

  const handleToggleMax = () => {
    void Promise.resolve(adminApi.toggleMaximizeWindow())
      .then(() => adminApi.isWindowMaximized())
      .then((v) => setMaximized(Boolean(v)))
      .catch(() => undefined)
  }

  const roleLabel =
    role === 'dev' ? '开发者' : profile?.displayName || profile?.username || '管理员'

  // macOS 用系统红绿灯(左上角); 不自绘窗口控制, 左侧留出红绿灯宽度。Windows 走自绘控制。
  const isMac = adminApi.platform === 'darwin'

  return (
    <header
      className={cn(
        'app-drag flex h-11 shrink-0 items-center justify-between border-b border-border',
        isMac ? 'pl-20 pr-3' : 'px-3',
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">ShareGPT Admin</span>
        {role !== 'none' && (
          <>
            <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              {serverUrl || '未连接'}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                role === 'dev'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              {roleLabel}
            </span>
          </>
        )}
      </div>
      <div className="app-no-drag flex items-center gap-1">
        <CtlButton onClick={toggleTheme} label="切换主题">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </CtlButton>
        {!isMac && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <CtlButton onClick={() => adminApi.minimizeWindow()} label="最小化">
              <Minus className="size-4" />
            </CtlButton>
            <CtlButton onClick={handleToggleMax} label={maximized ? '还原窗口' : '最大化'}>
              {maximized ? <Copy className="size-4" /> : <Square className="size-4" />}
            </CtlButton>
            <CtlButton onClick={() => adminApi.closeWindow()} label="关闭" danger>
              <X className="size-4" />
            </CtlButton>
          </>
        )}
      </div>
    </header>
  )
}
