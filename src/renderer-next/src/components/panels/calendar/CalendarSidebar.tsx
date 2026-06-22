import { useState } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useCalendarStore } from '@/store/useCalendarStore'
import { CALENDAR_PALETTE } from './helpers'

// 左侧日历列表: 色点 + 名称 + 显隐勾选, 底部「新建日历」。
export function CalendarSidebar() {
  const calendars = useCalendarStore((s) => s.calendars)
  const toggleVisible = useCalendarStore((s) => s.toggleCalendarVisible)
  const addCalendar = useCalendarStore((s) => s.addCalendar)
  const removeCalendar = useCalendarStore((s) => s.removeCalendar)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(CALENDAR_PALETTE[0])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    addCalendar({ name: trimmed, color })
    setName('')
    setColor(CALENDAR_PALETTE[0])
    setAdding(false)
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground">
        我的日历
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {calendars.map((c) => (
          <div
            key={c.id}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
          >
            {/* 自绘勾选框: 选中填日历色 */}
            <button
              type="button"
              onClick={() => toggleVisible(c.id)}
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                c.visible ? 'border-transparent text-white' : 'border-border text-transparent',
              )}
              style={c.visible ? { backgroundColor: c.color } : undefined}
              aria-label={c.visible ? '隐藏' : '显示'}
            >
              <Check className="size-3" strokeWidth={3} />
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                c.visible ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {c.name}
            </span>
            {!c.isDefault && (
              <button
                type="button"
                onClick={() => removeCalendar(c.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                aria-label="删除日历"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 新建日历 */}
      <div className="border-t border-border p-2">
        {adding ? (
          <div className="flex flex-col gap-2 rounded-md bg-background p-2">
            <Input
              autoFocus
              placeholder="日历名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setAdding(false)
              }}
              className="h-8"
            />
            <div className="flex flex-wrap gap-1.5">
              {CALENDAR_PALETTE.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setColor(p)}
                  className={cn(
                    'size-5 rounded-full ring-offset-2 ring-offset-background transition-all',
                    color === p && 'ring-2 ring-ring',
                  )}
                  style={{ backgroundColor: p }}
                  aria-label="选择颜色"
                />
              ))}
            </div>
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
                取消
              </Button>
              <Button size="xs" onClick={submit}>
                添加
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" />
            新建日历
          </Button>
        )}
      </div>
    </aside>
  )
}
