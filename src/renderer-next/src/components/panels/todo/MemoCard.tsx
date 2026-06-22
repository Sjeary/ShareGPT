import { Pin, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isLightColor, memoBg, memoTimeLabel } from './helpers'
import { useDarkMode } from './useDarkMode'
import type { Memo } from '@/store/useTasksStore'

// 便利贴卡片 (参考 Google Keep): 柔和底色 + 标题/正文 + 标签 + 更新时间; 悬停浮起并露出操作。
// 文字/叠加色按「实际底色亮度」决定深浅, 任意底色都保证可读 (不依赖 app 主题, 避免浅底配浅字)。
export function MemoCard({
  memo,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  memo: Memo
  onOpen: (id: string) => void
  onTogglePin: (id: string) => void
  onDelete: (id: string) => void
}) {
  const dark = useDarkMode()
  const bg = memoBg(memo.color, dark)
  const light = isLightColor(bg)
  const empty = !memo.title && !memo.body

  // 按底色亮度取叠加色 (浅底用黑系, 深底用白系)。
  const ink = light ? 'text-neutral-800' : 'text-neutral-100'
  const subtle = light ? 'text-black/45' : 'text-white/50'
  const hover = light ? 'hover:bg-black/5' : 'hover:bg-white/10'
  const chip = light ? 'bg-black/[0.06]' : 'bg-white/[0.12]'
  const borderCls = light ? 'border-black/[0.06]' : 'border-white/[0.08]'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(memo.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(memo.id)
        }
      }}
      style={{ backgroundColor: bg }}
      className={cn(
        'group relative mb-4 block w-full cursor-pointer break-inside-avoid rounded-2xl border p-4 text-left',
        'shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-[0_10px_26px_-8px_rgba(0,0,0,0.28)]',
        borderCls,
        ink,
        memo.pinned && 'ring-1 ring-primary/40',
      )}
    >
      {/* 置顶图钉 (置顶常显; 未置顶悬停露出) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin(memo.id)
        }}
        className={cn(
          'absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full transition-all',
          hover,
          memo.pinned ? 'text-primary' : cn(subtle, 'opacity-0 group-hover:opacity-100'),
        )}
        title={memo.pinned ? '取消置顶' : '置顶'}
      >
        <Pin className="size-4" fill={memo.pinned ? 'currentColor' : 'none'} />
      </button>

      {memo.title && (
        <h4 className="mb-1.5 pr-7 text-[15px] leading-snug font-semibold break-words">
          {memo.title}
        </h4>
      )}
      {memo.body && (
        <p
          className={cn(
            'text-[14px] leading-relaxed break-words whitespace-pre-wrap line-clamp-[10]',
            light ? 'text-black/80' : 'text-white/85',
            !memo.title && 'pr-7',
          )}
        >
          {memo.body}
        </p>
      )}
      {empty && <p className={cn('pr-7 text-[14px] italic', subtle)}>空便签</p>}

      {memo.tags && memo.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {memo.tags.map((t) => (
            <span key={t} className={cn('rounded-full px-2 py-0.5 text-[12px]', chip)}>
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 底部: 更新时间 + 悬停删除 */}
      <div className="mt-3 flex h-5 items-center justify-between">
        <span className={cn('text-[12px] tabular-nums', subtle)}>
          {memoTimeLabel(memo.updatedAt)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(memo.id)
          }}
          className={cn(
            'grid size-6 place-items-center rounded-full opacity-0 transition-all group-hover:opacity-100 hover:text-destructive',
            subtle,
            hover,
          )}
          title="删除便签"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
