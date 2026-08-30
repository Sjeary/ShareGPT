import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Clipboard,
  FileText,
  Languages,
  Loader2,
  MessageSquareText,
  Send,
  Settings2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { runAi } from '@/lib/notes/aiClient'
import { cn } from '@/lib/utils'
import { REMOTE_HTTP_WARNING, usesRemoteHttp } from '@/lib/remoteHttp'
import { useTranslationStore } from '@/store/useTranslationStore'
import type { AiKind } from '@/store/useAiStore'
import type { AiComposerTarget } from '@/types/api'
import type { TranslationProvider, TranslationSettings } from '@/types/settings'

const LANGUAGES = [
  ['auto', '自动检测'],
  ['zh', '中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['ru', 'Русский'],
] as const

const TARGET_LABELS = Object.fromEntries(LANGUAGES) as Record<string, string>
const PROVIDERS: Array<{ id: TranslationProvider; label: string }> = [
  { id: 'ai', label: 'AI' },
  { id: 'api', label: '翻译 API' },
  { id: 'offline', label: '本地离线' },
]

interface TranslationPanelProps {
  kind: AiKind
  tabId: string
  environmentId: string
}

function abortedError() {
  return Object.assign(new Error('操作已取消'), { name: 'AbortError' })
}

function userFacingComposerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  if (/网页或标签已经变化|当前网页标签已经变化|账号已切换|操作已取消/.test(raw)) return ''
  return raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

export function TranslationPanel({ kind, tabId, environmentId }: TranslationPanelProps) {
  const state = useTranslationStore()
  const load = state.load
  const cancelRef = useRef<null | (() => void)>(null)
  const operationGenerationRef = useRef(0)
  const [copied, setCopied] = useCopyIndicator()
  const [mode, setMode] = useState<'read' | 'compose'>('read')
  const [outgoingText, setOutgoingText] = useState('')
  const [outgoingResult, setOutgoingResult] = useState('')
  const [outgoingStatus, setOutgoingStatus] = useState('')
  const [outgoingLoading, setOutgoingLoading] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    operationGenerationRef.current += 1
    return () => {
      operationGenerationRef.current += 1
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [environmentId, kind, tabId])

  const patchConfig = (patch: Partial<TranslationSettings>) => {
    void state
      .saveConfig(patch)
      .catch((error) => state.setStatus(error instanceof Error ? error.message : String(error)))
  }

  const capturePage = async () => {
    state.setLoading(true)
    state.setStatus('正在读取当前网页…')
    try {
      const page = await api.captureAiPageText(kind, tabId, environmentId)
      state.setSourceText(page.text)
      state.setResult('')
      state.setStatus(page.truncated ? '内容较长，已读取前 30000 个字符' : '已读取当前网页')
    } catch (error) {
      state.setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      state.setLoading(false)
    }
  }

  const translateForSite = async (text: string, generation: number): Promise<string> => {
    const current = useTranslationStore.getState()
    const targetLanguage = current.config.siteLanguage || 'en'
    if (current.config.provider !== 'ai') {
      const provider = current.config.provider
      const config = provider === 'offline' ? current.config.offline : current.config.api
      const response = await api.translateText({
        mode: provider,
        baseUrl: config.baseUrl,
        apiKey: provider === 'api' ? current.config.api.apiKey : undefined,
        text,
        source: 'auto',
        target: targetLanguage,
      })
      if (operationGenerationRef.current !== generation) throw abortedError()
      return response.translatedText.trim()
    }

    const provider = current.config.ai
    if (!provider.baseUrl || !provider.apiKey) {
      current.setSettingsOpen(true)
      throw new Error('请先配置 AI 接口地址和密钥')
    }
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let accumulated = ''
      const finish = (callback: (value: string) => void, value: string) => {
        if (settled) return
        settled = true
        cancelRef.current = null
        callback(value)
      }
      const stop = runAi(
        {
          provider,
          mode: 'translate',
          text,
          ctx: { targetLanguage: TARGET_LABELS[targetLanguage] || targetLanguage },
        },
        {
          onDelta: (delta) => {
            accumulated += delta
            if (operationGenerationRef.current === generation) setOutgoingResult(accumulated)
          },
          onStatus: (message) => {
            if (operationGenerationRef.current === generation) setOutgoingStatus(message)
          },
          onDone: () => finish(resolve, accumulated.trim()),
          onError: (message) => finish((value) => reject(new Error(value)), message),
          onCancelled: () =>
            finish(
              (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
              '账号已切换',
            ),
        },
      )
      cancelRef.current = () => {
        stop()
        finish(
          (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
          '操作已取消',
        )
      }
    })
  }

  const writeComposer = async (target: AiComposerTarget, text: string, send: boolean) => {
    const response = await api.writeAiComposer({ target, text, send })
    if (send && !response.sent) throw new Error('网页没有接受本次发送，请重试')
  }

  const translateOutgoing = async (action: 'preview' | 'fill' | 'send') => {
    const text = outgoingText.trim()
    if (!text || outgoingLoading) {
      if (!text) setOutgoingStatus('请先输入要提问的内容')
      return
    }
    cancelRef.current?.()
    const generation = operationGenerationRef.current + 1
    operationGenerationRef.current = generation
    setOutgoingLoading(true)
    setOutgoingResult('')
    setOutgoingStatus(action === 'preview' ? '正在翻译…' : '正在翻译并准备网页输入框…')
    try {
      const target =
        action === 'preview' ? null : await api.getAiComposerTarget({ kind, tabId, environmentId })
      const translated = await translateForSite(text, generation)
      if (operationGenerationRef.current !== generation) throw abortedError()
      if (!translated) throw new Error('翻译服务没有返回内容')
      setOutgoingResult(translated)
      if (!target) {
        setOutgoingStatus('翻译完成')
      } else {
        await writeComposer(target, translated, action === 'send')
        if (operationGenerationRef.current !== generation) throw abortedError()
        setOutgoingStatus(action === 'send' ? '已翻译并发送' : '已填入网页输入框')
      }
    } catch (error) {
      if (operationGenerationRef.current === generation) {
        const message = userFacingComposerError(error)
        if (message) setOutgoingStatus(message)
      }
    } finally {
      if (operationGenerationRef.current === generation) setOutgoingLoading(false)
    }
  }

  const translate = async () => {
    const text = state.sourceText.trim()
    if (!text) {
      state.setStatus('请先输入、选中或读取要翻译的内容')
      return
    }
    cancelRef.current?.()
    state.setResult('')
    state.setLoading(true)
    state.setStatus('正在翻译…')

    if (state.config.provider === 'ai') {
      const provider = state.config.ai
      if (!provider.baseUrl || !provider.apiKey) {
        state.setLoading(false)
        state.setSettingsOpen(true)
        state.setStatus('请先配置 AI 接口地址和密钥')
        return
      }
      cancelRef.current = runAi(
        {
          provider,
          mode: 'translate',
          text,
          ctx: { targetLanguage: TARGET_LABELS[state.config.targetLanguage] || '中文' },
        },
        {
          onDelta: state.appendResult,
          onStatus: state.setStatus,
          onDone: () => {
            cancelRef.current = null
            state.setLoading(false)
            state.setStatus('翻译完成')
          },
          onError: (message) => {
            cancelRef.current = null
            state.setLoading(false)
            state.setStatus(message)
          },
          onCancelled: () => {
            cancelRef.current = null
            state.setResult('')
            state.setLoading(false)
            state.setStatus('')
          },
        },
      )
      return
    }

    try {
      const provider = state.config.provider
      const config = provider === 'offline' ? state.config.offline : state.config.api
      const response = await api.translateText({
        mode: provider,
        baseUrl: config.baseUrl,
        apiKey: provider === 'api' ? state.config.api.apiKey : undefined,
        text,
        source: state.config.sourceLanguage,
        target: state.config.targetLanguage,
      })
      state.setResult(response.translatedText)
      state.setStatus('翻译完成')
    } catch (error) {
      state.setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      state.setLoading(false)
    }
  }

  return (
    <aside className="flex h-full w-[360px] min-w-[300px] max-w-[42%] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Languages className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">翻译</h2>
        <span className="text-xs text-muted-foreground">
          {PROVIDERS.find((item) => item.id === state.config.provider)?.label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn('ml-auto size-8', state.settingsOpen && 'bg-accent')}
          title="翻译设置"
          aria-label="翻译设置"
          onClick={() => state.setSettingsOpen(!state.settingsOpen)}
        >
          <Settings2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="关闭翻译侧栏"
          aria-label="关闭翻译侧栏"
          onClick={state.close}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border p-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className={cn(
              'h-8 flex-1 rounded-md px-2 text-xs font-medium transition-colors',
              state.config.provider === provider.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => void state.setProvider(provider.id)}
          >
            {provider.label}
          </button>
        ))}
      </div>

      {state.settingsOpen && (
        <TranslationSettingsForm config={state.config} onChange={patchConfig} />
      )}

      <div className="grid shrink-0 grid-cols-2 border-b border-border p-2">
        <button
          type="button"
          className={cn(
            'h-8 rounded-l-md text-xs font-medium transition-colors',
            mode === 'read'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
          onClick={() => setMode('read')}
        >
          阅读翻译
        </button>
        <button
          type="button"
          className={cn(
            'h-8 rounded-r-md text-xs font-medium transition-colors',
            mode === 'compose'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
          onClick={() => setMode('compose')}
        >
          中文提问
        </button>
      </div>

      {mode === 'read' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <LanguageSelect
              value={state.config.sourceLanguage}
              includeAuto
              label="源语言"
              onChange={(sourceLanguage) => patchConfig({ sourceLanguage })}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <LanguageSelect
              value={state.config.targetLanguage}
              label="目标语言"
              onChange={(targetLanguage) => patchConfig({ targetLanguage })}
            />
          </div>

          <textarea
            value={state.sourceText}
            onChange={(event) => state.setSourceText(event.target.value)}
            placeholder="输入文字，或在网页中选中文字后右键翻译"
            aria-label="待翻译内容"
            spellCheck={false}
            className="min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={state.loading}
              onClick={() => void capturePage()}
            >
              <FileText className="size-3.5" />
              读取整页
            </Button>
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              disabled={state.loading}
              onClick={() => void translate()}
            >
              {state.loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Languages className="size-3.5" />
              )}
              翻译
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-2">
            <div className="mb-1 flex h-8 items-center">
              <span className="text-xs font-medium text-muted-foreground">译文</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                title="复制译文"
                aria-label="复制译文"
                disabled={!state.result}
                onClick={() => {
                  void navigator.clipboard.writeText(state.result).then(() => setCopied())
                }}
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Clipboard className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 p-3 text-sm leading-6">
              {state.result || <span className="text-muted-foreground">译文将在这里显示</span>}
            </div>
            <div className="min-h-6 pt-1.5 text-xs text-muted-foreground" role="status">
              {state.status}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">网页接收语言</span>
            <LanguageSelect
              value={state.config.siteLanguage}
              label="网页接收语言"
              onChange={(siteLanguage) => patchConfig({ siteLanguage })}
            />
          </div>
          <textarea
            value={outgoingText}
            onChange={(event) => setOutgoingText(event.target.value)}
            disabled={outgoingLoading}
            placeholder="在这里用中文提问，网页只会收到翻译后的内容"
            aria-label="中文提问内容"
            className="min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={outgoingLoading || !outgoingText.trim()}
              onClick={() => void translateOutgoing('preview')}
            >
              <Languages className="mr-1.5 size-3.5" />
              预览
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={outgoingLoading || !outgoingText.trim()}
              onClick={() => void translateOutgoing('fill')}
            >
              <MessageSquareText className="mr-1.5 size-3.5" />
              翻译并填入
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              disabled={outgoingLoading || !outgoingText.trim()}
              onClick={() => void translateOutgoing('send')}
            >
              {outgoingLoading ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-3.5" />
              )}
              翻译并发送
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-2">
            <span className="mb-2 text-xs font-medium text-muted-foreground">网页将收到</span>
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 p-3 text-sm leading-6">
              {outgoingResult || (
                <span className="text-muted-foreground">翻译后的提问会显示在这里</span>
              )}
            </div>
            <div className="min-h-6 pt-1.5 text-xs text-muted-foreground" role="status">
              {outgoingStatus}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function TranslationSettingsForm({
  config,
  onChange,
}: {
  config: TranslationSettings
  onChange: (patch: Partial<TranslationSettings>) => void
}) {
  const inputClass = 'h-8 text-xs'
  return (
    <div className="shrink-0 space-y-2 border-b border-border bg-muted/20 p-3">
      {config.provider === 'ai' && (
        <>
          <Input
            className={inputClass}
            value={config.ai.baseUrl}
            aria-label="AI 接口地址"
            placeholder="AI 接口地址"
            onChange={(event) => onChange({ ai: { ...config.ai, baseUrl: event.target.value } })}
          />
          {usesRemoteHttp(config.ai.baseUrl) && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
              {REMOTE_HTTP_WARNING}
            </p>
          )}
          <Input
            className={inputClass}
            type="password"
            value={config.ai.apiKey}
            aria-label="AI 接口密钥"
            placeholder="AI 接口密钥"
            onChange={(event) => onChange({ ai: { ...config.ai, apiKey: event.target.value } })}
          />
          <div className="flex gap-2">
            <Input
              className={inputClass}
              value={config.ai.model}
              aria-label="AI 模型"
              placeholder="模型"
              onChange={(event) => onChange({ ai: { ...config.ai, model: event.target.value } })}
            />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="推理强度"
              value={config.ai.effort}
              onChange={(event) => onChange({ ai: { ...config.ai, effort: event.target.value } })}
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
        </>
      )}
      {config.provider === 'api' && (
        <>
          <Input
            className={inputClass}
            value={config.api.baseUrl}
            aria-label="翻译 API 地址"
            placeholder="LibreTranslate 兼容接口地址"
            onChange={(event) => onChange({ api: { ...config.api, baseUrl: event.target.value } })}
          />
          {usesRemoteHttp(config.api.baseUrl) && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
              {REMOTE_HTTP_WARNING}
            </p>
          )}
          <Input
            className={inputClass}
            type="password"
            value={config.api.apiKey}
            aria-label="翻译 API 密钥"
            placeholder="API 密钥（可选）"
            onChange={(event) => onChange({ api: { ...config.api, apiKey: event.target.value } })}
          />
        </>
      )}
      {config.provider === 'offline' && (
        <>
          <Input
            className={inputClass}
            value={config.offline.baseUrl}
            aria-label="本地翻译服务地址"
            placeholder="http://127.0.0.1:5000"
            onChange={(event) => onChange({ offline: { baseUrl: event.target.value } })}
          />
          <p className="text-[11px] text-muted-foreground">
            仅允许本机回环地址，文本不会发送到远程服务。
          </p>
        </>
      )}
      <label className="flex items-start gap-2 border-t border-border pt-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={config.confirmNonTargetSend}
          onChange={(event) => onChange({ confirmNonTargetSend: event.target.checked })}
        />
        <span>
          <span className="block font-medium text-foreground">发送前确认</span>
          <span className="text-muted-foreground">
            启用后，发送与网页接收语言明显不符的内容时先询问。
          </span>
        </span>
      </label>
    </div>
  )
}

function LanguageSelect({
  value,
  label,
  includeAuto = false,
  onChange,
}: {
  value: string
  label: string
  includeAuto?: boolean
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      aria-label={label}
      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
      onChange={(event) => onChange(event.target.value)}
    >
      {LANGUAGES.filter(([id]) => includeAuto || id !== 'auto').map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  )
}

function useCopyIndicator(): [boolean, () => void] {
  const [copied, setCopiedState] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    },
    [],
  )
  const setCopied = () => {
    setCopiedState(true)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      setCopiedState(false)
      timeoutRef.current = null
    }, 1200)
  }
  return [copied, setCopied]
}
