import { useMemo } from 'react'
import { CornerDownRight, FileText, Hash, Link2, Plus, X } from 'lucide-react'
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

// 属性: 当前笔记 frontmatter (预览态可编辑; 编辑态为避免与编辑器缓冲冲突仅只读)。
export function PropertiesPanel() {
  const currentPath = useVaultStore((s) => s.currentPath)
  const note = useVaultStore((s) => (s.currentPath ? s.notesByPath[s.currentPath] : null))
  const setFrontmatter = useVaultStore((s) => s.setFrontmatter)
  const editable = useNotesUi((s) => s.centerMode) !== 'edit'

  if (!currentPath || !note) return <Empty text="选择一篇笔记查看属性" />
  const fm = note.frontmatter
  const entries = Object.entries(fm)

  const commit = (next: Record<string, unknown>) => void setFrontmatter(currentPath, next)
  const setKey = (k: string, raw: string) => {
    // 逗号分隔且原值为数组 → 存数组; 否则存字符串/数字
    let val: unknown = raw
    if (Array.isArray(fm[k])) val = raw.split(',').map((s) => s.trim()).filter(Boolean)
    else if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d/.test(raw)) val = Number(raw)
    commit({ ...fm, [k]: val })
  }

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
      {entries.length === 0 && (
        <p className="py-2 text-xs text-muted-foreground">没有属性 (YAML frontmatter)</p>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="group grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 border-b border-border/50 pb-1.5">
          <span className="truncate font-medium text-muted-foreground" title={k}>
            {k}
          </span>
          {editable ? (
            <input
              defaultValue={Array.isArray(v) ? v.join(', ') : String(v ?? '')}
              onBlur={(e) => {
                const cur = Array.isArray(v) ? v.join(', ') : String(v ?? '')
                if (e.target.value !== cur) setKey(k, e.target.value)
              }}
              className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-right outline-none transition-colors hover:border-border focus:border-primary/60"
            />
          ) : (
            <span className="truncate text-right">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
          )}
          {editable && (
            <button
              type="button"
              title="删除属性"
              onClick={() => {
                const next = { ...fm }
                delete next[k]
                commit(next)
              }}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {editable ? (
        <button
          type="button"
          onClick={() => {
            const key = window.prompt('属性名')
            if (!key || !key.trim()) return
            const val = window.prompt(`${key} 的值`, '') ?? ''
            commit({ ...fm, [key.trim()]: val })
          }}
          className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" /> 添加属性
        </button>
      ) : (
        <p className="pt-1 text-[11px] text-muted-foreground/70">切到「预览」可编辑属性</p>
      )}
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
