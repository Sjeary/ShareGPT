import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// 面板通用骨架: 顶部标题条 + 内容区。聊天等特殊布局可不用它。
export function PanelScaffold({
  icon: Icon,
  title,
  hint,
  children,
  toolbar,
  hideHeader = false,
  scrollable = true,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  children: ReactNode
  toolbar?: ReactNode
  hideHeader?: boolean
  // 内容区是否可滚动。表单类面板 true; 原生 view 宿主(GPT/Gemini)用 false,
  // 避免宿主稍溢出就出现滚动条并挤窄 webview。
  scrollable?: boolean
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div
        aria-hidden={hideHeader}
        className={cn(
          'flex shrink-0 items-center gap-3 overflow-hidden bg-card/45 px-6',
          'transition-[height,opacity,border-color] duration-200 ease-out motion-reduce:transition-none',
          hideHeader
            ? 'pointer-events-none h-0 border-b border-transparent opacity-0'
            : 'h-14 border-b border-border/80 opacity-100',
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/15">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-tight tracking-tight">{title}</h1>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {toolbar}
      </div>
      <div
        className={scrollable ? 'min-h-0 flex-1 overflow-auto' : 'min-h-0 flex-1 overflow-hidden'}
      >
        {children}
      </div>
    </section>
  )
}
