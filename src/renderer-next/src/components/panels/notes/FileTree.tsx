import { useMemo, useState, type MouseEvent } from 'react'
import {
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPen,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  Pencil,
  Table,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import type { ParsedNote } from '@/lib/notes/types'
import { inputPrompt } from './InputPrompt'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { STARTER_BASE } from '@/lib/notes/bases'

interface TreeNode {
  name: string
  path: string
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
    parent.children.push({ name: n.path.slice(idx + 1), path: n.path, isDir: false, title: n.title, children: [] })
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

interface RowCtx {
  currentPath: string | null
  collapsed: Set<string>
  toggle: (p: string) => void
  dragPath: string | null
  dropFolder: string | null
  setDragPath: (p: string | null) => void
  setDropFolder: (p: string | null) => void
  move: (from: string, folder: string) => void
  onFileMenu: (e: MouseEvent, node: TreeNode) => void
  onFolderMenu: (e: MouseEvent, node: TreeNode) => void
}

function Row({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: RowCtx }) {
  const openNote = useVaultStore((s) => s.openNote)

  if (node.isDir) {
    const isCollapsed = ctx.collapsed.has(node.path)
    const isDrop = ctx.dropFolder === node.path
    return (
      <div>
        <div
          onContextMenu={(e) => ctx.onFolderMenu(e, node)}
          onDragOver={(e) => {
            if (!ctx.dragPath) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            if (ctx.dropFolder !== node.path) ctx.setDropFolder(node.path)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const from = e.dataTransfer.getData('text/plain') || ctx.dragPath
            if (from) ctx.move(from, node.path)
            ctx.setDropFolder(null)
            ctx.setDragPath(null)
          }}
          className={cn('rounded-md', isDrop && 'bg-primary/15 ring-1 ring-inset ring-primary/40')}
        >
          <button
            type="button"
            onClick={() => ctx.toggle(node.path)}
            className="group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60"
            style={{ paddingLeft: depth * 12 + 6 }}
          >
            <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
            {isCollapsed ? <Folder className="size-3.5 shrink-0" /> : <FolderOpen className="size-3.5 shrink-0" />}
            <span className="truncate font-medium">{node.name}</span>
          </button>
        </div>
        {!isCollapsed && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} ctx={ctx} />)}
      </div>
    )
  }

  const active = ctx.currentPath === node.path
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', node.path)
        e.dataTransfer.effectAllowed = 'move'
        ctx.setDragPath(node.path)
      }}
      onDragEnd={() => {
        ctx.setDragPath(null)
        ctx.setDropFolder(null)
      }}
      onContextMenu={(e) => ctx.onFileMenu(e, node)}
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors',
        active ? 'bg-primary/15 text-primary' : 'hover:bg-accent/60',
        ctx.dragPath === node.path && 'opacity-40',
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
        title="更多"
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          ctx.onFileMenu(e, node)
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
  const openNote = useVaultStore((s) => s.openNote)
  const createNote = useVaultStore((s) => s.createNote)
  const renameNote = useVaultStore((s) => s.renameNote)
  const deleteNote = useVaultStore((s) => s.deleteNote)
  const moveToFolder = useVaultStore((s) => s.moveToFolder)
  const renameFolder = useVaultStore((s) => s.renameFolder)
  const deleteFolder = useVaultStore((s) => s.deleteFolder)

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(Object.values(notesByPath)), [notesByPath])
  const toggle = (p: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const move = (from: string, folder: string) => {
    const curFolder = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
    if (curFolder === folder) return
    void moveToFolder(from, folder)
      .then(() => toast.success(`已移动到 ${folder || '根目录'}`))
      .catch((e) => toast.error(e instanceof Error ? e.message : '移动失败'))
  }

  const newFile = async (folder: string, ext: '.md' | '.canvas' | '.base') => {
    const def = `${folder ? folder + '/' : ''}未命名${ext}`
    const name = await inputPrompt(`新建${ext === '.canvas' ? '白板' : ext === '.base' ? 'Base' : '笔记'} (相对路径)`, def)
    if (!name || !name.trim()) return
    const content = ext === '.canvas' ? '{\n  "nodes": [],\n  "edges": []\n}\n' : ext === '.base' ? STARTER_BASE : ''
    try {
      await createNote(name.trim(), content)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    }
  }

  const onFileMenu = (e: MouseEvent, node: TreeNode) => {
    e.preventDefault()
    const isMd = /\.(md|markdown)$/i.test(node.path)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '打开', icon: FileText, onClick: () => void openNote(node.path) },
        {
          label: '重命名',
          icon: Pencil,
          onClick: () =>
            void inputPrompt('重命名 (新路径)', node.path).then((v) => {
              if (v && v.trim() && v.trim() !== node.path)
                void renameNote(node.path, v.trim()).catch((err) => toast.error(err instanceof Error ? err.message : '重命名失败'))
            }),
        },
        ...(isMd
          ? [
              {
                label: '复制为双链',
                icon: Link2,
                onClick: () => {
                  void navigator.clipboard.writeText(`[[${node.title || node.name.replace(/\.md$/i, '')}]]`)
                  toast.success('已复制双链')
                },
              } as MenuItem,
            ]
          : []),
        {
          label: '复制路径',
          icon: Copy,
          onClick: () => {
            void navigator.clipboard.writeText(node.path)
            toast.success('已复制路径')
          },
        },
        {
          label: '删除',
          icon: Trash2,
          danger: true,
          sep: true,
          onClick: () => {
            if (window.confirm(`确认删除 “${node.title || node.name}”？`)) void deleteNote(node.path)
          },
        },
      ],
    })
  }

  const onFolderMenu = (e: MouseEvent, node: TreeNode) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '在此新建笔记', icon: FilePlus2, onClick: () => void newFile(node.path, '.md') },
        { label: '在此新建白板', icon: LayoutGrid, onClick: () => void newFile(node.path, '.canvas') },
        { label: '在此新建 Base', icon: Table, onClick: () => void newFile(node.path, '.base') },
        {
          label: '重命名文件夹',
          icon: FolderPen,
          sep: true,
          onClick: () =>
            void inputPrompt('重命名文件夹 (新路径前缀)', node.path).then((v) => {
              if (v && v.trim() && v.trim() !== node.path)
                void renameFolder(node.path, v.trim())
                  .then(() => toast.success('已重命名文件夹'))
                  .catch(() => toast.error('重命名失败'))
            }),
        },
        {
          label: '删除文件夹',
          icon: Trash2,
          danger: true,
          onClick: () => {
            if (window.confirm(`确认删除文件夹 “${node.name}” 及其下全部笔记？`))
              void deleteFolder(node.path).then(() => toast.success('已删除文件夹'))
          },
        },
      ],
    })
  }

  const onEmptyMenu = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return // 仅空白处
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '新建笔记', icon: FilePlus2, onClick: () => void newFile('', '.md') },
        { label: '新建白板', icon: LayoutGrid, onClick: () => void newFile('', '.canvas') },
        { label: '新建 Base', icon: Table, onClick: () => void newFile('', '.base') },
      ],
    })
  }

  const ctx: RowCtx = {
    currentPath,
    collapsed,
    toggle,
    dragPath,
    dropFolder,
    setDragPath,
    setDropFolder,
    move,
    onFileMenu,
    onFolderMenu,
  }

  return (
    <>
      <div
        className={cn(
          'min-h-full py-1',
          dragPath && dropFolder === null && 'rounded-md ring-1 ring-inset ring-primary/30',
        )}
        onContextMenu={onEmptyMenu}
        onDragOver={(e) => {
          if (!dragPath) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropFolder(null) // 根目录
        }}
        onDrop={(e) => {
          if (!dragPath) return
          e.preventDefault()
          const from = e.dataTransfer.getData('text/plain') || dragPath
          if (from) move(from, '')
          setDragPath(null)
          setDropFolder(null)
        }}
      >
        {tree.children.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">还没有笔记，右键新建</p>
        ) : (
          tree.children.map((c) => <Row key={c.path} node={c} depth={0} ctx={ctx} />)
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  )
}
