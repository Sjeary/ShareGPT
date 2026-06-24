import { useEffect, useMemo } from 'react'
import { ChevronLeft } from 'lucide-react'
import { format } from 'date-fns'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { NAV, type NavKey } from '@/lib/nav'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useTasksStore } from '@/store/useTasksStore'
import { NavList } from './NavList'

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
  const hiddenNav = useAppStore((s) => s.hiddenNav)
  const navOrder = useAppStore((s) => s.navOrder)
  const setNavOrder = useAppStore((s) => s.setNavOrder)
  const meta = useAppStore((s) => s.meta)
  // 管理员可禁止某人用协作聊天: 禁用则隐藏「协作聊天」入口 (服务端不投递消息, 这里只隐藏入口)。
  const chatDisabled = useAuthStore((s) => Boolean(s.profile?.chatDisabled))

  // 可按设置隐藏 Gemini / Claude 入口, 以及对被禁用户隐藏协作聊天入口;
  // 再按用户自定义顺序 (navOrder) 排序 —— 未列入的 key 退回 NAV 默认顺序、排在末尾。
  const navItems = useMemo(() => {
    const filtered = NAV.filter(
      (item) =>
        (item.key !== 'gemini' || showGemini) &&
        (item.key !== 'claude' || showClaude) &&
        (item.key !== 'chat' || !chatDisabled) &&
        !hiddenNav.includes(item.key),
    )
    if (!navOrder.length) return filtered
    const rank = (k: NavKey) => {
      const i = navOrder.indexOf(k)
      return i >= 0 ? i : navOrder.length + NAV.findIndex((n) => n.key === k)
    }
    return [...filtered].sort((a, b) => rank(a.key) - rank(b.key))
  }, [showGemini, showClaude, chatDisabled, hiddenNav, navOrder])

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
        {/* 导航项可滚动区: 入口较多/窗口较矮时仍能滚动访问全部; 底部「收起」与版本卡固定不滚动。
            列表支持长按拖动重排 (见 NavList)。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavList
            items={navItems}
            collapsed={collapsed}
            activeKey={active}
            tooltipSide={tooltipSide}
            badgeFor={badgeFor}
            onActivate={setActive}
            onReorder={setNavOrder}
          />
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
          <div className="whitespace-nowrap">v{(meta?.version as string) || '1.0.2'}</div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
