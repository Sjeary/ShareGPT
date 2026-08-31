import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleCheck,
  Clipboard,
  FileText,
  Languages,
  Loader2,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Send,
  Settings2,
  TextCursorInput,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { runAi } from '@/lib/notes/aiClient'
import { REMOTE_HTTP_WARNING, usesRemoteHttp } from '@/lib/remoteHttp'
import { cn } from '@/lib/utils'
import { useTranslationStore } from '@/store/useTranslationStore'
import type { AiKind } from '@/store/useAiStore'
import type { AiComposerTarget } from '@/types/api'
import type { TranslationProvider, TranslationSettings, TranslationStyle } from '@/types/settings'

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
const STYLE_OPTIONS: Array<{ id: TranslationStyle; label: string }> = [
  { id: 'natural', label: '自然' },
  { id: 'literal', label: '直译' },
  { id: 'concise', label: '简洁' },
]
const AI_LABELS: Record<AiKind, string> = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }

interface TranslationPanelProps {
  kind: AiKind
  tabId: string
  environmentId: string
}

interface TranslationRun {
  promise: Promise<string>
  cancel: () => void
}

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  if (/网页或标签已经变化|当前网页标签已经变化|账号已切换|操作已取消/.test(raw)) {
    return ''
  }
  return raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

