import { useEffect, useMemo, useState } from 'react'
import { CheckSquare } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'
import { cn } from '@/lib/utils'
import { useTasksStore } from '@/store/useTasksStore'
import { TodoSidebar, type TodoSelection } from './todo/TodoSidebar'
import { TaskListView } from './todo/TaskListView'
import { TaskEditor } from './todo/TaskEditor'
import { MemoBoard } from './todo/MemoBoard'

type TopTab = 'todo' | 'memo'

// 待办 + 备忘录主面板。
//  - 顶部分段控件切换「待办 / 备忘录」
//  - 待办: 左栏(智能清单 + 用户清单) + 右侧任务列表(快速添加 + 分组列表) + 任务编辑器
//  - 备忘录: 瀑布流便签看板
// 数据由 useTasksStore 提供, 初始化时加载本地数据 (首次播种)。
export function TodoPanel() {
  const init = useTasksStore((s) => s.init)
  const lists = useTasksStore((s) => s.lists)
  const tasks = useTasksStore((s) => s.tasks)
  const inboxId = useTasksStore((s) => s.inboxId())

  const [tab, setTab] = useState<TopTab>('todo')
  const [selection, setSelection] = useState<TodoSelection>({ kind: 'smart', view: 'today' })
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  const editingTask = useMemo(
    () => (editingTaskId ? (tasks.find((t) => t.id === editingTaskId) ?? null) : null),
    [editingTaskId, tasks],
  )

  return (
    <PanelScaffold
      icon={CheckSquare}
      title="待办与备忘"
      hint="任务清单与便签"
      scrollable={false}
      toolbar={
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {(['todo', 'memo'] as TopTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-4 py-1.5 text-base font-medium transition-colors',
                tab === t
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'todo' ? '待办' : '备忘录'}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'todo' ? (
        <div className="flex h-full min-h-0">
          <TodoSidebar
            lists={lists}
            tasks={tasks}
            inboxId={inboxId}
            selection={selection}
            onSelect={setSelection}
          />
          <TaskListView
            selection={selection}
            lists={lists}
            tasks={tasks}
            inboxId={inboxId}
            onOpenTask={setEditingTaskId}
          />
          <TaskEditor
            task={editingTask}
            lists={lists}
            open={editingTaskId !== null}
            onOpenChange={(v) => {
              if (!v) setEditingTaskId(null)
            }}
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          <MemoBoard />
        </div>
      )}
    </PanelScaffold>
  )
}
