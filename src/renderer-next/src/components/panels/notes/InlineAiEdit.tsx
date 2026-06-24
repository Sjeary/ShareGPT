import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWords } from 'diff'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useEditorBridge } from '@/store/useEditorBridge'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { runAi } from '@/lib/notes/aiClient'

// 选中文本后的浮动「问 AI」按钮 (Cursor/Notion 式入口)。
export function SelectionAiButton() {
  const selection = useEditorBridge((s) => s.selection)
  const view = useEditorBridge((s) => s.view)
  const aiOpen = useEditorBridge((s) => Boolean(s.aiEdit?.open))
  const openAiEdit = useEditorBridge((s) => s.openAiEdit)

  const pos = useMemo(() => {
    if (aiOpen || !view || selection.text.trim().length === 0) return null
    try {
      const c = view.coordsAtPos(selection.to)
      return c ? { x: c.left, y: c.bottom + 4 } : null
    } catch {
      return null
    }
  }, [selection, view, aiOpen])

  if (!pos) return null
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        openAiEdit()
      }}
      style={{ left: Math.min(pos.x, window.innerWidth - 96), top: pos.y }}
      className="fixed z-[64] inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-lg animate-in fade-in zoom-in-95 duration-100"
    >
      <Sparkles className="size-3" /> 问 AI ⌘K
    </button>
  )
}

function DiffView({ a, b }: { a: string; b: string }) {
  const parts = diffWords(a, b)
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) =>
        p.added ? (
          <span
            key={i}
            className="rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
          >
            {p.value}
          </span>
        ) : p.removed ? (
          <span
            key={i}
            className="rounded bg-rose-500/15 text-rose-600 line-through dark:text-rose-400"
          >
            {p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  )
}

// 内联 AI 编辑面板: 对选中文本(或光标处)下指令 → 流式生成 → diff 预览 → 保留/放弃/重试。
export function InlineAiEdit() {
  const aiEdit = useEditorBridge((s) => s.aiEdit)
  const close = useEditorBridge((s) => s.closeAiEdit)
  const replaceRange = useEditorBridge((s) => s.replaceRange)
  const configured = useNotesAiStore((s) => Boolean(s.apiKey && s.baseUrl))
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const cancelRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const open = Boolean(aiEdit?.open)
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setInstruction('')
    setResult('')
    setErr('')
    setRunning(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => () => cancelRef.current?.(), [])

  if (!aiEdit?.open) return null
  const hasSel = aiEdit.original.trim().length > 0

  const run = () => {
    if (!configured) {
      setErr('请先在右栏「AI」里配置接口与密钥')
      return
    }
    if (!instruction.trim() || running) return
    setResult('')
    setErr('')
    setRunning(true)
    cancelRef.current = runAi(
      {
        provider: useNotesAiStore.getState().provider(),
        mode: hasSel ? 'edit' : 'generate',
        text: aiEdit.original,
        ctx: { instruction: instruction.trim() },
      },
      {
        onDelta: (t) => setResult((p) => p + t),
        onDone: () => setRunning(false),
        onError: (m) => {
          setErr(m)
          setRunning(false)
        },
      },
    )
  }
  const keep = () => {
    replaceRange(aiEdit.from, aiEdit.to, result)
    close()
    toast.success('已应用 · Ctrl/⌘ Z 可撤回')
  }

  const style = {
    left: Math.max(12, Math.min(aiEdit.anchor.x, window.innerWidth - 460)),
    top: Math.min(aiEdit.anchor.y, window.innerHeight - 220),
  }

  return (
    <div className="fixed inset-0 z-[65]" onMouseDown={close}>
      <div
        className="fixed w-[440px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium">
          <Sparkles className="size-3.5 text-primary" />
          {hasSel ? `对选中的 ${aiEdit.original.length} 字` : '在光标处生成'} · AI 编辑
          <button type="button" className="ml-auto rounded p-0.5 hover:bg-accent" onClick={close}>
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex gap-1.5 p-2">
          <input
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run()
              else if (e.key === 'Escape') close()
            }}
            placeholder={hasSel ? '如何修改这段…（改写/翻译/精简/扩写/列点…）' : '让 AI 写点什么…'}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60"
          />
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        {(result || running || err) && (
          <div className="max-h-[40vh] overflow-auto border-t border-border p-2.5 text-sm">
            {err ? (
              <p className="text-xs text-destructive">{err}</p>
            ) : hasSel && !running && result ? (
              <DiffView a={aiEdit.original} b={result} />
            ) : (
              <div className="whitespace-pre-wrap leading-relaxed">
                {result}
                {running && <Loader2 className="ml-1 inline size-3 animate-spin text-primary" />}
              </div>
            )}
            {!err && !running && result && (
              <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={keep}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {hasSel ? '保留' : '插入'}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  放弃
                </button>
                <button
                  type="button"
                  onClick={run}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  重试
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
