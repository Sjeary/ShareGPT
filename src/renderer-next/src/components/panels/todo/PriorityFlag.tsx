import { useEffect, useRef, useState } from 'react'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRIORITY_META, PRIORITY_OPTIONS } from './helpers'
import type { Priority } from '@/store/useTasksStore'

// 优先级旗标 + 下拉小菜单 (无 popover 组件, 用相对定位 + 点击外部关闭自建)。
export function PriorityFlag({
  value,
  onChange,
  size = 'md',
}: {
  value: Priority
  onChange: (p: Priority) => void
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const meta = PRIORITY_META[value]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          'grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent',
          size === 'sm' ? 'size-7' : 'size-8',
        )}
        title={`优先级: ${meta.label}`}
      >
        <Flag className={cn('size-4', meta.flag)} fill={value > 0 ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
          {PRIORITY_OPTIONS.map((p) => {
            const m = PRIORITY_META[p]
            return (
              <button
                key={p}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(p)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  value === p && 'bg-accent',
                )}
              >
                <Flag className={cn('size-4', m.flag)} fill={p > 0 ? 'currentColor' : 'none'} />
                <span>{p === 0 ? '无优先级' : `${m.label}优先级`}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
