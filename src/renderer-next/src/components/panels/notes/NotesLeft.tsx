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

interface TagNode {
  name: string
  full: string
  count: number
  children: Map<string, TagNode>
}
function buildTagTree(tags: { tag: string; count: number }[]): TagNode {
  const root: TagNode = { name: '', full: '', count: 0, children: new Map() }
  for (const { tag, count } of tags) {
    let node = root
    let full = ''
    for (const seg of tag.split('/')) {
      full = full ? `${full}/${seg}` : seg
      let child = node.children.get(seg)
      if (!child) {
        child = { name: seg, full, count: 0, children: new Map() }
        node.children.set(seg, child)
      }
      child.count += count
      node = child
    }
  }
  return root
}

function TagTreeNode({ node, depth }: { node: TagNode; depth: number }) {
  const setQuery = useNotesUi((s) => s.setQuery)
  const [open, setOpen] = useState(true)
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/50"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {kids.length > 0 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-muted-foreground">
            <ChevronDown className={cn('size-3 transition-transform', !open && '-rotate-90')} />
          </button>
        ) : (
          <span className="w-3" />
        )}
        <button
          type="button"
          onClick={() => setQuery(`tag:${node.full}`)}
          className="flex min-w-0 flex-1 items-center justify-between text-xs text-primary"
        >
          <span className="truncate">#{node.name}</span>
          <span className="ml-1 shrink-0 opacity-60">{node.count}</span>
        </button>
      </div>
      {open && kids.map((c) => <TagTreeNode key={c.full} node={c} depth={depth + 1} />)}
    </div>
  )
}

function TagStrip() {
  const index = useVaultStore((s) => s.index)
  const [open, setOpen] = useState(true)
  const tags = useMemo(() => (index ? index.tags() : []), [index])
  const tree = useMemo(() => buildTagTree(tags), [tags])
  if (tags.length === 0) return null
  const roots = [...tree.children.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
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
        <div className="max-h-48 overflow-auto px-2 pb-3">
          {roots.map((n) => (
            <TagTreeNode key={n.full} node={n} depth={0} />
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
