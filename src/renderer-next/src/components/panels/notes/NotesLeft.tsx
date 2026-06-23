import { useMemo, useState } from 'react'
import { ChevronDown, FileText, Hash, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'
import { FileTree } from './FileTree'

function SearchResults({ query }: { query: string }) {
  const index = useVaultStore((s) => s.index)
  const indexVersion = useVaultStore((s) => s.indexVersion)
  const currentPath = useVaultStore((s) => s.currentPath)
  const openNote = useVaultStore((s) => s.openNote)
  const hits = useMemo(
    () => (index ? index.search(query) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, indexVersion, query],
  )
  if (hits.length === 0)
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">无匹配结果</p>
  return (
    <div className="space-y-0.5 py-1">
      {hits.map((h) => (
        <button
          key={h.path}
          type="button"
          onClick={() => void openNote(h.path)}
          className={cn(
            'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
            currentPath === h.path ? 'bg-primary/15' : 'hover:bg-accent/60',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{h.title}</span>
          </span>
          {h.snippet && (
            <span className="line-clamp-2 pl-5 text-xs text-muted-foreground">{h.snippet}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function TagStrip() {
  const index = useVaultStore((s) => s.index)
  const indexVersion = useVaultStore((s) => s.indexVersion)
  const setQuery = useNotesUi((s) => s.setQuery)
  const [open, setOpen] = useState(true)
  const tags = useMemo(
    () => (index ? index.tags().slice(0, 50) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, indexVersion],
  )
  if (tags.length === 0) return null
  return (
    <div className="shrink-0 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        <Hash className="size-3.5" /> 标签 ({tags.length})
      </button>
      {open && (
        <div className="flex max-h-40 flex-wrap gap-1 overflow-auto px-3 pb-3">
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => setQuery(`tag:${t.tag}`)}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary transition-colors hover:bg-primary/20"
            >
              #{t.tag}
              <span className="ml-1 opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function NotesLeft() {
  const query = useNotesUi((s) => s.query)
  const setQuery = useNotesUi((s) => s.setQuery)
  const trimmed = query.trim()

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="shrink-0 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索  (tag:  path:)"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-sm outline-none transition-colors focus:border-primary/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {trimmed ? <SearchResults query={trimmed} /> : <FileTree />}
      </div>
      <TagStrip />
    </div>
  )
}
