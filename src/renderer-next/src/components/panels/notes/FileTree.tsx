import { useMemo, useState } from 'react'
import { ChevronRight, FileText, Folder, FolderOpen, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import type { ParsedNote } from '@/lib/notes/types'

interface TreeNode {
  name: string
  path: string // 文件夹为前缀, 文件为完整 path
  isDir: boolean
  title?: string
  children: TreeNode[]
}

function buildTree(notes: ParsedNote[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  const dirMap = new Map<string, TreeNode>()
  dirMap.set('', root)
  const ensureDir = (dirPath: string): TreeNode => {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!
    const idx = dirPath.lastIndexOf('/')
    const parent = ensureDir(idx >= 0 ? dirPath.slice(0, idx) : '')
    const node: TreeNode = {
      name: idx >= 0 ? dirPath.slice(idx + 1) : dirPath,
      path: dirPath,
      isDir: true,
      children: [],
    }
    parent.children.push(node)
    dirMap.set(dirPath, node)
    return node
  }
  for (const n of [...notes].sort((a, b) => a.path.localeCompare(b.path))) {
    const idx = n.path.lastIndexOf('/')
    const parent = ensureDir(idx >= 0 ? n.path.slice(0, idx) : '')
    parent.children.push({
      name: n.path.slice(idx + 1),
      path: n.path,
      isDir: false,
      title: n.title,
      children: [],
    })
  }
  const sortRec = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    node.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}

function Row({
  node,
  depth,
  currentPath,
  collapsed,
  toggle,
}: {
  node: TreeNode
  depth: number
  currentPath: string | null
  collapsed: Set<string>
  toggle: (p: string) => void
}) {
  const openNote = useVaultStore((s) => s.openNote)
  const renameNote = useVaultStore((s) => s.renameNote)
  const deleteNote = useVaultStore((s) => s.deleteNote)

  if (node.isDir) {
    const isCollapsed = collapsed.has(node.path)
    return (
      <div>
        <button
          type="button"
          onClick={() => toggle(node.path)}
          className="group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              !isCollapsed && 'rotate-90',
            )}
          />
          {isCollapsed ? (
            <Folder className="size-3.5 shrink-0" />
          ) : (
            <FolderOpen className="size-3.5 shrink-0" />
          )}
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {!isCollapsed &&
          node.children.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={depth + 1}
              currentPath={currentPath}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
      </div>
    )
  }

  const active = currentPath === node.path
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors',
        active ? 'bg-primary/15 text-primary' : 'hover:bg-accent/60',
      )}
      style={{ paddingLeft: depth * 12 + 6 }}
    >
      <button
        type="button"
        onClick={() => void openNote(node.path)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <FileText className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
        <span className="truncate">{node.title || node.name}</span>
      </button>
      <button
        type="button"
        title="重命名 / 删除"
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        onClick={() => {
          const action = window.prompt(
            `操作 "${node.title || node.name}":\n输入新路径以重命名, 或输入 DELETE 删除`,
            node.path,
          )
          if (action === null) return
          if (action.trim() === 'DELETE') {
            if (window.confirm(`确认删除 ${node.path}?`)) void deleteNote(node.path)
          } else if (action.trim() && action.trim() !== node.path) {
            void renameNote(node.path, action.trim())
          }
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  )
}

export function FileTree() {
  const notesByPath = useVaultStore((s) => s.notesByPath)
  const currentPath = useVaultStore((s) => s.currentPath)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(Object.values(notesByPath)), [notesByPath])
  const toggle = (p: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  if (tree.children.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">还没有笔记</p>
  }
  return (
    <div className="py-1">
      {tree.children.map((c) => (
        <Row
          key={c.path}
          node={c}
          depth={0}
          currentPath={currentPath}
          collapsed={collapsed}
          toggle={toggle}
        />
      ))}
    </div>
  )
}
