import { ChevronLeft } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { NAV } from '@/lib/nav'
import { useAppStore } from '@/store/useAppStore'

// 可收起侧栏 (对齐 shadcn Sidebar collapsible="icon" 成熟实践):
// 宽度用 CSS transition 平滑过渡(非两帧切换), 标签淡出, 收起态图标配 Tooltip, 尊重 reduced-motion。
export function Sidebar() {
  const active = useAppStore((s) => s.active)
  const setActive = useAppStore((s) => s.setActive)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const meta = useAppStore((s) => s.meta)

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex shrink-0 flex-col gap-1 overflow-hidden border-r border-sidebar-border bg-sidebar p-2',
          'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {NAV.map(({ key, label, icon: Icon, hint }) => {
          const on = key === active
          const btn = (
            <button
              onClick={() => setActive(key)}
              className={cn(
                'group flex w-full items-center rounded-lg py-2.5 text-left transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-2.5',
                on
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                  on
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-sidebar-accent text-muted-foreground group-hover:text-foreground',
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span
                className={cn(
                  'overflow-hidden whitespace-nowrap transition-all duration-200',
                  collapsed
                    ? 'w-0 flex-none pointer-events-none opacity-0'
                    : 'min-w-0 flex-1 opacity-100',
                )}
              >
                <span className="block truncate text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          )
          return collapsed ? (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {label}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div key={key}>{btn}</div>
          )
        })}

        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          className={cn(
            'mt-auto flex items-center rounded-lg py-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-2.5',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-muted-foreground">
            <ChevronLeft
              className={cn(
                'size-[18px] transition-transform duration-200',
                collapsed && 'rotate-180',
              )}
            />
          </span>
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap text-left text-sm transition-all duration-200',
              collapsed
                ? 'w-0 flex-none pointer-events-none opacity-0'
                : 'flex-1 opacity-100',
            )}
          >
            收起侧栏
          </span>
        </button>

        <div
          className={cn(
            'overflow-hidden rounded-lg bg-sidebar-accent/50 text-xs text-muted-foreground transition-all duration-200',
            collapsed ? 'pointer-events-none h-0 p-0 opacity-0' : 'p-3 opacity-100',
          )}
        >
          <div className="whitespace-nowrap font-medium text-foreground">
            {(meta?.productName as string) || 'ShareGPT'}
          </div>
          <div className="whitespace-nowrap">
            v{(meta?.version as string) || '4.2.x'} · 新界面
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
