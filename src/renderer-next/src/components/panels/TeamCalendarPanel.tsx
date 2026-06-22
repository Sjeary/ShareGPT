import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, WifiOff } from 'lucide-react'
import { addDays, addMonths, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { Button } from '@/components/ui/button'
import { useTeamCalendar } from '@/hooks/useTeamCalendar'
import { useTeamCalendarStore } from '@/store/useTeamCalendarStore'
import { MonthView } from '@/components/panels/team/MonthView'
import { WeekView } from '@/components/panels/team/WeekView'
import { MemberSidebar } from '@/components/panels/team/MemberSidebar'
import { EventEditorDialog } from '@/components/panels/team/EventEditorDialog'
import { EventDetailDialog } from '@/components/panels/team/EventDetailDialog'
import {
  fmtMonthTitle,
  fmtWeekTitle,
  monthGridDays,
  weekDays,
} from '@/components/panels/team/calendarUtils'

// 组队(共享)日历主面板。月/周视图 + 成员筛选 + 事件编辑器 + RSVP。
// Shell 通过该精确路径与导出名引入: export function TeamCalendarPanel()。
export function TeamCalendarPanel() {
  const { source, username, events, createEvent, updateEvent, deleteEvent, setRsvp } =
    useTeamCalendar()

  const view = useTeamCalendarStore((s) => s.view)
  const anchor = useTeamCalendarStore((s) => s.anchor)
  const hiddenOrganizers = useTeamCalendarStore((s) => s.hiddenOrganizers)
  const editorTarget = useTeamCalendarStore((s) => s.editorTarget)
  const setView = useTeamCalendarStore((s) => s.setView)
  const setAnchor = useTeamCalendarStore((s) => s.setAnchor)
  const toggleOrganizer = useTeamCalendarStore((s) => s.toggleOrganizer)
  const openEditor = useTeamCalendarStore((s) => s.openEditor)

  // 详情/编辑分离: 点击事件先看详情(可 RSVP), 详情里再进入编辑。
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editorDefaultStart, setEditorDefaultStart] = useState(new Date().toISOString())

  // 成员筛选后的事件。
  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenOrganizers.includes(e.organizer)),
    [events, hiddenOrganizers],
  )

  const anchorDate = useMemo(() => parseISO(anchor), [anchor])
  const days = useMemo(
    () => (view === 'month' ? monthGridDays(anchor) : weekDays(anchor)),
    [view, anchor],
  )

  const editingEvent =
    editorTarget && editorTarget !== 'new'
      ? (events.find((e) => e.id === editorTarget) ?? null)
      : null
  const detailEvent = detailId ? (events.find((e) => e.id === detailId) ?? null) : null

  const goPrev = () =>
    setAnchor(
      (view === 'month' ? addMonths(anchorDate, -1) : addDays(anchorDate, -7)).toISOString(),
    )
  const goNext = () =>
    setAnchor((view === 'month' ? addMonths(anchorDate, 1) : addDays(anchorDate, 7)).toISOString())
  const goToday = () => setAnchor(new Date().toISOString())

  const openNew = (startIso?: string) => {
    setEditorDefaultStart(startIso || new Date().toISOString())
    openEditor('new')
  }

  const handleSelectDay = (day: Date) => {
    // 点击空白日期: 以该天 09:00 为默认开始新建。
    const d = new Date(day)
    d.setHours(9, 0, 0, 0)
    openNew(d.toISOString())
  }

  const toolbar = (
    <div className="flex items-center gap-1.5">
      <div className="mr-1 flex items-center rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => setView('month')}
          className={cn(
            'rounded px-3 py-1 text-sm transition-colors',
            view === 'month' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          月
        </button>
        <button
          type="button"
          onClick={() => setView('week')}
          className={cn(
            'rounded px-3 py-1 text-sm transition-colors',
            view === 'week' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          周
        </button>
      </div>
      <Button variant="outline" size="icon-sm" onClick={goPrev} aria-label="上一页">
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={goToday}>
        今天
      </Button>
      <Button variant="outline" size="icon-sm" onClick={goNext} aria-label="下一页">
        <ChevronRight className="size-4" />
      </Button>
      <Button size="sm" onClick={() => openNew()}>
        <Plus className="size-4" /> 新建事件
      </Button>
    </div>
  )

  return (
    <PanelScaffold
      icon={CalendarDays}
      title={view === 'month' ? fmtMonthTitle(anchor) : fmtWeekTitle(anchor)}
      hint="团队共享日历"
      toolbar={toolbar}
      scrollable={false}
    >
      <div className="flex h-full min-h-0 flex-col">
        {source === 'local' && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            <WifiOff className="size-4" />
            未连接协作服务器，当前为本地预览（事件仅保存在本机）。
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            {view === 'month' ? (
              <MonthView
                days={days}
                anchorMonth={anchorDate.getMonth()}
                events={visibleEvents}
                onSelectEvent={(e) => setDetailId(e.id)}
                onSelectDay={handleSelectDay}
              />
            ) : (
              <WeekView
                days={days}
                events={visibleEvents}
                onSelectEvent={(e) => setDetailId(e.id)}
                onSelectDay={handleSelectDay}
              />
            )}
          </div>

          <MemberSidebar
            events={events}
            hiddenOrganizers={hiddenOrganizers}
            onToggle={toggleOrganizer}
          />
        </div>
      </div>

      {/* 详情 (可 RSVP / 进入编辑 / 删除) */}
      <EventDetailDialog
        event={detailEvent}
        currentUser={username}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null)
          openEditor(id)
        }}
        onRsvp={setRsvp}
        onDelete={async (id) => {
          await deleteEvent(id)
          setDetailId(null)
        }}
      />

      {/* 新建 / 编辑 */}
      <EventEditorDialog
        open={editorTarget !== null}
        event={editingEvent}
        defaultStart={editorDefaultStart}
        currentUser={username}
        onClose={() => openEditor(null)}
        onCreate={createEvent}
        onUpdate={updateEvent}
        onDelete={deleteEvent}
      />
    </PanelScaffold>
  )
}
