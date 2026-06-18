import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Cable, Moon, Sun, Minus, Square, Copy, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

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
        // 紧凑标题栏: 用 ring-1 ring-inset 焦点环, 命中区 size-9 略加宽降误触。
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
  const mode = useAppStore((s) => s.mode)
  const dark = useAppStore((s) => s.dark)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  // [LOW] 最大化按钮态 (旧 syncWindowMaxButton ~2640): 监听窗口最大化变化,
  // 更新图标 (最大化->双层叠图标 / 还原->方框) 与无障碍标签/标题。
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let alive = true
    const sync = () => {
      void api
        .isWindowMaximized()
        .then((v) => {
          if (alive) setMaximized(Boolean(v))
        })
        .catch(() => {
          if (alive) setMaximized(false)
        })
    }
    sync()
    // 主进程窗口 resize/maximize/unmaximize 经 app 事件广播; 收到即重新查询。
    const unsubscribe = api.onAppEvent(() => sync())
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const handleToggleMax = () => {
    void Promise.resolve(api.toggleMaximizeWindow())
      .then(() => api.isWindowMaximized())
      .then((v) => setMaximized(Boolean(v)))
      .catch(() => undefined)
  }

  const maxLabel = maximized ? '还原窗口' : '最大化'

  // macOS 全屏时系统红绿灯会隐藏, 此时左侧不再为它留白(否则图标停在右侧、左边空一块)。
  // 进入/退出全屏窗口尺寸会变, 必触发 DOM resize, 据此重新查询全屏态, 无需主进程额外广播。
  const isMac = api.platform === 'darwin'
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => {
    if (!isMac) return
    let alive = true
    const sync = () => {
      void api
        .isWindowFullScreen()
        .then((v) => alive && setFullScreen(Boolean(v)))
        .catch(() => alive && setFullScreen(false))
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      alive = false
      window.removeEventListener('resize', sync)
    }
  }, [isMac])

  // 仅 macOS 非全屏时, 左侧为红绿灯留白。
  const padForTrafficLights = isMac && !fullScreen

  return (
    <header
      className={cn(
        'app-drag flex h-11 shrink-0 items-center justify-between border-b border-border',
        padForTrafficLights ? 'pl-20 pr-3' : 'px-3',
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
          <Cable className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">ShareGPT</span>
        {mode && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {mode}
          </span>
        )}
      </div>
      <div className="app-no-drag flex items-center gap-1">
        <CtlButton onClick={toggleTheme} label="切换主题">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </CtlButton>
        {/* 仅 Windows 自绘窗口控制; macOS 用系统红绿灯。 */}
        {!isMac && (
          <>
            {/* 主题切换与窗口控制间留分隔, 降低误触最小化/关闭。 */}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <CtlButton onClick={() => api.minimizeWindow()} label="最小化">
              <Minus className="size-4" />
            </CtlButton>
            <CtlButton onClick={handleToggleMax} label={maxLabel}>
              {maximized ? <Copy className="size-4" /> : <Square className="size-4" />}
            </CtlButton>
            <CtlButton onClick={() => api.closeWindow()} label="关闭" danger>
              <X className="size-4" />
            </CtlButton>
          </>
        )}
      </div>
    </header>
  )
}
