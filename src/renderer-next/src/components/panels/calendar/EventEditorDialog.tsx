import { useEffect, useState } from 'react'
import { MapPin, FileText, Link2, Trash2, Repeat, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useCalendarStore } from '@/store/useCalendarStore'
import type { CalendarEvent, NewEventInput, RecurrenceFreq } from '@/store/useCalendarStore'
import { RECURRENCE_OPTIONS, type RecurrencePreset } from './helpers'

// 事件编辑器。两种模式:
//  - 新建: 传 draft (预填的起止/全天), eventId 为空。
//  - 编辑: 传 eventId (已存在事件)。
// 用 Dialog 承载, 字段用原生 input(date/time) + 自绘日历/重复选择器, 不依赖 select/popover。
export interface EditorTarget {
  // 已有事件 id (编辑) 或 null (新建)。
  eventId: string | null
  // 新建时的预填: 起止 ISO + 是否全天。
  draftStart?: string
  draftEnd?: string
  draftAllDay?: boolean
}

// 把 ISO 拆成 <input type=date> / <input type=time> 需要的本地字符串。
function isoToDateInput(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function isoToTimeInput(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}
// 由 date + time 组合回 ISO (本地时区)。
function partsToIso(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0)
  return dt.toISOString()
}

export function EventEditorDialog({
  target,
  onClose,
}: {
  target: EditorTarget | null
  onClose: () => void
}) {
  const calendars = useCalendarStore((s) => s.calendars)
  const events = useCalendarStore((s) => s.events)
  const addEvent = useCalendarStore((s) => s.addEvent)
  const updateEvent = useCalendarStore((s) => s.updateEvent)
  const removeEvent = useCalendarStore((s) => s.removeEvent)

  const open = target !== null
  const existing: CalendarEvent | undefined =
    target?.eventId != null ? events.find((e) => e.id === target.eventId) : undefined

  // 表单本地状态。
  const [title, setTitle] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState('')
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('none')

  // 打开时按 target 初始化表单。
  useEffect(() => {
    if (!target) return
    const defaultCal = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? ''
    if (existing) {
      setTitle(existing.title)
      setCalendarId(existing.calendarId)
      setAllDay(existing.allDay)
      setStartDate(isoToDateInput(existing.start))
      setStartTime(isoToTimeInput(existing.start))
      setEndDate(isoToDateInput(existing.end))
      setEndTime(isoToTimeInput(existing.end))
      setLocation(existing.location ?? '')
      setNotes(existing.notes ?? '')
      setUrl(existing.url ?? '')
      setRecurrence(existing.recurrence?.freq ?? 'none')
    } else {
      const s = target.draftStart ? new Date(target.draftStart) : new Date()
      const e = target.draftEnd ? new Date(target.draftEnd) : new Date(s.getTime() + 3600_000)
      setTitle('')
      setCalendarId(defaultCal)
      setAllDay(target.draftAllDay ?? false)
      setStartDate(isoToDateInput(s.toISOString()))
      setStartTime(isoToTimeInput(s.toISOString()))
      setEndDate(isoToDateInput(e.toISOString()))
      setEndTime(isoToTimeInput(e.toISOString()))
      setLocation('')
      setNotes('')
      setUrl('')
      setRecurrence('none')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.eventId, target?.draftStart, target?.draftEnd, open])

  const handleSave = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('请输入标题')
      return
    }
    if (!calendarId) {
      toast.error('请先选择日历')
      return
    }
    // 全天事件: 起止取整到当天 0 点 / 次日前。
    let startIso: string
    let endIso: string
    if (allDay) {
      startIso = partsToIso(startDate, '00:00')
      endIso = partsToIso(endDate || startDate, '00:00')
    } else {
      startIso = partsToIso(startDate, startTime)
      endIso = partsToIso(endDate || startDate, endTime)
    }
    // 结束早于开始: 自动顺延为开始 + 1 小时 (或同日全天)。
    if (new Date(endIso) < new Date(startIso)) {
      endIso = allDay ? startIso : new Date(new Date(startIso).getTime() + 3600_000).toISOString()
    }

    const recurrenceVal =
      recurrence === 'none' ? null : { freq: recurrence as RecurrenceFreq, interval: 1 }

    const payload: NewEventInput = {
      calendarId,
      title: trimmed,
      start: startIso,
      end: endIso,
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      url: url.trim() || undefined,
      recurrence: recurrenceVal,
    }

    if (existing) {
      updateEvent(existing.id, payload)
      toast.success('已更新')
    } else {
      addEvent(payload)
      toast.success('已创建')
    }
    onClose()
  }

  const handleDelete = () => {
    if (!existing) return
    removeEvent(existing.id)
    toast.success('已删除')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? '编辑事件' : '新建事件'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 标题 */}
          <Input
            autoFocus
            placeholder="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-base font-medium"
          />

          {/* 日历选择 (色点行) */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">日历</Label>
            <div className="flex flex-wrap gap-2">
              {calendars.map((c) => {
                const active = c.id === calendarId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCalendarId(c.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-transparent bg-secondary text-secondary-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                    {active && <Check className="size-3" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 全天 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="allday-switch">全天</Label>
            <Switch id="allday-switch" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          {/* 起止时间 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label className="w-10 shrink-0 text-xs text-muted-foreground">开始</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1"
              />
              {!allDay && (
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-28"
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-10 shrink-0 text-xs text-muted-foreground">结束</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1"
              />
              {!allDay && (
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-28"
                />
              )}
            </div>
          </div>

          {/* 重复 (自绘按钮组) */}
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Repeat className="size-3.5" />
              重复
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {RECURRENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRecurrence(opt.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors',
                    recurrence === opt.value
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 地点 */}
          <div className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="地点"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          {/* 链接 */}
          <div className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0 text-muted-foreground" />
            <Input placeholder="链接" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>

          {/* 备注 */}
          <div className="flex items-start gap-2">
            <FileText className="mt-2 size-4 shrink-0 text-muted-foreground" />
            <textarea
              placeholder="备注"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {existing ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
