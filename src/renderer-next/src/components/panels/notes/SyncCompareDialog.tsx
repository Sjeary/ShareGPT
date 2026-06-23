import { ArrowDownToLine, GitMerge, AlertTriangle, Trash2, X } from 'lucide-react'
import { useNotesSyncStore } from '@/hooks/useNotesSync'
import { useVaultStore } from '@/store/useVaultStore'

function Section({
  icon: Icon,
  title,
  paths,
  tone,
  onOpen,
}: {
  icon: typeof ArrowDownToLine
  title: string
  paths: string[]
  tone: string
  onOpen: (p: string) => void
}) {
  if (paths.length === 0) return null
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-1.5 text-sm font-medium ${tone}`}>
        <Icon className="size-4" /> {title} ({paths.length})
      </div>
      <div className="space-y-0.5 pl-5">
        {paths.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onOpen(p)}
            className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// 同步对比报告: 拉取合并后, 展示本地与云端的差异处理结果 (从云端更新 / 自动合并 / 冲突保留双方 / 删除)。
export function SyncCompareDialog() {
  const open = useNotesSyncStore((s) => s.compareOpen)
  const report = useNotesSyncStore((s) => s.lastReport)
  const close = () => useNotesSyncStore.getState().setCompareOpen(false)
  const openNote = useVaultStore((s) => s.openNote)
  const onOpen = (p: string) => {
    void openNote(p)
    close()
  }

  if (!open || !report) return null

  const nothing =
    report.fromCloud.length === 0 &&
    report.autoMerged.length === 0 &&
    report.conflicts.length === 0 &&
    report.deleted.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onClick={close}
    >
      <div
        className="w-[min(520px,92vw)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">云端同步对比</h3>
          <button type="button" onClick={close} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-auto p-4">
          {nothing && <p className="text-sm text-muted-foreground">已是最新，无差异。</p>}
          <Section icon={ArrowDownToLine} title="从云端更新" paths={report.fromCloud} tone="text-blue-500" onOpen={onOpen} />
          <Section icon={GitMerge} title="自动合并" paths={report.autoMerged} tone="text-emerald-500" onOpen={onOpen} />
          <Section
            icon={AlertTriangle}
            title="冲突 (本地保留，云端已存为副本)"
            paths={report.conflicts.flatMap((c) => [c.path, c.copyPath])}
            tone="text-amber-500"
            onOpen={onOpen}
          />
          <Section icon={Trash2} title="已删除" paths={report.deleted} tone="text-rose-500" onOpen={onOpen} />
        </div>
      </div>
    </div>
  )
}