function startTranslation(
  config: TranslationSettings,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  callbacks: { onDelta?: (text: string) => void; onStatus?: (status: string) => void } = {},
): TranslationRun {
  if (config.provider !== 'ai') {
    let cancelled = false
    const provider = config.provider
    const providerConfig = provider === 'offline' ? config.offline : config.api
    const promise = api
      .translateText({
        mode: provider,
        baseUrl: providerConfig.baseUrl,
        apiKey: provider === 'api' ? config.api.apiKey : undefined,
        text,
        source: sourceLanguage,
        target: targetLanguage,
      })
      .then((response) => {
        if (cancelled) throw Object.assign(new Error('操作已取消'), { name: 'AbortError' })
        return response.translatedText.trim()
      })
    return { promise, cancel: () => void (cancelled = true) }
  }

  if (!config.ai.baseUrl || !config.ai.apiKey) {
    return {
      promise: Promise.reject(new Error('请先配置 AI 接口地址和密钥')),
      cancel: () => undefined,
    }
  }

  let cancel: () => void = () => undefined
  const promise = new Promise<string>((resolve, reject) => {
    let settled = false
    let accumulated = ''
    const finish = (callback: (value: string) => void, value: string) => {
      if (settled) return
      settled = true
      callback(value)
    }
    const stop = runAi(
      {
        provider: config.ai,
        mode: 'translate',
        text,
        ctx: {
          targetLanguage: TARGET_LABELS[targetLanguage] || targetLanguage,
          translationStyle: config.style,
          glossary: config.glossary,
        },
      },
      {
        onDelta: (delta) => {
          accumulated += delta
          callbacks.onDelta?.(delta)
        },
        onStatus: (status) => callbacks.onStatus?.(status),
        onDone: () => finish(resolve, accumulated.trim()),
        onError: (message) => finish((value) => reject(new Error(value)), message),
        onCancelled: () =>
          finish(
            (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
            '账号已切换',
          ),
      },
    )
    cancel = () => {
      stop()
      finish(
        (value) => reject(Object.assign(new Error(value), { name: 'AbortError' })),
        '操作已取消',
      )
    }
  })
  return { promise, cancel: () => cancel() }
}

export function TranslationPanel({ kind, tabId, environmentId }: TranslationPanelProps) {
  const state = useTranslationStore()
  const load = state.load
  const cancelRef = useRef<null | (() => void)>(null)
  const operationGenerationRef = useRef(0)
  const lastAutoTranslateRef = useRef(0)
  const [copied, setCopied] = useCopyIndicator()
  const [pendingWrite, setPendingWrite] = useState<null | { send: boolean }>(null)
  const [testStatus, setTestStatus] = useState('')
  const [testing, setTesting] = useState(false)

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
    if (
      Object.keys(patch).some(
        (key) => !['confirmNonTargetSend', 'autoTranslateSelection'].includes(key),
      )
    ) {
      state.markStale()
    }
    void state.saveConfig(patch).catch((error) => state.setStatus(cleanError(error)))
  }

  const targetLanguage =
    state.sourceKind === 'manual'
      ? state.config.siteLanguage || 'en'
      : state.config.targetLanguage || 'zh'

  const translate = useCallback(async () => {
    const current = useTranslationStore.getState()
    const text = current.sourceText.trim()
    if (!text) {
      current.setStatus('请先输入、选中或读取要翻译的内容')
      return
    }
    cancelRef.current?.()
    const generation = operationGenerationRef.current + 1
    operationGenerationRef.current = generation
    current.beginTranslation()
    setPendingWrite(null)
    const currentTargetLanguage =
      current.sourceKind === 'manual'
        ? current.config.siteLanguage || 'en'
        : current.config.targetLanguage || 'zh'
    const run = startTranslation(
      current.config,
      text,
      current.config.sourceLanguage,
      currentTargetLanguage,
      {
        onDelta: current.config.provider === 'ai' ? current.appendResult : undefined,
        onStatus: current.setStatus,
      },
    )
    cancelRef.current = run.cancel
    try {
      const translated = await run.promise
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      if (!translated) throw new Error('翻译服务没有返回内容')
      if (current.config.provider !== 'ai') current.setResult(translated)
      current.completeTranslation()
    } catch (error) {
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      const message = cleanError(error)
      useTranslationStore.setState({
        loading: false,
        phase: message ? 'error' : 'idle',
        status: message,
      })
      if (/配置 AI/.test(message)) current.setSettingsOpen(true)
    }
  }, [])

  useEffect(() => {
    if (
      !state.config.autoTranslateSelection ||
      state.autoTranslateRequest <= lastAutoTranslateRef.current
    ) {
      return
    }
    lastAutoTranslateRef.current = state.autoTranslateRequest
    void translate()
  }, [state.autoTranslateRequest, state.config.autoTranslateSelection, translate])

  const captureSelection = async () => {
    state.setLoading(true)
    state.setStatus('正在读取网页选区…')
    try {
      const selection = await api.captureAiSelectionText(kind, tabId, environmentId)
      state.setCapturedSource('selection', selection.text, {
        status: selection.truncated ? '选区较长，已读取前 30000 个字符' : '已读取网页选中文字',
      })
    } catch (error) {
      state.setStatus(cleanError(error))
    } finally {
      state.setLoading(false)
    }
  }

  const capturePage = async () => {
    state.setLoading(true)
    state.setStatus('正在读取当前网页…')
    try {
      const page = await api.captureAiPageText(kind, tabId, environmentId)
      state.setCapturedSource('page', page.text, {
        status: page.truncated ? '内容较长，已读取前 30000 个字符' : '已读取当前网页',
      })
    } catch (error) {
      state.setStatus(cleanError(error))
    } finally {
      state.setLoading(false)
    }
  }

  const writeToComposer = async (
    send: boolean,
    strategy: 'fail-if-not-empty' | 'append' | 'replace' = 'fail-if-not-empty',
  ) => {
    const current = useTranslationStore.getState()
    const text = current.result.trim()
    if (!text || current.phase !== 'ready') return
    useTranslationStore.setState({ phase: 'writing', status: '正在校验当前网页输入框…' })
    try {
      const target: AiComposerTarget = await api.getAiComposerTarget({ kind, tabId, environmentId })
      const response = await api.writeAiComposer({ target, text, send, strategy })
      if (response.conflict === 'existing-draft') {
        setPendingWrite({ send })
        useTranslationStore.setState({
          phase: 'ready',
          status: `${AI_LABELS[kind]} 输入框中已有草稿`,
        })
        return
      }
      setPendingWrite(null)
      useTranslationStore.setState({
        phase: 'ready',
        status: send ? `已发送到 ${AI_LABELS[kind]}` : `已填入 ${AI_LABELS[kind]}，未自动发送`,
      })
    } catch (error) {
      useTranslationStore.setState({ phase: 'ready', status: cleanError(error) })
    }
  }

  const testConnection = async () => {
    if (testing) return
    setTesting(true)
    setTestStatus('正在测试…')
    const run = startTranslation(state.config, 'Hello', 'en', 'zh')
    try {
      const result = await run.promise
      setTestStatus(result ? '连接正常' : '服务未返回译文')
    } catch (error) {
      setTestStatus(cleanError(error) || '测试已取消')
    } finally {
      setTesting(false)
    }
  }

  const canUseResult = state.phase === 'ready' && Boolean(state.result.trim())
  const providerReady =
    state.config.provider === 'ai'
      ? Boolean(state.config.ai.baseUrl && state.config.ai.apiKey)
      : state.config.provider === 'api'
        ? Boolean(state.config.api.baseUrl)
        : Boolean(state.config.offline.baseUrl)
  const providerStatus = testStatus === '连接正常' ? '已连接' : providerReady ? '已配置' : '未配置'
  const sourceNote =
    state.sourceKind === 'selection'
      ? '来自网页选中文字'
      : state.sourceKind === 'page'
        ? '来自当前网页'
        : '手工输入'

  return (
    <aside
      className="flex h-full w-[400px] min-w-[340px] max-w-[46%] shrink-0 flex-col border-l border-border bg-background"
      aria-label="翻译工作台"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Languages className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">翻译</h2>
        <span className="text-xs text-muted-foreground">
          {PROVIDERS.find((item) => item.id === state.config.provider)?.label} · {providerStatus}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn('ml-auto size-8', state.settingsOpen && 'bg-accent')}
          title="翻译设置"
          aria-label="翻译设置"
          aria-expanded={state.settingsOpen}
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

      {state.settingsOpen && (
        <TranslationSettingsForm
          config={state.config}
          testing={testing}
          testStatus={testStatus}
          onChange={patchConfig}
          onTest={() => void testConnection()}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center gap-2">
          <LanguageSelect
            value={state.config.sourceLanguage}
            includeAuto
            label="源语言"
            onChange={(sourceLanguage) => patchConfig({ sourceLanguage })}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <LanguageSelect
            value={targetLanguage}
            label="目标语言"
            onChange={(value) =>
              patchConfig(
                state.sourceKind === 'manual' ? { siteLanguage: value } : { targetLanguage: value },
              )
            }
          />
        </div>

        <section className="space-y-1.5">
          <div className="flex min-h-8 items-center gap-2">
            <span className="text-xs font-medium">原文</span>
            <span className="text-[11px] text-muted-foreground">{sourceNote}</span>
            <div className="ml-auto flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2"
                disabled={state.loading}
                onClick={() => void captureSelection()}
              >
                <TextCursorInput className="size-3.5" />
                选中文字
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2"
                disabled={state.loading}
                onClick={() => void capturePage()}
              >
                <FileText className="size-3.5" />
                读取页面
              </Button>
            </div>
          </div>
          <textarea
            value={state.sourceText}
            onChange={(event) => state.setSourceText(event.target.value)}
            placeholder="输入要翻译的内容"
            aria-label="待翻译原文"
            spellCheck={false}
            className={cn(
              'min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
              state.phase === 'stale' && 'border-amber-500',
            )}
          />
        </section>

        <Button
          className="w-full gap-2"
          disabled={state.phase === 'translating' || !state.sourceText.trim()}
          onClick={() => void translate()}
        >
          {state.phase === 'translating' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Languages className="size-4" />
          )}
          翻译
        </Button>

        <section className="flex min-h-44 flex-1 flex-col space-y-1.5">
          <div className="flex min-h-8 items-center gap-2">
            <span className="text-xs font-medium">译文</span>
            <span className="text-[11px] text-muted-foreground">
              {state.resultEdited ? '已修改' : '可在填入前修改'}
            </span>
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="复制译文"
                aria-label="复制译文"
                disabled={!state.result}
                onClick={() =>
                  void navigator.clipboard.writeText(state.result).then(() => setCopied())
                }
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Clipboard className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="重新翻译"
                aria-label="重新翻译"
                disabled={state.phase === 'translating' || !state.sourceText.trim()}
                onClick={() => void translate()}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
          <textarea
            value={state.result}
            onChange={(event) => state.editResult(event.target.value)}
            disabled={state.phase === 'translating'}
            placeholder="译文将在这里显示"
            aria-label="译文"
            spellCheck={false}
            className={cn(
              'min-h-36 flex-1 resize-y rounded-md border border-input bg-muted/20 px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring',
              state.phase === 'stale' && 'border-amber-500',
            )}
          />
        </section>

        {pendingWrite && (
          <div
            className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
            role="alert"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="size-4 text-amber-600" />
              {AI_LABELS[kind]} 输入框中已有草稿
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingWrite(null)}>
                取消
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void writeToComposer(pendingWrite.send, 'append')}
              >
                追加
              </Button>
              <Button size="sm" onClick={() => void writeToComposer(pendingWrite.send, 'replace')}>
                替换
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            disabled={!canUseResult}
            className="gap-2"
            onClick={() => void writeToComposer(false)}
          >
            {state.phase === 'writing' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquareText className="size-4" />
            )}
            填入 {AI_LABELS[kind]}
          </Button>
          <Button
            variant="outline"
            disabled={!canUseResult}
            className="gap-2"
            onClick={() => void writeToComposer(true)}
          >
            <Send className="size-4" />
            发送
          </Button>
        </div>

        <div
          className={cn(
            'flex min-h-6 items-start gap-1.5 text-xs text-muted-foreground',
            state.phase === 'ready' && 'text-emerald-600 dark:text-emerald-400',
            (state.phase === 'stale' || state.phase === 'error') &&
              'text-amber-600 dark:text-amber-400',
          )}
          role="status"
        >
          {state.phase === 'ready' ? <CircleCheck className="mt-0.5 size-3.5 shrink-0" /> : null}
          <span>{state.status}</span>
        </div>
      </div>
    </aside>
  )
}

