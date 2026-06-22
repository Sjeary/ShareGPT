import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { parseQuickAdd } from '@/lib/quickadd'
import type { ParsedQuickAdd } from '@/lib/quickadd'

// 快速添加输入条 (始终置于任务列表顶部)。
//  - 边输入边解析, 下方显示识别命中提示 (优先级/标签/日期/时间)
//  - 回车提交: 把解析结果交给父级建任务; 清空输入
export function QuickAddBar({
  onAdd,
  placeholder = '添加任务，试试「明天 下午5点 写周报 !high #工作」',
}: {
  onAdd: (parsed: ParsedQuickAdd) => void
  placeholder?: string
}) {
  const [value, setValue] = useState('')

  // 实时解析 (仅用于命中提示; 提交时再解析一次保证一致)。
  const preview = useMemo(() => (value.trim() ? parseQuickAdd(value) : null), [value])

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const parsed = parseQuickAdd(text)
    // 标题被解析空 (只输入了 #tag/日期) 时, 用原文兜底, 避免空任务。
    if (!parsed.title) parsed.title = text
    onAdd(parsed)
    setValue('')
  }

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 shadow-sm transition-colors focus-within:border-primary/60">
        <Plus className="size-[18px] shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          className="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 md:text-base"
        />
      </div>
      {/* 解析命中提示 */}
      {preview && preview.hints.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
          {preview.hints.map((h, i) => (
            <span
              key={`${h.kind}-${i}`}
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-sm',
                h.kind === 'priority' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                h.kind === 'tag' && 'bg-primary/10 text-primary',
                (h.kind === 'date' || h.kind === 'time') &&
                  'bg-blue-500/15 text-blue-600 dark:text-blue-400',
              )}
            >
              {h.label}
            </span>
          ))}
          <span className="text-sm text-muted-foreground">→ {preview.title || '(无标题)'}</span>
        </div>
      )}
    </div>
  )
}
