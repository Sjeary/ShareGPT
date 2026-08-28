import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { NavItem, NavKey } from '@/lib/nav'

// 行间距 = 外层 gap-1 (0.25rem = 4px); 用于把"为拖动让位"的位移量算成整行高度。
const ROW_GAP = 4
// 长按多久进入拖动态 (对齐 iOS/Android 长按拾起的手感)。
const HOLD_MS = 240
// 进入拖动前的位移容差: 超过则判定为"滚动/误触", 取消长按。
const MOVE_TOLERANCE = 8

interface DragState {
  key: NavKey
  from: number
  startY: number
  dy: number
  to: number
  h: number // 单行高度 (含行距), 拖动开始时测得
}

interface Props {
  items: NavItem[]
  collapsed: boolean
  activeKey: NavKey
  tooltipSide: 'left' | 'right'
  badgeFor: (key: NavKey) => number
  onActivate: (key: NavKey) => void
  onReorder: (keys: NavKey[]) => void
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [m] = next.splice(from, 1)
  next.splice(to, 0, m)
  return next
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// 长按拖动重排的导航列表 (类 iOS/macOS/Android): 长按 ~240ms 拾起, 跟手移动,
// 其余行用 transform 平滑让位; 松手提交新顺序。轻点仍是切换面板。
export function NavList({
  items,
  collapsed,
  activeKey,
  tooltipSide,
  badgeFor,
  onActivate,
  onReorder,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const rowEls = useRef<(HTMLDivElement | null)[]>([])
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerId = useRef<number | null>(null)
  // 一次拖动结束后, 仅抑制"被拖那一行"紧随其后的 click (否则会误触发面板切换);
  // 记录 key 而非布尔, 避免误吞下一次点别的入口。
  const suppressClick = useRef<NavKey | null>(null)
  // 长按未触发(还在容差内)时记录起点, 用于判断是滚动还是点击。
  const pending = useRef<{ index: number; startY: number; startX: number } | null>(null)

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, index: number, key: NavKey) => {
    if (e.button !== 0) return // 仅主键/触摸
    pending.current = { index, startY: e.clientY, startX: e.clientX }
    pointerId.current = e.pointerId
    const el = rowEls.current[index]
    clearHold()
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      const h = (el?.offsetHeight ?? 44) + ROW_GAP
      try {
        el?.setPointerCapture(e.pointerId)
      } catch {
        /* 某些环境不支持, 忽略 */
      }
      setDrag({
        key,
        from: index,
        startY: pending.current?.startY ?? e.clientY,
        dy: 0,
        to: index,
        h,
      })
    }, HOLD_MS)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) {
      // 还没拾起: 移动超过容差就判定为滚动/误触, 取消长按。
      const p = pending.current
      if (
        p &&
        (Math.abs(e.clientY - p.startY) > MOVE_TOLERANCE ||
          Math.abs(e.clientX - p.startX) > MOVE_TOLERANCE)
      ) {
        clearHold()
        pending.current = null
      }
      return
    }
    e.preventDefault()
    const dy = e.clientY - drag.startY
    const shift = Math.round(dy / drag.h)
    const to = clamp(drag.from + shift, 0, items.length - 1)
    setDrag((d) => (d ? { ...d, dy, to } : d))
  }

  const finishDrag = () => {
    clearHold()
    pending.current = null
    if (!drag) return
    if (drag.to !== drag.from) {
      onReorder(
        arrayMove(
          items.map((i) => i.key),
          drag.from,
          drag.to,
        ),
      )
    }
    suppressClick.current = drag.key // 吞掉这一行紧随的 click
    const dragged = drag.key
    setTimeout(() => {
      if (suppressClick.current === dragged) suppressClick.current = null
    }, 400)
    setDrag(null)
    pointerId.current = null
  }

  const onClickRow = (key: NavKey) => {
    if (suppressClick.current === key) {
      suppressClick.current = null
      return
    }
    onActivate(key)
  }

  // 拖动中各行的位移: 被拖行跟手抬起; 其余行按"插入位置"整行让位。
  const transformFor = (index: number): React.CSSProperties => {
    if (!drag) return {}
    if (index === drag.from) {
      return {
        transform: `translateY(${drag.dy}px) scale(1.03)`,
        zIndex: 30,
        position: 'relative',
        cursor: 'grabbing',
      }
    }
    let offset = 0
    if (drag.from < drag.to && index > drag.from && index <= drag.to) offset = -drag.h
    else if (drag.from > drag.to && index >= drag.to && index < drag.from) offset = drag.h
    return {
      transform: `translateY(${offset}px)`,
      transition: 'transform 180ms cubic-bezier(0.2,0,0,1)',
    }
  }

  return (
    <>
      {items.map((item, index) => {
        const { key, label, icon: Icon, hint } = item
        const on = key === activeKey
        const badge = badgeFor(key)
        const lifted = drag?.from === index
        const btn = (
          <button
            data-tour={`nav-${key}`}
            onClick={() => onClickRow(key)}
            className={cn(
              'group flex w-full items-center rounded-lg py-2.5 text-left transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-2.5',
              on
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
              lifted && 'bg-sidebar-accent shadow-lg ring-1 ring-border',
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

        // 包裹层承载拖动手势与位移变换; touch-none 仅在拾起后由 preventDefault 阻止滚动。
        const row = (
          <div
            key={key}
            ref={(el) => {
              rowEls.current[index] = el
            }}
            style={transformFor(index)}
            onPointerDown={(e) => onPointerDown(e, index, key)}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            className={cn(lifted && 'select-none', 'touch-pan-y')}
          >
            {collapsed && !drag ? (
              <Tooltip>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side={tooltipSide} className="font-medium">
                  {label}
                </TooltipContent>
              </Tooltip>
            ) : (
              btn
            )}
          </div>
        )
        return row
      })}
    </>
  )
}