function TranslationSettingsForm({
  config,
  testing,
  testStatus,
  onChange,
  onTest,
}: {
  config: TranslationSettings
  testing: boolean
  testStatus: string
  onChange: (patch: Partial<TranslationSettings>) => void
  onTest: () => void
}) {
  const inputClass = 'h-8 text-xs'
  return (
    <div className="max-h-[48%] shrink-0 space-y-2 overflow-y-auto border-b border-border bg-muted/20 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[11px] text-muted-foreground">
          <span>翻译服务</span>
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            aria-label="翻译服务"
            value={config.provider}
            onChange={(event) => onChange({ provider: event.target.value as TranslationProvider })}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        {config.provider === 'ai' && (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <span>翻译风格</span>
            <div
              className="grid h-8 grid-cols-3 rounded-md border border-input bg-background p-0.5"
              role="group"
              aria-label="翻译风格"
            >
              {STYLE_OPTIONS.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={config.style === style.id}
                  className={cn(
                    'rounded-sm text-xs text-muted-foreground',
                    config.style === style.id && 'bg-primary text-primary-foreground',
                  )}
                  onClick={() => onChange({ style: style.id })}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {config.provider === 'ai' && (
        <>
          <Input
            className={inputClass}
            value={config.ai.baseUrl}
            aria-label="AI 接口地址"
            placeholder="AI 接口地址"
            onChange={(event) => onChange({ ai: { ...config.ai, baseUrl: event.target.value } })}
          />
          {usesRemoteHttp(config.ai.baseUrl) && <HttpWarning />}
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
          <textarea
            className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={config.glossary}
            maxLength={4000}
            aria-label="翻译术语表"
            placeholder="术语表：每行一个 术语 = 译法"
            onChange={(event) => onChange({ glossary: event.target.value })}
          />
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
          {usesRemoteHttp(config.api.baseUrl) && <HttpWarning />}
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
        <Input
          className={inputClass}
          value={config.offline.baseUrl}
          aria-label="本地翻译服务地址"
          placeholder="http://127.0.0.1:5000"
          onChange={(event) => onChange({ offline: { baseUrl: event.target.value } })}
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={testing}
          onClick={onTest}
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          测试连接
        </Button>
        <span className="text-[11px] text-muted-foreground" role="status">
          {testStatus}
        </span>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={config.autoTranslateSelection}
          onChange={(event) => onChange({ autoTranslateSelection: event.target.checked })}
        />
        右键翻译选中文字后自动执行
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={config.confirmNonTargetSend}
          onChange={(event) => onChange({ confirmNonTargetSend: event.target.checked })}
        />
        网页发送语言不符时确认
      </label>
    </div>
  )
}

function HttpWarning() {
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
      {REMOTE_HTTP_WARNING}
    </p>
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
