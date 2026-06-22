import { useEffect, useState, useCallback } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { addDays, addMonths, addWeeks, startOfDay } from 'date-fns'
import { PanelScaffold } from './PanelScaffold'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCalendarStore } from '@/store/useCalendarStore'
import { periodLabel, type CalendarView } from './calendar/helpers'
import { CalendarSidebar } from './calendar/CalendarSidebar'
import { MonthView } from './calendar/MonthView'
import { WeekView } from './calendar/WeekView'
import { DayView } from './calendar/DayView'
import { EventEditorDialog, type EditorTarget } from './calendar/EventEditorDialog'

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'week', label: '周' },
  { value: 'day', label: '日' },
]

// 个人日历主面板。
// 布局: 左侧日历列表 + 右侧 [工具条(视图切换/导航/今天/新建) + 视图主体]。
// 状态: cursor(当前定位日期) + view(月/周/日) + editorTarget(编辑器开关)。
export function CalendarPanel() {
  const init = useCalendarStore((s) => s.init)
  const loaded = useCalendarStore((s) => s.loaded)

  const [cursor, setCursor] = useState(() => new Date())
  const [view, setView] = useState<CalendarView>('month')
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null)

  // 初始化: 加载本地数据 (首次播种)。
  useEffect(() => {
    void init()
  }, [init])

  // 按视图单位前后翻页。
  const stepBy = useCallback(
    (dir: 1 | -1) => {
      setCursor((c) => {
        if (view === 'month') return addMonths(c, dir)
        if (view === 'week') return addWeeks(c, dir)
        return addDays(c, dir)
      })
    },
    [view],
  )

  // 键盘左右箭头翻页 (P1)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 编辑器打开或正在输入时不拦截。
      if (editorTarget) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') stepBy(-1)
      else if (e.key === 'ArrowRight') stepBy(1)
      else if (e.key === 't' || e.key === 'T') setCursor(new Date())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepBy, editorTarget])

  // 月视图点空白日 -> 在该日 9:00 新建。
  const handlePickDay = useCallback((day: Date) => {
    const start = startOfDay(day)
    start.setHours(9, 0, 0, 0)
    setEditorTarget({
      eventId: null,
      draftStart: start.toISOString(),
      draftEnd: new Date(start.getTime() + 3600_000).toISOString(),
      draftAllDay: false,
    })
  }, [])

  // 时间网格点空白时段 -> 在该时段新建 (持续 1 小时)。
  const handlePickSlot = useCallback((slotStart: Date) => {
    setEditorTarget({
      eventId: null,
      draftStart: slotStart.toISOString(),
      draftEnd: new Date(slotStart.getTime() + 3600_000).toISOString(),
      draftAllDay: false,
    })
  }, [])

  // 点事件 -> 编辑。
  const handlePickEvent = useCallback((eventId: string) => {
    setEditorTarget({ eventId })
  }, [])

  // 顶部「+」: 在 cursor 当天 9:00 新建。
  const handleQuickAdd = useCallback(() => {
    handlePickDay(cursor)
  }, [cursor, handlePickDay])

  const toolbar = (
    <div className="flex items-center gap-2">
      {/* 视图切换 (分段控件) */}
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setView(opt.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              view === opt.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <Button variant="default" size="sm" onClick={handleQuickAdd}>
        <Plus className="size-4" />
        新建
      </Button>
    </div>
  )

  return (
    <PanelScaffold
      icon={CalendarDays}
      title="日历"
      hint="个人日程"
      toolbar={toolbar}
      scrollable={false}
    >
      <div className="flex h-full min-h-0">
        <CalendarSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 导航条: ‹ › + 今天 + 当前时段标签 */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <Button variant="ghost" size="icon-sm" onClick={() => stepBy(-1)} aria-label="上一页">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => stepBy(1)} aria-label="下一页">
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
              今天
            </Button>
            <h2 className="ml-1 text-base font-semibold text-foreground">
              {periodLabel(cursor, view)}
            </h2>
          </div>

          {/* 视图主体 */}
          {loaded ? (
            view === 'month' ? (
              <MonthView cursor={cursor} onPickDay={handlePickDay} onPickEvent={handlePickEvent} />
            ) : view === 'week' ? (
              <WeekView cursor={cursor} onPickSlot={handlePickSlot} onPickEvent={handlePickEvent} />
            ) : (
              <DayView cursor={cursor} onPickSlot={handlePickSlot} onPickEvent={handlePickEvent} />
            )
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          )}
        </div>
      </div>

      {/* 事件编辑器 */}
      <EventEditorDialog target={editorTarget} onClose={() => setEditorTarget(null)} />
    </PanelScaffold>
  )
}
