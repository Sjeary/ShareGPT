import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Copy,
  CornerDownLeft,
  Link2,
  Loader2,
  Send,
  Settings2,
  Sparkles,
  Square,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { runAi } from '@/lib/notes/aiClient'
import type { NotesAiMode } from '@/types/api'

type ResultKind = 'text' | 'tags' | 'links'

const QUICK: { mode: NotesAiMode; label: string }[] = [
  { mode: 'summary', label: '总结' },
  { mode: 'continue', label: '续写' },
  { mode: 'expand', label: '扩写' },
  { mode: 'polish', label: '润色' },
  { mode: 'title', label: '起标题' },
  { mode: 'translate', label: '翻译' },
]

function SettingsForm({ onDone }: { onDone: () => void }) {
  const s = useNotesAiStore()
  const [baseUrl, setBaseUrl] = useState(s.baseUrl)
  const [apiKey, setApiKey] = useState(s.apiKey)
  const [model, setModel] = useState(s.model)
  const [effort, setEffort] = useState(s.effort)
  return (
    <div className="space-y-2.5 p-3 text-sm">
      <p className="text-xs text-muted-foreground">配置 AI 接口 (OpenAI Responses / Codex 中转)。密钥仅存本机。</p>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">接口地址</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">API Key</span>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60" />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">模型</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60" />
        </label>
        <label className="block w-24 space-y-1">
          <span className="text-xs text-muted-foreground">推理</span>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-1 text-sm outline-none focus:border-primary/60">
            {['low', 'medium', 'high', 'xhigh'].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={async () => {
          await useNotesAiStore.getState().save({ baseUrl, apiKey, model, effort })
          toast.success('已保存 AI 配置')
          onDone()
        }}
        className="h-8 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        保存
      </button>
    </div>
  )
}

export function AiAssistant() {
  const currentPath = useVaultStore((s) => s.currentPath)
  const note = useVaultStore((s) => (s.currentPath ? s.notesByPath[s.currentPath] : null))
  const configured = useNotesAiStore((s) => Boolean(s.apiKey && s.baseUrl))
  const [showSettings, setShowSettings] = useState(false)

  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [kind, setKind] = useState<ResultKind>('text')
  const [q, setQ] = useState('')
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void useNotesAiStore.getState().load().then(() => {
      if (!useNotesAiStore.getState().apiKey) setShowSettings(true)
    })
  }, [])
  useEffect(() => () => cancelRef.current?.(), [])

  const start = (
    mode: NotesAiMode,
    text: string,
    ctx: { titles?: string[]; context?: string } | undefined,
    rk: ResultKind,
    instructions?: string,
  ) => {
    if (!text.trim()) {
      toast.error('内容为空')
      return
    }
    setResult('')
    setErr('')
    setRunning(true)
    setKind(rk)
    cancelRef.current = runAi(
      { provider: useNotesAiStore.getState().provider(), mode, text, ctx, instructions },
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

  const appendToNote = async (text: string) => {
    if (!currentPath) return
    const raw = useVaultStore.getState().rawByPath[currentPath] || ''
    await api.vault.write(currentPath, raw.replace(/\s*$/, '') + '\n\n' + text + '\n')
    await useVaultStore.getState().reload()
    toast.success('已插入到文末')
  }

  const writeTags = async () => {
    if (!currentPath || !note) return
    const newTags = result.split(/[,，\n]/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
    const existing = Array.isArray(note.frontmatter.tags)
      ? (note.frontmatter.tags as unknown[]).map(String)
      : []
    const merged = [...new Set([...existing, ...newTags])]
    await useVaultStore.getState().setFrontmatter(currentPath, { ...note.frontmatter, tags: merged })
    toast.success(`已写入 ${newTags.length} 个标签`)
  }

  const suggestLinks = () => {
    if (!note) return
    const titles = Object.values(useVaultStore.getState().notesByPath)
      .filter((n) => n.path !== currentPath && !n.path.endsWith('.canvas') && !n.path.endsWith('.base'))
      .map((n) => n.title)
    start('linkSuggest', note.body, { titles }, 'links')
  }

  const askRag = () => {
    const store = useVaultStore.getState()
    const index = store.index
    if (!index || !q.trim()) return
    const all = Object.values(store.notesByPath).filter(
      (n) => !n.path.endsWith('.canvas') && !n.path.endsWith('.base'),
    )
    const hits = index.search(q).slice(0, 6)
    const titleList = all.map((n) => `- ${n.title}`).join('\n')
    const snippets = hits
      .map((h) => `### ${h.title}\n${(store.notesByPath[h.path]?.body || h.snippet).slice(0, 700)}`)
      .join('\n\n')
    const context = `【库内全部笔记标题，共 ${all.length} 篇】\n${titleList}\n\n【与问题最相关的片段】\n${snippets || '（无明显关键词匹配，可结合上面的标题进行概括）'}`
    start('ask', q, { context }, 'text', '你是用户个人知识库的问答助手，用中文清晰、有条理地作答，可概括与归纳。')
  }

  if (showSettings) return <SettingsForm onDone={() => setShowSettings(false)} />

  if (!currentPath || !note)
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
        <Sparkles className="size-5 opacity-50" />
        选择一篇笔记，用 AI 辅助写作 / 建议双链 / 问答
        {!configured && <button type="button" onClick={() => setShowSettings(true)} className="text-primary underline">先配置 AI</button>}
      </div>
    )

  const linkLines = kind === 'links' && !running ? result.split('\n').map((l) => l.trim()).filter(Boolean) : []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-primary" /> AI 助手
        </span>
        <button type="button" onClick={() => setShowSettings(true)} title="AI 设置" className="rounded p-1 text-muted-foreground hover:bg-accent">
          <Settings2 className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* 写作辅助 */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((a) => (
            <button
              key={a.mode}
              type="button"
              disabled={running}
              onClick={() => start(a.mode, note.body, undefined, 'text')}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
          <button type="button" disabled={running} onClick={() => start('tags', note.body, undefined, 'tags')} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <Tag className="size-3" /> 生成标签
          </button>
          <button type="button" disabled={running} onClick={suggestLinks} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">
            <Link2 className="size-3" /> 建议双链
          </button>
        </div>

        {/* RAG 问答 */}
        <div className="mt-3 flex gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && askRag()}
            placeholder="对整库提问 (RAG)…"
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60"
          />
          <button type="button" disabled={running} onClick={askRag} className="inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Send className="size-4" />
          </button>
        </div>

        {/* 结果 */}
        {(result || running || err) && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-2.5">
            {err ? (
              <p className="text-xs text-destructive">{err}</p>
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {result}
                {running && <Loader2 className="ml-1 inline size-3.5 animate-spin text-primary" />}
              </div>
            )}
            {!err && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                {running ? (
                  <Btn onClick={() => cancelRef.current?.()} icon={Square}>停止</Btn>
                ) : (
                  <>
                    {result && (
                      <Btn onClick={() => void navigator.clipboard.writeText(result)} icon={Copy}>复制</Btn>
                    )}
                    {result && kind === 'text' && (
                      <Btn onClick={() => void appendToNote(result)} icon={CornerDownLeft}>插入文末</Btn>
                    )}
                    {result && kind === 'tags' && (
                      <Btn onClick={() => void writeTags()} icon={Tag}>写入标签</Btn>
                    )}
                  </>
                )}
              </div>
            )}
            {linkLines.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                <p className="text-xs text-muted-foreground">建议双链 (点击追加到文末):</p>
                <div className="flex flex-wrap gap-1">
                  {linkLines.map((l, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void appendToNote(`[[${l}]]`)}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20"
                    >
                      [[{l}]]
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Btn({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof Copy; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs transition-colors hover:bg-accent">
      <Icon className="size-3" /> {children}
    </button>
  )
}
