import { useEffect, useState } from 'react'
import { Pin, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MEMO_COLORS, isLightColor, memoBg } from './helpers'
import { useDarkMode } from './useDarkMode'
import type { Memo } from '@/store/useTasksStore'
import { useTasksStore } from '@/store/useTasksStore'

// 便签编辑器 (Dialog): 标题 + 多行正文 + 颜色色板 + 置顶 + 删除。
export function MemoEditor({
  memo,
  open,
  onOpenChange,
}: {
  memo: Memo | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const updateMemo = useTasksStore((s) => s.updateMemo)
  const removeMemo = useTasksStore((s) => s.removeMemo)
  const dark = useDarkMode()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [color, setColor] = useState(MEMO_COLORS[0].bg)
  const [pinned, setPinned] = useState(false)

  const bg = memoBg(color, dark)
  const light = isLightColor(bg)
  const ink = light ? 'text-neutral-800' : 'text-neutral-100'
  const ph = light ? 'placeholder:text-neutral-500' : 'placeholder:text-neutral-400'
  const borderCls = light ? 'border-black/10' : 'border-white/10'

  useEffect(() => {
    if (!memo) return
    setTitle(memo.title ?? '')
    setBody(memo.body)
    setColor(memo.color)
    setPinned(memo.pinned)
  }, [memo])

  if (!memo) return null

  const persist = () => {
    updateMemo(memo.id, {
      title: title.trim() || undefined,
      body,
      color,
      pinned,
    })
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) persist()
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        style={{ backgroundColor: bg }}
      >
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle className="sr-only">编辑便签</DialogTitle>
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
              className={cn(
                'h-10 border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0 md:text-lg',
                ink,
                ph,
              )}
            />
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-md transition-colors',
                pinned
                  ? 'text-primary'
                  : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
              )}
              title={pinned ? '取消置顶' : '置顶'}
            >
              <Pin className="size-4" fill={pinned ? 'currentColor' : 'none'} />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 pb-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="写点什么…"
            rows={8}
            className={cn(
              'w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed outline-none',
              ink,
              ph,
            )}
          />
        </div>

        {/* 颜色色板 */}
        <div className="flex items-center gap-2 px-5 pb-2">
          {MEMO_COLORS.map((c) => (
            <button
              key={c.bg}
              type="button"
              onClick={() => setColor(c.bg)}
              className={cn(
                'size-6 rounded-full border border-black/10 ring-offset-2 transition-all dark:border-white/10',
                color === c.bg && 'ring-2 ring-neutral-500',
              )}
              style={{ backgroundColor: dark ? c.darkBg : c.bg }}
              title={c.name}
            />
          ))}
        </div>

        <DialogFooter
          className={cn('flex-row items-center justify-between border-t px-5 py-2.5', borderCls)}
        >
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              removeMemo(memo.id)
              onOpenChange(false)
            }}
          >
            <Trash2 className="size-4" />
            删除
          </Button>
          <Button
            size="sm"
            onClick={() => {
              persist()
              onOpenChange(false)
            }}
          >
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
