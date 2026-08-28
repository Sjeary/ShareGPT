import { Command } from 'cmdk'
import { FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'

// 快速切换笔记 (Ctrl/Cmd+O): cmdk 模糊搜索全部笔记标题/路径, 回车打开。
export function QuickSwitcher() {
  const open = useNotesUi((s) => s.quickOpen)
  const setOpen = useNotesUi((s) => s.setQuickOpen)
  const notesByPath = useVaultStore((s) => s.notesByPath)
  const openNote = useVaultStore((s) => s.openNote)

  if (!open) return null
  const notes = Object.values(notesByPath)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[12vh] w-[min(560px,90vw)] translate-y-0 gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">快速切换笔记</DialogTitle>
        <Command className="overflow-hidden bg-popover" loop>
          <Command.Input
            autoFocus
            placeholder="跳转到笔记…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="no-scrollbar max-h-[50vh] overflow-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              没有匹配的笔记
            </Command.Empty>
            {notes.map((n) => (
              <Command.Item
                key={n.path}
                value={`${n.title} ${n.path}`}
                onSelect={() => {
                  void openNote(n.path)
                  setOpen(false)
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-accent"
              >
                <FileText className="size-4 shrink-0 text-primary" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{n.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{n.path}</span>
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
