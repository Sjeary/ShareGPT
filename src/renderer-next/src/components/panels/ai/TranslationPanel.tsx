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
  Settings2,
  TextCursorInput,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import {
  cancelManagedTranslation,
  createManagedTranslationRequestId,
  fetchManagedTranslationProfiles,
  managedTranslate,
  type ManagedTranslationCatalog,
} from '@/lib/managedTranslation'
import { runAi } from '@/lib/notes/aiClient'
import { REMOTE_HTTP_WARNING, usesRemoteHttp } from '@/lib/remoteHttp'
import { cn } from '@/lib/utils'
import { useTranslationStore } from '@/store/useTranslationStore'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
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
  { id: 'managed', label: '团队配置' },
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
const MANAGED_HTTP_WARNING =
  '当前协作服务器使用 HTTP。翻译内容和登录令牌会以明文在网络中传输；应用仍允许连接该地址。'

interface TranslationPanelProps {
  kind: AiKind
  tabId: string
  environmentId: string
  width: number
  replacement: boolean
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
  managedContext?: { serverUrl: string; token: string },
): TranslationRun {
  if (config.provider === 'managed') {
    const controller = new AbortController()
    const requestId = createManagedTranslationRequestId()
    const promise = managedTranslate(
      managedContext?.serverUrl || '',
      managedContext?.token || '',
      {
        profileId: config.managed.profileId || undefined,
        text,
        source: sourceLanguage,
        target: targetLanguage,
        style: config.style,
        glossary: config.glossary,
        requestId,
      },
      { signal: controller.signal },
    ).then((response) => response.translatedText)
    return {
      promise,
      cancel: () => {
        controller.abort()
        void cancelManagedTranslation(
          managedContext?.serverUrl || '',
          managedContext?.token || '',
          requestId,
        ).catch(() => undefined)
      },
    }
  }

  if (config.provider !== 'ai') {
    const requestId = createManagedTranslationRequestId()
    const provider = config.provider
    const providerConfig = provider === 'offline' ? config.offline : config.api
    const promise = api
      .translateText({
        requestId,
        mode: provider,
        baseUrl: providerConfig.baseUrl,
        apiKey: provider === 'api' ? config.api.apiKey : undefined,
        text,
        source: sourceLanguage,
        target: targetLanguage,
      })
      .then((response) => response.translatedText.trim())
    return {
      promise,
      cancel: () => {
        void api.cancelTranslation(requestId).catch(() => undefined)
      },
    }
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

export function TranslationPanel({
  kind,
  tabId,
  environmentId,
  width,
  replacement,
}: TranslationPanelProps) {
  const state = useTranslationStore()
  const load = state.load
  const cancelRef = useRef<null | (() => void)>(null)
  const operationGenerationRef = useRef(0)
  const lastAutoTranslateRef = useRef(0)
  const [copied, setCopied] = useCopyIndicator()
  const [pendingWrite, setPendingWrite] = useState(false)
  const [testStatus, setTestStatus] = useState('')
  const [testing, setTesting] = useState(false)
  const token = useAuthStore((current) => current.token)
  const serverUrl = useAppStore((current) => String(current.settings?.collab?.server_url || ''))
  const [managedReload, setManagedReload] = useState(0)
  const managedRequestKey = `${state.principalId}\0${serverUrl}\0${token}\0${managedReload}`
  const [managedResult, setManagedResult] = useState<{
    key: string
    catalog: ManagedTranslationCatalog | null
    error: string
  }>({ key: '', catalog: null, error: '' })
  const managedCanLoad = Boolean(token && serverUrl)
  const managedCatalog = managedResult.key === managedRequestKey ? managedResult.catalog : null
  const managedError = managedResult.key === managedRequestKey ? managedResult.error : ''
  const managedLoading = managedCanLoad && managedResult.key !== managedRequestKey

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    const principalId = state.principalId
    if (!token || !serverUrl) {
      return () => controller.abort()
    }
    void fetchManagedTranslationProfiles(serverUrl, token, { signal: controller.signal })
      .then((catalog) => {
        if (
          controller.signal.aborted ||
          useTranslationStore.getState().principalId !== principalId
        ) {
          return
        }
        setManagedResult({ key: managedRequestKey, catalog, error: '' })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setManagedResult({ key: managedRequestKey, catalog: null, error: cleanError(error) })
      })
    return () => controller.abort()
  }, [managedRequestKey, serverUrl, state.principalId, token])

  useEffect(() => {
    operationGenerationRef.current += 1
    return () => {
      operationGenerationRef.current += 1
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [environmentId, kind, state.principalId, tabId])

  const selectMode = (mode: 'read' | 'compose') => {
    if (mode === state.mode) return
    operationGenerationRef.current += 1
    cancelRef.current?.()
    cancelRef.current = null
    setPendingWrite(false)
    state.setMode(mode)
  }

  const patchConfig = (patch: Partial<TranslationSettings>) => {
    if (
      Object.keys(patch).some(
        (key) => !['confirmNonTargetSend', 'autoTranslateSelection'].includes(key),
      )
    ) {
      state.markStale()
    }
    void state.saveConfig(patch).catch((error) => {
      const current = useTranslationStore.getState()
      const message = cleanError(error)
      if (current.mode === 'read') current.setReaderStatus(message)
      else current.setComposerStatus(message)
    })
  }

  const translateReader = useCallback(async () => {
    const current = useTranslationStore.getState()
    const text = current.reader.sourceText.trim()
    if (!text) {
      current.setReaderStatus('请先输入、选中或读取要翻译的内容')
      return
    }
    cancelRef.current?.()
    const generation = operationGenerationRef.current + 1
    operationGenerationRef.current = generation
    current.beginReaderTranslation()
    setPendingWrite(false)
    const run = startTranslation(
      current.config,
      text,
      current.config.sourceLanguage,
      current.config.targetLanguage || 'zh',
      {
        onDelta: current.config.provider === 'ai' ? current.appendReaderResult : undefined,
        onStatus: current.setReaderStatus,
      },
      {
        serverUrl: String(useAppStore.getState().settings?.collab?.server_url || ''),
        token: useAuthStore.getState().token,
      },
    )
    cancelRef.current = run.cancel
    try {
      const translated = await run.promise
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      if (!translated) throw new Error('翻译服务没有返回内容')
      if (current.config.provider !== 'ai') current.setReaderResult(translated)
      current.completeReaderTranslation()
    } catch (error) {
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      const message = cleanError(error)
      useTranslationStore.setState((latest) => ({
        reader: {
          ...latest.reader,
          loading: false,
          phase: message ? 'error' : 'idle',
          status: message,
        },
      }))
      if (/配置 AI/.test(message)) current.setSettingsOpen(true)
    }
  }, [])

  const translateComposer = useCallback(async () => {
    const current = useTranslationStore.getState()
    const text = current.composer.sourceText.trim()
    if (!text) {
      current.setComposerStatus('请先输入要写给 AI 的内容')
      return
    }
    cancelRef.current?.()
    const generation = operationGenerationRef.current + 1
    operationGenerationRef.current = generation
    current.beginComposerTranslation()
    setPendingWrite(false)
    const run = startTranslation(
      current.config,
      text,
      current.config.sourceLanguage,
      current.config.siteLanguage || 'en',
      {
        onDelta: current.config.provider === 'ai' ? current.appendComposerTranslation : undefined,
        onStatus: current.setComposerStatus,
      },
      {
        serverUrl: String(useAppStore.getState().settings?.collab?.server_url || ''),
        token: useAuthStore.getState().token,
      },
    )
    cancelRef.current = run.cancel
    try {
      const translated = await run.promise
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      if (!translated) throw new Error('翻译服务没有返回内容')
      current.completeComposerTranslation(translated)
    } catch (error) {
      if (operationGenerationRef.current !== generation) return
      cancelRef.current = null
      const message = cleanError(error)
      useTranslationStore.setState((latest) => ({
        composer: {
          ...latest.composer,
          loading: false,
          phase: message ? 'error' : 'idle',
          status: message,
        },
      }))
      if (/配置 AI/.test(message)) current.setSettingsOpen(true)
    }
  }, [])

  useEffect(() => {
    if (
      !state.config.autoTranslateSelection ||
      state.reader.autoTranslateRequest <= lastAutoTranslateRef.current
    ) {
      return
    }
    lastAutoTranslateRef.current = state.reader.autoTranslateRequest
    void translateReader()
  }, [state.reader.autoTranslateRequest, state.config.autoTranslateSelection, translateReader])

  const captureSelection = async () => {
    state.setReaderLoading(true)
    state.setReaderStatus('正在读取网页选区…')
    try {
      const selection = await api.captureAiSelectionText(kind, tabId, environmentId)
      state.setReaderCapturedSource('selection', selection.text, {
        status: selection.truncated ? '选区较长，已读取前 30000 个字符' : '已读取网页选中文字',
      })
    } catch (error) {
      state.setReaderStatus(cleanError(error))
    } finally {
      state.setReaderLoading(false)
    }
  }

  const capturePage = async () => {
    state.setReaderLoading(true)
    state.setReaderStatus('正在读取当前网页…')
    try {
      const page = await api.captureAiPageText(kind, tabId, environmentId)
      state.setReaderCapturedSource('page', page.text, {
        status: page.truncated ? '内容较长，已读取前 30000 个字符' : '已读取当前网页',
      })
    } catch (error) {
      state.setReaderStatus(cleanError(error))
    } finally {
      state.setReaderLoading(false)
    }
  }

  const writeToComposer = async (
    strategy: 'fail-if-not-empty' | 'append' | 'replace' = 'fail-if-not-empty',
  ) => {
    const current = useTranslationStore.getState()
    const text = current.composer.preview.trim()
    if (!text || current.composer.phase !== 'ready') return
    const generation = operationGenerationRef.current + 1
    operationGenerationRef.current = generation
    current.beginComposerWrite()
    try {
      const target: AiComposerTarget = await api.getAiComposerTarget({ kind, tabId, environmentId })
      if (operationGenerationRef.current !== generation) return
      const response = await api.writeAiComposer({ target, text, send: false, strategy })
      if (operationGenerationRef.current !== generation) return
      if (response.conflict === 'existing-draft') {
        setPendingWrite(true)
        current.completeComposerWrite(`${AI_LABELS[kind]} 输入框中已有草稿`)
        return
      }
      setPendingWrite(false)
      current.completeComposerWrite(`已插入 ${AI_LABELS[kind]}，尚未发送`)
    } catch (error) {
      if (operationGenerationRef.current !== generation) return
      current.completeComposerWrite(cleanError(error))
    }
  }

  const testConnection = async () => {
    if (testing) return
    setTesting(true)
    setTestStatus('正在测试…')
    const run = startTranslation(state.config, 'Hello', 'en', 'zh', {}, { serverUrl, token })
    try {
      const result = await run.promise
      setTestStatus(result ? '连接正常' : '服务未返回译文')
    } catch (error) {
      setTestStatus(cleanError(error) || '测试已取消')
    } finally {
      setTesting(false)
    }
  }

  const canInsert = state.composer.phase === 'ready' && Boolean(state.composer.preview.trim())
  const providerReady =
    state.config.provider === 'managed'
      ? Boolean(
          managedCatalog?.profiles.some(
            (profile) =>
              profile.id === (state.config.managed.profileId || managedCatalog.defaultProfileId),
          ),
        )
      : state.config.provider === 'ai'
        ? Boolean(state.config.ai.baseUrl && state.config.ai.apiKey)
        : state.config.provider === 'api'
          ? Boolean(state.config.api.baseUrl)
          : Boolean(state.config.offline.baseUrl)
  const providerStatus =
    testStatus === '连接正常'
      ? '已连接'
      : state.config.provider === 'managed' && managedLoading
        ? '加载中'
        : providerReady
          ? '可用'
          : '未配置'
  const sourceNote =
    state.reader.sourceKind === 'selection'
      ? '来自网页选中文字'
      : state.reader.sourceKind === 'page'
        ? '来自当前网页'
        : '手工输入'

  return (
    <aside
      className="flex h-full min-w-0 shrink-0 flex-col bg-background"
      style={{ width: replacement ? '100%' : width }}
      aria-label="翻译工作台"
      data-layout={replacement ? 'replace' : 'split'}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Languages className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">翻译</h2>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {PROVIDERS.find((item) => item.id === state.config.provider)?.label} · {providerStatus}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn('ml-auto size-8 shrink-0', state.settingsOpen && 'bg-accent')}
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
          className="size-8 shrink-0"
          title="关闭翻译侧栏"
          aria-label="关闭翻译侧栏"
          onClick={state.close}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="shrink-0 border-b border-border p-2">
        <div
          className="grid h-8 grid-cols-2 rounded-md bg-muted p-0.5"
          role="tablist"
          aria-label="翻译模式"
        >
          <button
            type="button"
            role="tab"
            aria-selected={state.mode === 'read'}
            className={cn(
              'rounded-[5px] text-xs font-medium transition-colors',
              state.mode === 'read'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => selectMode('read')}
          >
            阅读翻译
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.mode === 'compose'}
            className={cn(
              'rounded-[5px] text-xs font-medium transition-colors',
              state.mode === 'compose'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => selectMode('compose')}
          >
            写给 AI
          </button>
        </div>
      </div>

      {state.settingsOpen && (
        <TranslationSettingsForm
          config={state.config}
          testing={testing}
          testStatus={testStatus}
          onChange={patchConfig}
          onTest={() => void testConnection()}
          managedCatalog={managedCatalog}
          managedLoading={managedLoading}
          managedError={managedError}
          managedServerUrl={serverUrl}
          onReloadManaged={() => setManagedReload((value) => value + 1)}
        />
      )}

      {state.mode === 'read' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
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

          <section className="space-y-1.5">
            <div className="flex min-h-8 flex-wrap items-center gap-2">
              <span className="text-xs font-medium">原文</span>
              <span className="text-[11px] text-muted-foreground">{sourceNote}</span>
              <div className="ml-auto flex shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  disabled={state.reader.loading}
                  onClick={() => void captureSelection()}
                >
                  <TextCursorInput className="size-3.5" />
                  选中文字
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  disabled={state.reader.loading}
                  onClick={() => void capturePage()}
                >
                  <FileText className="size-3.5" />
                  读取页面
                </Button>
              </div>
            </div>
            <textarea
              value={state.reader.sourceText}
              onChange={(event) => state.setReaderSourceText(event.target.value)}
              placeholder="输入要翻译的内容"
              aria-label="待翻译原文"
              spellCheck={false}
              className={cn(
                'min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
                state.reader.phase === 'stale' && 'border-amber-500',
              )}
            />
          </section>

          <Button
            className="w-full gap-2"
            disabled={state.reader.phase === 'translating' || !state.reader.sourceText.trim()}
            onClick={() => void translateReader()}
          >
            {state.reader.phase === 'translating' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Languages className="size-4" />
            )}
            翻译
          </Button>

          <section className="flex min-h-44 flex-1 flex-col space-y-1.5">
            <div className="flex min-h-8 flex-wrap items-center gap-2">
              <span className="text-xs font-medium">译文</span>
              <span className="text-[11px] text-muted-foreground">仅供阅读，不会写入网页</span>
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="复制译文"
                  aria-label="复制译文"
                  disabled={!state.reader.result}
                  onClick={() =>
                    void navigator.clipboard.writeText(state.reader.result).then(() => setCopied())
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
                  disabled={state.reader.phase === 'translating' || !state.reader.sourceText.trim()}
                  onClick={() => void translateReader()}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </div>
            <div
              role="region"
              aria-label="阅读译文"
              tabIndex={0}
              className={cn(
                'min-h-36 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-input bg-muted/20 px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                state.reader.phase === 'stale' && 'border-amber-500',
              )}
            >
              {state.reader.result || (
                <span className="text-muted-foreground">译文将在这里显示</span>
              )}
            </div>
          </section>

          <div
            className={cn(
              'flex min-h-6 items-start gap-1.5 text-xs text-muted-foreground',
              state.reader.phase === 'ready' && 'text-emerald-600 dark:text-emerald-400',
              (state.reader.phase === 'stale' || state.reader.phase === 'error') &&
                'text-amber-600 dark:text-amber-400',
            )}
            role="status"
          >
            {state.reader.phase === 'ready' ? (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
            ) : null}
            <span>{state.reader.status}</span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <LanguageSelect
                value={state.config.sourceLanguage}
                includeAuto
                label="输入语言"
                onChange={(sourceLanguage) => patchConfig({ sourceLanguage })}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <LanguageSelect
                value={state.config.siteLanguage}
                label="AI 接收语言"
                onChange={(siteLanguage) => patchConfig({ siteLanguage })}
              />
            </div>

            <section className="space-y-1.5">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <span className="text-xs font-medium">我想说</span>
                <span className="text-[11px] text-muted-foreground">
                  先翻译预览，不接触网页输入框
                </span>
              </div>
              <textarea
                value={state.composer.sourceText}
                onChange={(event) => state.setComposerSourceText(event.target.value)}
                placeholder="输入要写给 AI 的内容"
                aria-label="写给 AI 的原文"
                spellCheck={false}
                className={cn(
                  'min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  state.composer.phase === 'stale' && 'border-amber-500',
                )}
              />
            </section>

            <Button
              className="w-full gap-2"
              disabled={state.composer.phase === 'translating' || !state.composer.sourceText.trim()}
              onClick={() => void translateComposer()}
            >
              {state.composer.phase === 'translating' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Languages className="size-4" />
              )}
              生成发送预览
            </Button>

            <section className="flex min-h-44 flex-1 flex-col space-y-1.5">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <span className="text-xs font-medium">发送预览</span>
                <span className="text-[11px] text-muted-foreground">
                  {state.composer.previewEdited ? '已修改' : '确认后才会写入网页'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8"
                  title="重新生成发送预览"
                  aria-label="重新生成发送预览"
                  disabled={
                    state.composer.phase === 'translating' || !state.composer.sourceText.trim()
                  }
                  onClick={() => void translateComposer()}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              <textarea
                value={
                  state.composer.phase === 'translating'
                    ? state.composer.translation
                    : state.composer.preview
                }
                onChange={(event) => state.editComposerPreview(event.target.value)}
                disabled={state.composer.phase === 'translating'}
                placeholder="翻译后的发送内容会显示在这里"
                aria-label="发送预览"
                spellCheck={false}
                className={cn(
                  'min-h-36 flex-1 resize-y rounded-md border border-input bg-muted/20 px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring',
                  state.composer.phase === 'stale' && 'border-amber-500',
                )}
              />
            </section>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">插入格式</span>
              <div
                className="grid h-8 flex-1 grid-cols-2 rounded-md border border-input bg-background p-0.5"
                role="group"
                aria-label="插入格式"
              >
                <button
                  type="button"
                  className={cn(
                    'rounded-[5px] text-xs transition-colors',
                    state.composer.outputFormat === 'translated'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={state.composer.outputFormat === 'translated'}
                  disabled={state.composer.phase === 'translating'}
                  onClick={() => state.setComposerOutputFormat('translated')}
                >
                  仅译文
                </button>
                <button
                  type="button"
                  className={cn(
                    'rounded-[5px] text-xs transition-colors',
                    state.composer.outputFormat === 'bilingual'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={state.composer.outputFormat === 'bilingual'}
                  disabled={state.composer.phase === 'translating'}
                  onClick={() => state.setComposerOutputFormat('bilingual')}
                >
                  原文 + 译文
                </button>
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-border bg-background p-3">
            {pendingWrite ? (
              <div className="space-y-2" role="alert">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TriangleAlert className="size-4 text-amber-600" />
                  {AI_LABELS[kind]} 输入框中已有草稿
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPendingWrite(false)}>
                    取消
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void writeToComposer('append')}
                  >
                    追加到末尾
                  </Button>
                  <Button size="sm" onClick={() => void writeToComposer('replace')}>
                    替换原草稿
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={!canInsert}
                className="w-full gap-2"
                onClick={() => void writeToComposer()}
              >
                {state.composer.phase === 'writing' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageSquareText className="size-4" />
                )}
                插入 {AI_LABELS[kind]}
              </Button>
            )}

            <div
              className={cn(
                'flex min-h-5 items-start gap-1.5 text-xs text-muted-foreground',
                state.composer.phase === 'ready' && 'text-emerald-600 dark:text-emerald-400',
                (state.composer.phase === 'stale' || state.composer.phase === 'error') &&
                  'text-amber-600 dark:text-amber-400',
              )}
              role="status"
            >
              {state.composer.phase === 'ready' ? (
                <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
              ) : null}
              <span>{state.composer.status}</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function TranslationSettingsForm({
  config,
  testing,
  testStatus,
  onChange,
  onTest,
  managedCatalog,
  managedLoading,
  managedError,
  managedServerUrl,
  onReloadManaged,
}: {
  config: TranslationSettings
  testing: boolean
  testStatus: string
  onChange: (patch: Partial<TranslationSettings>) => void
  onTest: () => void
  managedCatalog: ManagedTranslationCatalog | null
  managedLoading: boolean
  managedError: string
  managedServerUrl: string
  onReloadManaged: () => void
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
        {(config.provider === 'ai' || config.provider === 'managed') && (
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

      {config.provider === 'managed' && (
        <>
          <div className="flex gap-2">
            <select
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              aria-label="团队翻译配置"
              value={config.managed.profileId}
              disabled={managedLoading || !managedCatalog?.profiles.length}
              onChange={(event) =>
                onChange({ managed: { ...config.managed, profileId: event.target.value } })
              }
            >
              <option value="">
                {managedCatalog?.defaultProfileId
                  ? `管理员默认 · ${managedCatalog.profiles.find((profile) => profile.id === managedCatalog.defaultProfileId)?.name || managedCatalog.defaultProfileId}`
                  : managedLoading
                    ? '正在读取管理员配置…'
                    : '没有可用的团队配置'}
              </option>
              {managedCatalog?.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.model ? ` · ${profile.model}` : ''}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              title="刷新团队翻译配置"
              aria-label="刷新团队翻译配置"
              disabled={managedLoading}
              onClick={onReloadManaged}
            >
              <RefreshCw className={cn('size-3.5', managedLoading && 'animate-spin')} />
            </Button>
          </div>
          {usesRemoteHttp(managedServerUrl) && <HttpWarning text={MANAGED_HTTP_WARNING} />}
          {managedError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] leading-4 text-destructive">
              {managedError}
            </p>
          )}
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

function HttpWarning({ text = REMOTE_HTTP_WARNING }: { text?: string }) {
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
      {text}
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
