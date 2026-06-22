import { useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Inbox,
  LayoutList,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { LIST_COLORS } from './helpers'
import type { SmartView, Task, TaskList } from '@/store/useTasksStore'
import { smartCount, selectByList } from '@/store/useTasksStore'
import { useTasksStore } from '@/store/useTasksStore'

// 当前选中的视图: 智能视图用 {kind:'smart', view}, 用户清单用 {kind:'list', id}。
export type TodoSelection = { kind: 'smart'; view: SmartView } | { kind: 'list'; id: string }

const SMART_ITEMS: { view: SmartView; label: string; icon: LucideIcon }[] = [
  { view: 'today', label: '今天', icon: CalendarDays },
  { view: 'next7', label: '最近7天', icon: CalendarClock },
  { view: 'inbox', label: '收件箱', icon: Inbox },
  { view: 'all', label: '全部', icon: LayoutList },
  { view: 'completed', label: '已完成', icon: CheckCircle2 },
]

export function TodoSidebar({
  lists,
  tasks,
  inboxId,
  selection,
  onSelect,
}: {
  lists: TaskList[]
  tasks: Task[]
  inboxId: string
  selection: TodoSelection
  onSelect: (sel: TodoSelection) => void
}) {
  const addList = useTasksStore((s) => s.addList)
  const removeList = useTasksStore((s) => s.removeList)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LIST_COLORS[5])
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const userLists = [...lists].filter((l) => !l.isInbox).sort((a, b) => a.sortOrder - b.sortOrder)

  const submitNew = () => {
    const n = name.trim()
    if (!n) {
      setAdding(false)
      return
    }
    const created = addList({ name: n, color })
    setName('')
    setAdding(false)
    onSelect({ kind: 'list', id: created.id })
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar/50">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {/* 智能清单 */}
        <nav className="space-y-0.5">
          {SMART_ITEMS.map(({ view, label, icon: Icon }) => {
            const active = selection.kind === 'smart' && selection.view === view
            const count = view === 'completed' ? 0 : smartCount(tasks, view, inboxId)
            return (
              <button
                key={view}
                type="button"
                onClick={() => onSelect({ kind: 'smart', view })}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                )}
              >
                <Icon className={cn('size-4 shrink-0', active && 'text-primary')} />
                <span className="flex-1 truncate text-left">{label}</span>
                {count > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* 分隔 + 用户清单标题 */}
        <div className="mt-4 mb-1 flex items-center justify-between px-2.5">
          <span className="text-xs font-medium text-muted-foreground">清单</span>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-muted-foreground transition-colors hover:text-foreground"
            title="新建清单"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <nav className="space-y-0.5">
          {userLists.map((l) => {
            const active = selection.kind === 'list' && selection.id === l.id
            const count = selectByList(tasks, l.id).length
            return (
              <div
                key={l.id}
                className={cn(
                  'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'list', id: l.id })}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="flex-1 truncate">{l.name}</span>
                </button>
                {count > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground group-hover:hidden">
                    {count}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuFor(menuFor === l.id ? null : l.id)
                  }}
                  className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {menuFor === l.id && (
                  <>
                    {/* 点击遮罩关闭 */}
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setMenuFor(null)}
                    />
                    <div className="absolute right-1 top-9 z-50 w-32 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          removeList(l.id)
                          setMenuFor(null)
                          if (active) onSelect({ kind: 'smart', view: 'today' })
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <Trash2 className="size-4" />
                        删除清单
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {/* 新建清单内联表单 */}
          {adding && (
            <div className="rounded-md bg-sidebar-accent/40 p-2">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNew()
                  if (e.key === 'Escape') {
                    setAdding(false)
                    setName('')
                  }
                }}
                onBlur={submitNew}
                placeholder="清单名称"
                className="h-7 text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LIST_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setColor(c)}
                    className={cn(
                      'size-4 rounded-full ring-offset-1 ring-offset-sidebar transition-all',
                      color === c && 'ring-2 ring-foreground',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}
        </nav>
      </div>
    </aside>
  )
}
