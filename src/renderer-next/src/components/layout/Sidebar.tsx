import { useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { format } from 'date-fns'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { NAV, type NavKey } from '@/lib/nav'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useTasksStore } from '@/store/useTasksStore'

// 可收起侧栏 (对齐 shadcn Sidebar collapsible="icon" 成熟实践):
// 宽度用 CSS transition 平滑过渡(非两帧切换), 标签淡出, 收起态图标配 Tooltip, 尊重 reduced-motion。
export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  const active = useAppStore((s) => s.active)
  const setActive = useAppStore((s) => s.setActive)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarSide = useAppStore((s) => s.sidebarSide)
  const showGemini = useAppStore((s) => s.showGemini)
  const showClaude = useAppStore((s) => s.showClaude)
  const meta = useAppStore((s) => s.meta)
  // 管理员可禁止某人用协作聊天: 禁用则隐藏「协作聊天」入口 (服务端不投递消息, 这里只隐藏入口)。
  const chatDisabled = useAuthStore((s) => Boolean(s.profile?.chatDisabled))

  // 可按设置隐藏 Gemini / Claude 入口, 以及对被禁用户隐藏协作聊天入口。
  const navItems = NAV.filter(
    (item) =>
      (item.key !== 'gemini' || showGemini) &&
      (item.key !== 'claude' || showClaude) &&
      (item.key !== 'chat' || !chatDisabled),
  )

  // 侧栏在右时: 边框换到左侧, 收起态 Tooltip 弹向左侧 (避免被自身遮挡/出屏)。
  const onRight = sidebarSide === 'right'
  const tooltipSide = onRight ? 'left' : 'right'

  // 导航角标: 仅「备忘录/待办」显示今日(含逾期)未完成任务数 —— 它是可操作的待办,
  // 勾完成会自动减少/清零。个人日历不显示角标(日程数量不是待办, 易被误解为未读消息)。
  const tasks = useTasksStore((s) => s.tasks)
  const tasksInit = useTasksStore((s) => s.init)
  useEffect(() => {
    void tasksInit()
  }, [tasksInit])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todayTaskCount = tasks.filter(
    (t) => !t.completed && t.dueDate && t.dueDate <= todayStr,
  ).length
  const badgeFor = (key: NavKey): number => (key === 'todo' ? todayTaskCount : 0)

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        aria-hidden={hidden}
        className={cn(
          'flex shrink-0 flex-col gap-1 overflow-hidden bg-sidebar',
          // 宽度+内边距一起过渡, 实现"滑出/滑入"而非瞬间消失。
          'transition-[width,padding] duration-200 ease-out motion-reduce:transition-none',
          hidden
            ? 'w-0 border-0 p-0 pointer-events-none'
            : cn(
                'border-sidebar-border p-2',
                onRight ? 'border-l' : 'border-r',
                collapsed ? 'w-[68px]' : 'w-64',
              ),
        )}
      >
        {/* 导航项可滚动区: 入口较多/窗口较矮时仍能滚动访问全部; 底部「收起」与版本卡固定不滚动。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ key, label, icon: Icon, hint }) => {
            const on = key === active
            const badge = badgeFor(key)
            const btn = (
              <button
                data-tour={`nav-${key}`}
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
                    'relative grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                    on
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-sidebar-accent text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px]" />
                  {/* 收起态: 角标用图标右上角的小红点表示「有今日项」 */}
                  {collapsed && badge > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar" />
                  )}
                </span>
                <span
                  className={cn(
                    'overflow-hidden whitespace-nowrap transition-all duration-200',
                    collapsed
                      ? 'w-0 flex-none pointer-events-none opacity-0'
                      : 'min-w-0 flex-1 opacity-100',
                  )}
                >
                  <span className="block truncate text-[15px] font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                </span>
                {/* 展开态: 右侧显示今日数量胶囊 */}
                {!collapsed && badge > 0 && (
                  <span
                    className={cn(
                      'ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                      on ? 'bg-primary/20 text-primary' : 'bg-primary/15 text-primary',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
            return collapsed ? (
              <Tooltip key={key}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side={tooltipSide} className="font-medium">
                  {label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div key={key}>{btn}</div>
            )
          })}
        </div>

        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          className={cn(
            'mt-1 flex shrink-0 items-center rounded-lg py-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-2.5',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-muted-foreground">
            <ChevronLeft
              className={cn(
                'size-[18px] transition-transform duration-200',
                // 右侧侧栏时箭头方向镜像: 展开态指向右(收起方向), 收起态指向左(展开方向)。
                (onRight ? !collapsed : collapsed) && 'rotate-180',
              )}
            />
          </span>
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap text-left text-sm transition-all duration-200',
              collapsed ? 'w-0 flex-none pointer-events-none opacity-0' : 'flex-1 opacity-100',
            )}
          >
            收起侧栏
          </span>
        </button>

        <div
          className={cn(
            'shrink-0 overflow-hidden rounded-lg bg-sidebar-accent/50 text-xs text-muted-foreground transition-all duration-200',
            collapsed ? 'pointer-events-none h-0 p-0 opacity-0' : 'p-3 opacity-100',
          )}
        >
          <div className="whitespace-nowrap font-medium text-foreground">
            {((meta?.productName as string) || 'ShareGPT').replace(/\s+(Sender|Receiver)$/i, '')}
          </div>
          <div className="whitespace-nowrap">v{(meta?.version as string) || '1.0.1'}</div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
