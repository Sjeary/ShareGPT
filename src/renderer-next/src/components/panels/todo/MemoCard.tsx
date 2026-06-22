import { Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { memoBg } from './helpers'
import { useDarkMode } from './useDarkMode'
import type { Memo } from '@/store/useTasksStore'

// 便利贴卡片: 彩色底 + 标题/正文摘要 + 置顶图钉。点击进入编辑。
export function MemoCard({
  memo,
  onOpen,
  onTogglePin,
}: {
  memo: Memo
  onOpen: (id: string) => void
  onTogglePin: (id: string) => void
}) {
  const dark = useDarkMode()
  return (
    <button
      type="button"
      onClick={() => onOpen(memo.id)}
      style={{ backgroundColor: memoBg(memo.color, dark) }}
      className={cn(
        'group relative mb-3 block w-full break-inside-avoid rounded-xl border border-black/5 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-white/5',
        'text-neutral-800 dark:text-neutral-100',
      )}
    >
      {/* 置顶图钉 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin(memo.id)
        }}
        className={cn(
          'absolute right-2 top-2 grid size-6 place-items-center rounded-md transition-all',
          memo.pinned
            ? 'text-primary'
            : 'text-black/30 opacity-0 group-hover:opacity-100 dark:text-white/40',
        )}
        title={memo.pinned ? '取消置顶' : '置顶'}
      >
        <Pin className="size-4" fill={memo.pinned ? 'currentColor' : 'none'} />
      </button>

      {memo.title && (
        <h4 className="mb-1.5 pr-6 text-base font-semibold break-words">{memo.title}</h4>
      )}
      {memo.body && (
        <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap opacity-90 line-clamp-[12]">
          {memo.body}
        </p>
      )}
      {!memo.title && !memo.body && <p className="text-[15px] italic opacity-50">空便签</p>}

      {memo.tags && memo.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {memo.tags.map((t) => (
            <span
              key={t}
              className="rounded-md bg-black/5 px-1.5 py-0.5 text-sm opacity-80 dark:bg-white/10"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
