import type { ReactNode } from 'react'
import { Cable, Moon, Sun, Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
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
      className={
        'grid size-8 place-items-center rounded-md text-muted-foreground transition hover:text-foreground ' +
        (danger ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-secondary')
      }
    >
      {children}
    </button>
  )
}

export function Titlebar() {
  const mode = useAppStore((s) => s.mode)
  const dark = useAppStore((s) => s.dark)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  return (
    <header className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
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
        <CtlButton onClick={() => api.minimizeWindow()} label="最小化">
          <Minus className="size-4" />
        </CtlButton>
        <CtlButton onClick={() => api.toggleMaximizeWindow()} label="最大化">
          <Square className="size-3.5" />
        </CtlButton>
        <CtlButton onClick={() => api.closeWindow()} label="关闭" danger>
          <X className="size-4" />
        </CtlButton>
      </div>
    </header>
  )
}
