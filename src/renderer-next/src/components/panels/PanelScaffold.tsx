import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

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
      {!hideHeader && (
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
          <Icon className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
            {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
          </div>
          {toolbar}
        </div>
      )}
      <div className={scrollable ? 'min-h-0 flex-1 overflow-auto' : 'min-h-0 flex-1 overflow-hidden'}>
        {children}
      </div>
    </section>
  )
}
