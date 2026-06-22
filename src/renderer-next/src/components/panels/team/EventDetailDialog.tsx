import { useState } from 'react'
import { CalendarClock, MapPin, Pencil, Trash2, User } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { colorForOrganizer, type RsvpStatus, type TeamEvent } from '@/store/useTeamCalendarStore'
import { RsvpBadge } from './RsvpBadge'
import { fmtDateTimeLong, fmtTime } from './calendarUtils'

// 事件详情弹窗: 时间/地点/描述/组织者/参与者(含 RSVP); 当前用户是参与者时显示 接受/拒绝/待定。
// 组织者可进入编辑 / 删除。

function eventColor(event: TeamEvent): string {
  return event.color || colorForOrganizer(event.organizer)
}

const RSVP_ACTIONS: { status: RsvpStatus; label: string; cls: string }[] = [
  { status: 'accept', label: '接受', cls: 'bg-green-600 hover:bg-green-600/90 text-white' },
  { status: 'tentative', label: '待定', cls: 'bg-amber-500 hover:bg-amber-500/90 text-white' },
  { status: 'decline', label: '拒绝', cls: 'bg-red-600 hover:bg-red-600/90 text-white' },
]

export function EventDetailDialog({
  event,
  currentUser,
  onClose,
  onEdit,
  onRsvp,
  onDelete,
}: {
  event: TeamEvent | null
  currentUser: string
  onClose: () => void
  onEdit: (id: string) => void
  onRsvp: (id: string, status: RsvpStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  if (!event) {
    return (
      <Dialog open={false} onOpenChange={() => onClose()}>
        <DialogContent />
      </Dialog>
    )
  }

  const me = event.attendees.find((a) => a.username === currentUser)
  const isOrganizer = event.organizer === currentUser
  const color = eventColor(event)

  const doRsvp = async (status: RsvpStatus) => {
    setBusy(true)
    try {
      await onRsvp(event.id, status)
      toast.success('已更新你的回复')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await onDelete(event.id)
      toast.success('事件已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-start gap-2">
            <span
              className="mt-1 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="min-w-0 break-words">{event.title}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-3 px-6 py-4 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <CalendarClock className="mt-0.5 size-4 shrink-0" />
              <span>
                {event.allDay
                  ? `${fmtDateTimeLong(event.start)} · 全天`
                  : `${fmtDateTimeLong(event.start)} – ${fmtTime(event.end)}`}
              </span>
            </div>

            {event.location && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{event.location}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="size-4 shrink-0" />
              <span>组织者：{event.organizer || '未知'}</span>
            </div>

            {event.description && (
              <p className="rounded-md bg-muted/50 p-3 text-foreground whitespace-pre-wrap">
                {event.description}
              </p>
            )}

            {/* 当前用户的 RSVP 操作 */}
            {me && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">我的回复</span>
                  <RsvpBadge status={me.rsvp} />
                </div>
                <div className="flex gap-2">
                  {RSVP_ACTIONS.map((a) => (
                    <button
                      key={a.status}
                      type="button"
                      disabled={busy}
                      onClick={() => doRsvp(a.status)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        me.rsvp === a.status
                          ? a.cls
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* 参与者列表 + 各自 RSVP */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                参与者 ({event.attendees.length})
              </span>
              {event.attendees.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无参与者</p>
              ) : (
                event.attendees.map((a) => (
                  <div key={a.username} className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.displayName}</span>
                    <RsvpBadge status={a.rsvp} />
                  </div>
                ))
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          {isOrganizer && (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={doDelete}
              className="mr-auto"
            >
              <Trash2 className="size-4" /> 删除
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" onClick={() => onEdit(event.id)}>
            <Pencil className="size-4" /> 编辑
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
