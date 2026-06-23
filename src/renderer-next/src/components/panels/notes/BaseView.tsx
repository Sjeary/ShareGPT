import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import { parseBase, type BaseView as BV } from '@/lib/notes/bases'
import type { ParsedNote } from '@/lib/notes/types'

function cellValue(note: ParsedNote, col: string): string {
  switch (col) {
    case 'title':
      return note.title
    case 'tags':
      return note.tags.map((t) => '#' + t).join(' ')
    case 'path':
      return note.path
    case 'mtime':
      return new Date(note.mtime).toLocaleDateString()
    default: {
      const v = note.frontmatter[col]
      return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)
    }
  }
}

function applyFilter(notes: ParsedNote[], view: BV): ParsedNote[] {
  return notes.filter((n) => {
    if (view.filterTag && !n.tags.some((t) => t === view.filterTag || t.startsWith(view.filterTag + '/')))
      return false
    if (view.filterFolder && !n.path.startsWith(view.filterFolder.replace(/\/$/, '') + '/')) return false
    return true
  })
}

// Bases 视图: .base 文件 → 对 vault 笔记的表格/看板查询 (轻量子集)。
export function BaseView({ path }: { path: string }) {
  const raw = useVaultStore((s) => s.rawByPath[path] || '')
  const notesByPath = useVaultStore((s) => s.notesByPath)
  const openNote = useVaultStore((s) => s.openNote)
  const doc = useMemo(() => parseBase(raw), [raw])
  const [vi, setVi] = useState(0)

  const view = doc.views[Math.min(vi, doc.views.length - 1)]
  const rows = useMemo(() => {
    const all = Object.values(notesByPath).filter((n) => !n.path.endsWith('.canvas') && !n.path.endsWith('.base'))
    return applyFilter(all, view).sort((a, b) => b.mtime - a.mtime)
  }, [notesByPath, view])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {doc.views.length > 1 && (
        <div className="flex shrink-0 gap-1 border-b border-border p-1.5">
          {doc.views.map((v, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setVi(i)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                i === vi ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          {view.name} · {rows.length} 条
        </p>
        {view.type === 'board' && view.groupBy ? (
          <BoardView rows={rows} view={view} onOpen={openNote} />
        ) : (
          <TableView rows={rows} columns={view.columns} onOpen={openNote} />
        )}
      </div>
    </div>
  )
}

function TableView({
  rows,
  columns,
  onOpen,
}: {
  rows: ParsedNote[]
  columns: string[]
  onOpen: (p: string) => void
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {columns.map((c) => (
            <th key={c} className="px-3 py-2 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((n) => (
          <tr
            key={n.path}
            onClick={() => onOpen(n.path)}
            className="cursor-pointer border-b border-border/50 hover:bg-accent/50"
          >
            {columns.map((c) => (
              <td key={c} className={cn('px-3 py-2', c === 'title' && 'font-medium')}>
                {cellValue(n, c)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BoardView({
  rows,
  view,
  onOpen,
}: {
  rows: ParsedNote[]
  view: BV
  onOpen: (p: string) => void
}) {
  const groupBy = view.groupBy as string
  const groups = useMemo(() => {
    const map = new Map<string, ParsedNote[]>()
    for (const n of rows) {
      const key = cellValue(n, groupBy) || '（无）'
      const arr = map.get(key)
      if (arr) arr.push(n)
      else map.set(key, [n])
    }
    return [...map.entries()]
  }, [rows, groupBy])

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {groups.map(([key, items]) => (
        <div key={key} className="w-60 shrink-0 rounded-lg border border-border bg-muted/20 p-2">
          <div className="mb-2 px-1 text-sm font-semibold">
            {key} <span className="text-muted-foreground">{items.length}</span>
          </div>
          <div className="space-y-1.5">
            {items.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => onOpen(n.path)}
                className="block w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-sm shadow-sm transition-colors hover:bg-accent"
              >
                <div className="font-medium">{n.title}</div>
                {n.tags.length > 0 && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {n.tags.map((t) => '#' + t).join(' ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
