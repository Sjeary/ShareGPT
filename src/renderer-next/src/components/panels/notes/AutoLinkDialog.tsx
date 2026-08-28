import { useEffect, useRef, useState } from 'react'
import { Loader2, Link2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { useAppStore } from '@/store/useAppStore'
import { runAi } from '@/lib/notes/aiClient'

interface Pair {
  aPath: string
  bPath: string
  aTitle: string
  bTitle: string
  reason: string
  checked: boolean
}

const MAX_NOTES = 60

// 全库 AI 自动连线: 给 AI 全库标题+摘要 → 返回相关笔记对 → 批量评审 → 写入双链。
export function AutoLinkDialog() {
  const open = useNotesUi((s) => s.autoLinkOpen)
  const setOpen = useNotesUi((s) => s.setAutoLinkOpen)
  const configured = useAppStore((s) =>
    Boolean(s.settings?.translation?.ai?.apiKey && s.settings?.translation?.ai?.baseUrl),
  )
  const principalGeneration = useNotesAiStore((s) => s.principalGeneration)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const close = () => {
    cancelRef.current?.()
    setOpen(false)
  }

  // 打开即跑
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setErr('')
    setStatus('')
    setPairs(null)
    if (!configured) {
      setErr('请先在右栏「AI」配置接口与密钥')
      return
    }
    const store = useVaultStore.getState()
    const notes = Object.values(store.notesByPath)
      .filter((n) => !n.path.endsWith('.canvas') && !n.path.endsWith('.base'))
      .slice(0, MAX_NOTES)
    if (notes.length < 2) {
      setErr('笔记太少，先多写几篇再试')
      return
    }
    const titleToPath = new Map<string, string>()
    for (const n of notes) if (!titleToPath.has(n.title)) titleToPath.set(n.title, n.path)
    const list = notes
      .map((n) => `${n.title} —— ${n.body.replace(/\s+/g, ' ').slice(0, 140)}`)
      .join('\n')

    setRunning(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    let acc = ''
    // 全库连线是「批量分类」任务, 用低推理强度即可: 更快、更省、显著降低上游过载概率。
    const baseProvider = useNotesAiStore.getState().provider()
    cancelRef.current = runAi(
      { provider: { ...baseProvider, effort: 'low' }, mode: 'autolink', text: list },
      {
        onDelta: (t) => {
          acc += t
          setStatus('')
        },
        onStatus: (m) => setStatus(m),
        onError: (m) => {
          setErr(m)
          setRunning(false)
        },
        onDone: () => {
          setRunning(false)
          const out: Pair[] = []
          const seen = new Set<string>()
          for (const line of acc.split('\n')) {
            const parts = line.split('||').map((x) => x.trim())
            if (parts.length < 2) continue
            const [aTitle, bTitle, reason = ''] = parts
            const aPath = titleToPath.get(aTitle)
            const bPath = titleToPath.get(bTitle)
            if (!aPath || !bPath || aPath === bPath) continue
            const key = [aPath, bPath].sort().join('\\0')
            if (seen.has(key)) continue
            // 跳过已有的双链
            const already = (store.index?.outlinks(aPath) ?? []).some((l) => l.targetPath === bPath)
            if (already) continue
            seen.add(key)
            out.push({ aPath, bPath, aTitle, bTitle, reason, checked: true })
          }
          setPairs(out)
        },
      },
    )
    return () => cancelRef.current?.()
  }, [open, configured, principalGeneration])

  const apply = async () => {
    if (!pairs) return
    const selected = pairs.filter((p) => p.checked)
    if (selected.length === 0) {
      close()
      return
    }
    // 按源笔记分组, 追加「相关」区块
    const bySource = new Map<string, { title: string; targets: string[] }>()
    for (const p of selected) {
      const g = bySource.get(p.aPath) ?? { title: p.aTitle, targets: [] }
      g.targets.push(p.bTitle)
      bySource.set(p.aPath, g)
    }
    const items = [...bySource.entries()].map(([path, g]) => ({
      path,
      text: `## 相关\n${g.targets.map((t) => `- [[${t}]]`).join('\n')}`,
    }))
    await useVaultStore.getState().batchAppend(items)
    toast.success(`已建立 ${selected.length} 条双链`)
    setOpen(false)
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="z-[61] flex max-h-[80vh] w-[min(560px,92vw)] flex-col gap-0 overflow-hidden p-0"
        overlayClassName="z-[60]"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-sm">
            <Sparkles className="size-4 text-primary" /> AI 自动连线
          </DialogTitle>
        </DialogHeader>

        <div className="no-scrollbar min-h-0 flex-1 overflow-auto p-3">
          {err ? (
            <p className="py-6 text-center text-sm text-destructive">{err}</p>
          ) : running ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              {status || '正在分析全库、寻找相关笔记…'}
            </div>
          ) : !pairs ? null : pairs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              没有发现可新增的相关连接
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="px-1 text-xs text-muted-foreground">勾选要建立的双链（默认全选）：</p>
              {pairs.map((p, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 hover:bg-accent/40"
                >
                  <input
                    type="checkbox"
                    checked={p.checked}
                    onChange={(e) =>
                      setPairs((ps) =>
                        ps!.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)),
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      <span className="truncate">{p.aTitle}</span>
                      <Link2 className="size-3 shrink-0 text-primary" />
                      <span className="truncate text-primary">{p.bTitle}</span>
                    </span>
                    {p.reason && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{p.reason}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {pairs && pairs.length > 0 && !running && (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={() => void apply()}>
              建立选中的双链
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
