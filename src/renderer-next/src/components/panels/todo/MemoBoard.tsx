import { useMemo, useState } from 'react'
import { Pin, Plus, Search, StickyNote } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MemoCard } from './MemoCard'
import { MemoEditor } from './MemoEditor'
import { useTasksStore } from '@/store/useTasksStore'

// 备忘录看板: 顶部「新建便签」+ 搜索; 下方瀑布流便签卡片 (置顶浮于最前)。
export function MemoBoard() {
  const memos = useTasksStore((s) => s.memos)
  const addMemo = useTasksStore((s) => s.addMemo)
  const toggleMemoPin = useTasksStore((s) => s.toggleMemoPin)

  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  // 搜索 (标题/正文/标签) + 排序 (置顶优先, 再按更新时间倒序)。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? memos.filter(
          (m) =>
            (m.title ?? '').toLowerCase().includes(q) ||
            m.body.toLowerCase().includes(q) ||
            (m.tags ?? []).some((t) => t.toLowerCase().includes(q)),
        )
      : memos
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.updatedAt < b.updatedAt ? 1 : -1
    })
  }, [memos, query])

  const pinnedCount = filtered.filter((m) => m.pinned).length
  const editing = editingId ? (memos.find((m) => m.id === editingId) ?? null) : null

  const handleNew = () => {
    const m = addMemo({ body: '' })
    setEditingId(m.id)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-2 px-5 py-3">
        <Button size="sm" onClick={handleNew}>
          <Plus className="size-4" />
          新建便签
        </Button>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索便签…"
            className="h-10 pl-8 text-base md:text-base"
          />
        </div>
      </div>

      {/* 看板 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-muted">
              <StickyNote className="size-7 text-muted-foreground" />
            </div>
            <p className="text-base text-muted-foreground">
              {query ? '没有匹配的便签' : '还没有便签，点「新建便签」记一笔'}
            </p>
          </div>
        ) : (
          <>
            {pinnedCount > 0 && !query && (
              <div className="mb-1.5 flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <Pin className="size-3.5" />
                置顶
              </div>
            )}
            {/* CSS columns 瀑布流 (break-inside-avoid 保证卡片不被截断) */}
            <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
              {filtered.map((m) => (
                <MemoCard key={m.id} memo={m} onOpen={setEditingId} onTogglePin={toggleMemoPin} />
              ))}
            </div>
          </>
        )}
      </div>

      <MemoEditor
        memo={editing}
        open={editingId !== null}
        onOpenChange={(v) => {
          if (!v) setEditingId(null)
        }}
      />
    </div>
  )
}
