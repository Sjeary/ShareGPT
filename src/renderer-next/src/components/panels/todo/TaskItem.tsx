import { useState } from 'react'
import { Check, ListChecks, Repeat as RepeatIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRIORITY_META, formatDue } from './helpers'
import type { Task, TaskList } from '@/store/useTasksStore'

// 单条任务行 (对齐滴答清单):
//  - 左侧圆形勾选 (点击完成: 填充 + 缩放反馈; 行随后描边/淡出, 由父级把它移入已完成)
//  - 优先级竖条着色 + 标题 + 到期 chip (逾期红) + 标签 chips + 子任务进度
//  - 整行点击打开编辑器
export function TaskItem({
  task,
  list,
  onToggle,
  onOpen,
}: {
  task: Task
  list?: TaskList
  onToggle: (id: string) => void
  onOpen: (id: string) => void
}) {
  // 本地“正在完成”动画态: 勾选后短暂淡出, 再交给 store 真正移动。
  const [leaving, setLeaving] = useState(false)
  const due = formatDue(task.dueDate, task.dueTime)
  const meta = PRIORITY_META[task.priority]
  const doneSubs = task.subtasks.filter((s) => s.completed).length
  const totalSubs = task.subtasks.length

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (task.completed) {
      onToggle(task.id)
      return
    }
    // 完成: 先播放淡出, 动画末尾再提交, 避免“瞬移”。
    setLeaving(true)
    window.setTimeout(() => onToggle(task.id), 280)
  }

  return (
    <div
      onClick={() => onOpen(task.id)}
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-3 transition-all hover:border-border hover:bg-accent/40',
        leaving && 'translate-x-1 scale-[0.98] opacity-0',
      )}
    >
      {/* 圆形勾选 */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={task.completed ? '标记未完成' : '标记完成'}
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-all duration-200 active:scale-90',
          task.completed
            ? 'border-primary bg-primary text-primary-foreground'
            : cn(
                'bg-transparent',
                task.priority === 3
                  ? 'border-red-500'
                  : task.priority === 2
                    ? 'border-amber-500'
                    : task.priority === 1
                      ? 'border-blue-500'
                      : 'border-muted-foreground/40 hover:border-primary',
              ),
          leaving && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        <Check
          className={cn(
            'size-3.5 transition-all duration-200',
            task.completed || leaving ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
          strokeWidth={3}
        />
      </button>

      {/* 主体 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {/* 优先级竖条 (无优先级不显示) */}
          {task.priority > 0 && (
            <span className={cn('mt-2 h-3.5 w-1 shrink-0 rounded-full', meta.dot)} />
          )}
          <p
            className={cn(
              'min-w-0 flex-1 text-[15px] leading-snug break-words',
              task.completed ? 'text-muted-foreground line-through' : 'text-foreground',
            )}
          >
            {task.title}
          </p>
        </div>

        {/* 元信息行: 到期 / 重复 / 子任务 / 标签 */}
        {(due || totalSubs > 0 || task.tags.length > 0 || task.repeat) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-0">
            {due && (
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-sm',
                  due.overdue && !task.completed
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {due.label}
              </span>
            )}
            {task.repeat && <RepeatIcon className="size-3.5 text-muted-foreground" />}
            {totalSubs > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-sm text-muted-foreground">
                <ListChecks className="size-3.5" />
                {doneSubs}/{totalSubs}
              </span>
            )}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-sm text-primary"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 右侧清单色点 (智能视图里能看出归属) */}
      {list && (
        <span
          className="mt-1.5 size-2 shrink-0 rounded-full opacity-70"
          style={{ backgroundColor: list.color }}
          title={list.name}
        />
      )}
    </div>
  )
}
