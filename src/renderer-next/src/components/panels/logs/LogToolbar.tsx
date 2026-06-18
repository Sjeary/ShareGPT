import type { ReactNode } from 'react'
import { Copy, Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { sourceLabelOf } from './types'

// 日志面板顶部工具条: 清空 / 复制全部 / 暂停自动滚动 / 按来源过滤。
export function LogToolbar({
  sources,
  activeSource,
  onSourceChange,
  autoScroll,
  onToggleAutoScroll,
  onCopy,
  onClear,
  count,
  filteredCount,
}: {
  sources: string[]
  activeSource: string | null // null = 全部
  onSourceChange: (source: string | null) => void
  autoScroll: boolean
  onToggleAutoScroll: () => void
  onCopy: () => void
  onClear: () => void
  count: number
  filteredCount: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2">
      {/* 来源过滤: 仅当出现过多个来源时显示 */}
      {sources.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            active={activeSource === null}
            onClick={() => onSourceChange(null)}
          >
            全部
          </FilterChip>
          {sources.map((src) => (
            <FilterChip
              key={src}
              active={activeSource === src}
              onClick={() => onSourceChange(src)}
            >
              {sourceLabelOf(src)}
            </FilterChip>
          ))}
        </div>
      )}

      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {activeSource === null
          ? `${count} 行`
          : `${filteredCount} / ${count} 行`}
      </span>

      <Button
        variant={autoScroll ? 'ghost' : 'secondary'}
        size="sm"
        onClick={onToggleAutoScroll}
        title={autoScroll ? '暂停自动滚动' : '恢复自动滚动'}
      >
        {autoScroll ? <Pause /> : <Play />}
        {autoScroll ? '自动滚动' : '已暂停'}
      </Button>

      <Button variant="ghost" size="sm" onClick={onCopy} title="复制全部日志">
        <Copy />
        复制
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        title="清空日志"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
        清空
      </Button>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
