import { useMemo } from 'react'
import { ClipboardList, CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { syncAllTasksToCalendar } from '@/lib/integrations'
import { QuickAddBar } from './QuickAddBar'
import { TaskItem } from './TaskItem'
import {
  DUE_GROUP_LABELS,
  groupByDue,
  selectByList,
  selectByView,
  sortCompleted,
} from '@/store/useTasksStore'
import type { Task, TaskList } from '@/store/useTasksStore'
import { useTasksStore } from '@/store/useTasksStore'
import type { TodoSelection } from './TodoSidebar'
import type { ParsedQuickAdd } from '@/lib/quickadd'

// 右侧任务列表区: 顶部快速添加 + 带语义分组头的任务列表。
//  - 智能视图「今天/最近7天/全部」按到期分组; 「已完成」按完成时间倒序; 清单视图按到期分组。
export function TaskListView({
  selection,
  lists,
  tasks,
  inboxId,
  onOpenTask,
}: {
  selection: TodoSelection
  lists: TaskList[]
  tasks: Task[]
  inboxId: string
  onOpenTask: (id: string) => void
}) {
  const addTask = useTasksStore((s) => s.addTask)
  const toggleTask = useTasksStore((s) => s.toggleTask)

  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])

  // 当前视图标题 + 该视图下任务集合。
  const { title, isCompleted, defaultListId } = useMemo(() => {
    if (selection.kind === 'list') {
      const l = listById.get(selection.id)
      return { title: l?.name ?? '清单', isCompleted: false, defaultListId: selection.id }
    }
    const labels: Record<string, string> = {
      today: '今天',
      next7: '最近7天',
      inbox: '收件箱',
      all: '全部',
      completed: '已完成',
    }
    return {
      title: labels[selection.view],
      isCompleted: selection.view === 'completed',
      defaultListId: selection.view === 'inbox' ? inboxId : inboxId,
    }
  }, [selection, listById, inboxId])

  const viewTasks = useMemo(() => {
    if (selection.kind === 'list') return selectByList(tasks, selection.id)
    return selectByView(tasks, selection.view, inboxId)
  }, [selection, tasks, inboxId])

  // 分组: 已完成不分组(倒序); 收件箱按到期分组但通常无日期; 其余按到期分组。
  const groups = useMemo(() => {
    if (isCompleted)
      return [{ group: 'completed' as const, label: '已完成', tasks: sortCompleted(viewTasks) }]
    const byDue = groupByDue(viewTasks)
    // 收件箱视图里若全部无日期, groupByDue 会只产出 none 组, 体验依然合理。
    return byDue.map((g) => ({ group: g.group, label: DUE_GROUP_LABELS[g.group], tasks: g.tasks }))
  }, [viewTasks, isCompleted])

  const total = viewTasks.length

  const handleAdd = (parsed: ParsedQuickAdd) => {
    addTask({
      title: parsed.title,
      listId: selection.kind === 'list' ? selection.id : defaultListId,
      priority: parsed.priority,
      tags: parsed.tags,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      isAllDay: !parsed.dueTime,
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* 标题条 */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <span className="text-base text-muted-foreground">{total}</span>
        </div>
        {/* 一键把当前所有「未完成且有到期日」的任务同步到个人日历 */}
        {!isCompleted && (
          <Button
            variant="outline"
            size="sm"
            title="把有到期日的待办一键同步到个人日历"
            onClick={() => {
              const n = syncAllTasksToCalendar()
              toast.success(n > 0 ? `已同步 ${n} 个任务到个人日历` : '没有可同步的任务(需有到期日)')
            }}
          >
            <CalendarPlus className="size-4" />
            同步到日历
          </Button>
        )}
      </div>

      {/* 快速添加 (已完成视图不显示) */}
      {!isCompleted && <QuickAddBar onAdd={handleAdd} />}

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-muted">
              <ClipboardList className="size-7 text-muted-foreground" />
            </div>
            <p className="text-base text-muted-foreground">
              {isCompleted ? '还没有已完成的任务' : '这里很清爽，添加一个任务吧'}
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-2 pt-2">
            {groups.map((g) => (
              <section key={g.group}>
                <h3 className="px-3 pb-1.5 text-sm font-semibold text-muted-foreground">
                  {g.label}
                  <span className="ml-1.5 font-normal">{g.tasks.length}</span>
                </h3>
                <div className="space-y-0.5">
                  {g.tasks.map((t) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      list={listById.get(t.listId)}
                      onToggle={toggleTask}
                      onOpen={onOpenTask}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
