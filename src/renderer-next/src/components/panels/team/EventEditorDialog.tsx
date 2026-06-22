import { useMemo, useState } from 'react'
import { Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatStore } from '@/store/useChatStore'
import type { TeamEvent } from '@/store/useTeamCalendarStore'
import type { TeamEventDraft } from '@/hooks/useTeamCalendar'
import { RsvpBadge } from './RsvpBadge'
import { fromLocalInputValue, toDateInputValue, toLocalInputValue } from './calendarUtils'

// 事件颜色可选项 (与成员色板呼应, 但允许手动覆盖)。
const COLOR_OPTIONS = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
]

interface AttendeePick {
  username: string
  displayName: string
}

interface EditorProps {
  event: TeamEvent | null
  defaultStart: string
  currentUser: string
  onClose: () => void
  onCreate: (draft: TeamEventDraft) => Promise<void>
  onUpdate: (id: string, patch: Partial<TeamEventDraft>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

// 外层只负责 Dialog 壳; 表单本体通过 key 在每次打开/切换目标时重挂载,
// 这样初始值直接由 props 经 useState 惰性初始化, 无需 setState-in-effect。
export function EventEditorDialog({ open, ...rest }: EditorProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? rest.onClose() : undefined)}>
      {open && <EventEditorForm key={rest.event?.id ?? 'new'} {...rest} />}
    </Dialog>
  )
}

function EventEditorForm({
  event, // null = 新建
  defaultStart, // 新建时的默认开始 ISO
  currentUser,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: EditorProps) {
  const directory = useChatStore((s) => s.directory)

  // 惰性初始化: 编辑态取自事件, 新建态以 defaultStart 起 1 小时。
  const initial = useMemo(() => {
    if (event) {
      return {
        title: event.title,
        description: event.description ?? '',
        location: event.location ?? '',
        allDay: event.allDay,
        start: event.start,
        end: event.end || event.start,
        color: event.color || COLOR_OPTIONS[0],
        attendees: event.attendees.map((a) => ({
          username: a.username,
          displayName: a.displayName,
        })) as AttendeePick[],
      }
    }
    const s = defaultStart || new Date().toISOString()
    const e = new Date(new Date(s).getTime() + 60 * 60 * 1000).toISOString()
    return {
      title: '',
      description: '',
      location: '',
      allDay: false,
      start: s,
      end: e,
      color: COLOR_OPTIONS[0],
      attendees: [] as AttendeePick[],
    }
    // event/defaultStart 在组件生命周期内固定 (靠外层 key 重挂载切换)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [location, setLocation] = useState(initial.location)
  const [allDay, setAllDay] = useState(initial.allDay)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [color, setColor] = useState(initial.color)
  const [attendees, setAttendees] = useState<AttendeePick[]>(initial.attendees)
  const [memberQuery, setMemberQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const isEditing = Boolean(event)
  const canDelete = isEditing && event?.organizer === currentUser

  // 候选成员: 来自协作目录, 过滤已选 + 关键词。
  const candidates = useMemo(() => {
    const picked = new Set(attendees.map((a) => a.username))
    const q = memberQuery.trim().toLowerCase()
    return directory
      .filter((u) => !picked.has(u.username))
      .filter(
        (u) =>
          !q || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [directory, attendees, memberQuery])

  // 已选成员的 RSVP (编辑态可显示既有响应)。
  const rsvpByUser = useMemo(() => {
    const map = new Map<string, TeamEvent['attendees'][number]['rsvp']>()
    for (const a of event?.attendees ?? []) map.set(a.username, a.rsvp)
    return map
  }, [event])

  const addAttendee = (pick: AttendeePick) => {
    setAttendees((prev) =>
      prev.some((a) => a.username === pick.username) ? prev : [...prev, pick],
    )
    setMemberQuery('')
  }

  const addFreeUsername = () => {
    const name = memberQuery.trim()
    if (!name) return
    addAttendee({ username: name, displayName: name })
  }

  const removeAttendee = (username: string) => {
    setAttendees((prev) => prev.filter((a) => a.username !== username))
  }

  const buildDraft = (): TeamEventDraft | null => {
    const t = title.trim()
    if (!t) {
      toast.error('请填写事件标题')
      return null
    }
    if (!start) {
      toast.error('请选择开始时间')
      return null
    }
    let normalizedEnd = end || start
    if (new Date(normalizedEnd) < new Date(start)) normalizedEnd = start
    return {
      title: t,
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start,
      end: normalizedEnd,
      allDay,
      color,
      attendees,
    }
  }

  const handleSave = async () => {
    const draft = buildDraft()
    if (!draft) return
    setSaving(true)
    try {
      if (event) {
        await onUpdate(event.id, draft)
        toast.success('事件已更新')
      } else {
        await onCreate(draft)
        toast.success('事件已创建')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!event) return
    setSaving(true)
    try {
      await onDelete(event.id)
      toast.success('事件已删除')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="border-b border-border px-6 py-4">
        <DialogTitle className="text-lg">{isEditing ? '编辑事件' : '新建团队事件'}</DialogTitle>
      </DialogHeader>

      <ScrollArea className="max-h-[64vh]">
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-title">标题</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: 周会 / 评审 / 团建"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <Label htmlFor="ev-allday" className="cursor-pointer">
              全天
            </Label>
            <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>开始</Label>
              {allDay ? (
                <Input
                  type="date"
                  value={toDateInputValue(start)}
                  onChange={(e) => setStart(fromLocalInputValue(`${e.target.value}T00:00`))}
                />
              ) : (
                <Input
                  type="datetime-local"
                  value={toLocalInputValue(start)}
                  onChange={(e) => setStart(fromLocalInputValue(e.target.value))}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>结束</Label>
              {allDay ? (
                <Input
                  type="date"
                  value={toDateInputValue(end)}
                  onChange={(e) => setEnd(fromLocalInputValue(`${e.target.value}T23:59`))}
                />
              ) : (
                <Input
                  type="datetime-local"
                  value={toLocalInputValue(end)}
                  onChange={(e) => setEnd(fromLocalInputValue(e.target.value))}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-loc">地点</Label>
            <Input
              id="ev-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="会议室 / 线上链接 (可选)"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-desc">描述</Label>
            <textarea
              id="ev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充说明 (可选)"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-transform',
                    color === c
                      ? 'scale-110 border-foreground'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`颜色 ${c}`}
                />
              ))}
            </div>
          </div>

          {/* 参与者 */}
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1.5">
              <Users className="size-4" /> 参与者
            </Label>
            <div className="flex gap-2">
              <Input
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addFreeUsername()
                  }
                }}
                placeholder="搜索成员或输入用户名"
              />
              <Button type="button" variant="outline" size="sm" onClick={addFreeUsername}>
                添加
              </Button>
            </div>

            {candidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((u) => (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() =>
                      addAttendee({ username: u.username, displayName: u.displayName })
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        u.online ? 'bg-green-500' : 'bg-muted-foreground/40',
                      )}
                    />
                    {u.displayName}
                  </button>
                ))}
              </div>
            )}

            {attendees.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
                {attendees.map((a) => {
                  const rsvp = rsvpByUser.get(a.username) ?? 'needs_action'
                  return (
                    <div
                      key={a.username}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1"
                    >
                      <span className="truncate text-base">{a.displayName}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        {isEditing && <RsvpBadge status={rsvp} />}
                        <button
                          type="button"
                          onClick={() => removeAttendee(a.username)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="移除"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <DialogFooter className="flex-row items-center justify-between border-t border-border px-6 py-4">
        <div>
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
              <Trash2 className="size-4" /> 删除
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
