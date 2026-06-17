import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// 面板通用骨架: 顶部标题条 + 可滚动内容区 (对齐 sender PanelScaffold)。
export function PanelScaffold({
  icon: Icon,
  title,
  hint,
  children,
  toolbar,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  children: ReactNode
  toolbar?: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Icon className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
