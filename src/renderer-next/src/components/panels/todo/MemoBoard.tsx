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
  const removeMemo = useTasksStore((s) => s.removeMemo)

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

  const pinned = filtered.filter((m) => m.pinned)
  const others = filtered.filter((m) => !m.pinned)
  // 搜索时不分区, 直接平铺; 否则按 置顶 / 其他 分区 (Google Keep 风格)。
  const sections =
    query.trim() || pinned.length === 0
      ? [{ key: 'all', label: '', items: filtered }]
      : [
          { key: 'pinned', label: '置顶', items: pinned },
          { key: 'others', label: '其他', items: others },
        ].filter((s) => s.items.length > 0)
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
          <div className="space-y-5">
            {sections.map((sec) => (
              <section key={sec.key}>
                {sec.label && (
                  <div className="mb-2 flex items-center gap-1.5 px-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {sec.key === 'pinned' && <Pin className="size-3.5" />}
                    {sec.label}
                  </div>
                )}
                {/* CSS columns 瀑布流 (break-inside-avoid 保证卡片不被截断) */}
                <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
                  {sec.items.map((m) => (
                    <MemoCard
                      key={m.id}
                      memo={m}
                      onOpen={setEditingId}
                      onTogglePin={toggleMemoPin}
                      onDelete={removeMemo}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
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
