import { useMemo } from 'react'
import { CornerDownRight, FileText, Hash, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'

// 反链面板: 谁链接到了当前笔记 (含来源行上下文)。
export function BacklinksPanel() {
  const currentPath = useVaultStore((s) => s.currentPath)
  const index = useVaultStore((s) => s.index)
  const indexVersion = useVaultStore((s) => s.indexVersion)
  const openNote = useVaultStore((s) => s.openNote)

  const hits = useMemo(
    () => (currentPath && index ? index.backlinks(currentPath) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPath, index, indexVersion],
  )
  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; lines: typeof hits }>()
    for (const h of hits) {
      const g = map.get(h.fromPath)
      if (g) g.lines.push(h)
      else map.set(h.fromPath, { title: h.fromTitle, lines: [h] })
    }
    return [...map.entries()]
  }, [hits])

  if (!currentPath) return <Empty text="选择一篇笔记查看反链" />
  if (grouped.length === 0) return <Empty text="暂无反向链接" icon={<Link2 className="size-5" />} />

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-muted-foreground">
        {hits.length} 条反链 · {grouped.length} 篇笔记
      </p>
      {grouped.map(([path, g]) => (
        <div key={path} className="overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={() => void openNote(path)}
            className="flex w-full items-center gap-1.5 bg-muted/40 px-2.5 py-1.5 text-left text-sm font-medium transition-colors hover:bg-accent"
          >
            <FileText className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{g.title}</span>
          </button>
          <div className="divide-y divide-border/60">
            {g.lines.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void openNote(path)}
                className="flex w-full items-start gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
              >
                <CornerDownRight className="mt-0.5 size-3 shrink-0 opacity-60" />
                <span className="line-clamp-2 leading-relaxed">{l.context || '(空行引用)'}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// 大纲: 当前笔记标题树, 点击滚动到预览对应标题。
export function OutlinePanel() {
  const currentPath = useVaultStore((s) => s.currentPath)
  const note = useVaultStore((s) => (s.currentPath ? s.notesByPath[s.currentPath] : null))
  const setCenterMode = useNotesUi((s) => s.setCenterMode)

  if (!currentPath || !note) return <Empty text="选择一篇笔记查看大纲" />
  if (note.headings.length === 0) return <Empty text="没有标题" icon={<Hash className="size-5" />} />

  const minLevel = Math.min(...note.headings.map((h) => h.level))
  return (
    <div className="space-y-0.5 p-2">
      {note.headings.map((h, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            setCenterMode('preview')
            setTimeout(() => {
              document.getElementById(`h-${h.slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 60)
          }}
          className="block w-full truncate rounded px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          style={{ paddingLeft: (h.level - minLevel) * 12 + 8 }}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}

// 属性: 当前笔记 frontmatter。
export function PropertiesPanel() {
  const currentPath = useVaultStore((s) => s.currentPath)
  const note = useVaultStore((s) => (s.currentPath ? s.notesByPath[s.currentPath] : null))

  if (!currentPath || !note) return <Empty text="选择一篇笔记查看属性" />
  const entries = Object.entries(note.frontmatter)
  if (entries.length === 0 && note.tags.length === 0)
    return <Empty text="没有属性 (YAML frontmatter)" />

  return (
    <div className="space-y-2 p-3 text-sm">
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              #{t}
            </span>
          ))}
        </div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[auto_1fr] gap-2 border-b border-border/50 pb-1.5">
          <span className="font-medium text-muted-foreground">{k}</span>
          <span className="truncate text-right text-foreground">
            {Array.isArray(v) ? v.join(', ') : String(v)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Empty({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
      {icon && <span className="opacity-50">{icon}</span>}
      <span className={cn(!icon && 'opacity-80')}>{text}</span>
    </div>
  )
}
