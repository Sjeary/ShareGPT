import { useEffect } from 'react'
import { Command } from 'cmdk'
import {
  CalendarDays,
  Eye,
  FilePlus2,
  FolderInput,
  FolderCog,
  LayoutGrid,
  Network,
  Pencil,
  Search,
  Table,
} from 'lucide-react'
import { toast } from 'sonner'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'
import { STARTER_BASE } from '@/lib/notes/bases'

interface Cmd {
  id: string
  label: string
  icon: typeof Eye
  hint?: string
  run: () => void
}

// 命令面板 (Ctrl/Cmd+P): 知识库常用动作。
export function CommandPalette() {
  const open = useNotesUi((s) => s.paletteOpen)
  const setOpen = useNotesUi((s) => s.setPaletteOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const ui = useNotesUi.getState()
  const vault = useVaultStore.getState()
  const close = () => setOpen(false)

  const cmds: Cmd[] = [
    {
      id: 'new',
      label: '新建笔记',
      icon: FilePlus2,
      hint: '相对路径',
      run: () => {
        const name = window.prompt('新建笔记 (相对路径)', '未命名.md')
        if (name && name.trim()) void vault.createNote(name.trim()).then(() => ui.setCenterMode('edit'))
      },
    },
    {
      id: 'today',
      label: '今日笔记',
      icon: CalendarDays,
      hint: 'Daily/YYYY-MM-DD',
      run: () => void vault.openToday().then(() => ui.setCenterMode('edit')),
    },
    {
      id: 'canvas',
      label: '新建白板 (.canvas)',
      icon: LayoutGrid,
      run: () => {
        const name = window.prompt('新建白板 (相对路径)', '白板.canvas')
        if (name && name.trim()) {
          const p = /\.canvas$/i.test(name.trim()) ? name.trim() : name.trim() + '.canvas'
          void vault.createNote(p, '{\n  "nodes": [],\n  "edges": []\n}\n')
        }
      },
    },
    {
      id: 'base',
      label: '新建 Base (.base)',
      icon: Table,
      run: () => {
        const name = window.prompt('新建 Base 视图 (相对路径)', '视图.base')
        if (name && name.trim()) {
          const p = /\.base$/i.test(name.trim()) ? name.trim() : name.trim() + '.base'
          void vault.createNote(p, STARTER_BASE)
        }
      },
    },
    { id: 'edit', label: '切换到编辑', icon: Pencil, run: () => ui.setCenterMode('edit') },
    { id: 'preview', label: '切换到预览', icon: Eye, run: () => ui.setCenterMode('preview') },
    { id: 'graph', label: '打开图谱', icon: Network, run: () => ui.setCenterMode('graph') },
    {
      id: 'search',
      label: '聚焦搜索',
      icon: Search,
      run: () => {
        if (!ui.showLeft) ui.toggleLeft()
        setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder^="搜索"]')?.focus(), 50)
      },
    },
    {
      id: 'import',
      label: '导入 Obsidian 库',
      icon: FolderInput,
      run: () => void vault.importVault().then((r) => r && toast.success(`已导入 ${r.notes} 篇笔记`)),
    },
    {
      id: 'setroot',
      label: '设置知识库目录',
      icon: FolderCog,
      run: () => void vault.setRootViaDialog().then((ok) => ok && toast.success('已切换知识库目录')),
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] animate-in fade-in duration-150"
      onClick={close}
    >
      <Command
        className="w-[min(560px,90vw)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in zoom-in-95 slide-in-from-top-2 duration-150"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <Command.Input
          autoFocus
          placeholder="输入命令…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[50vh] overflow-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">无匹配命令</Command.Empty>
          {cmds.map((c) => (
            <Command.Item
              key={c.id}
              value={c.label}
              onSelect={() => {
                c.run()
                close()
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"
            >
              <c.icon className="size-4 shrink-0 text-primary" />
              <span className="flex-1">{c.label}</span>
              {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
