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
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { currentAiEnvironmentOperation } from '@/lib/aiEnvironmentRuntime'
import { runAi } from '@/lib/notes/aiClient'
import { REMOTE_HTTP_WARNING, usesRemoteHttp } from '@/lib/remoteHttp'
import { describeTranslationTarget } from '@/lib/translationTarget'
import { cn } from '@/lib/utils'
import { useTranslationStore } from '@/store/useTranslationStore'
import type { AiKind } from '@/store/useAiStore'
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
  networkReady: boolean
}

export function TranslationPanel({ kind, tabId, networkReady }: TranslationPanelProps) {
  const state = useTranslationStore()
  const cancelRef = useRef<null | (() => void)>(null)
  const [copied, setCopied] = useCopyIndicator()
  const [mode, setMode] = useState<'read' | 'compose'>('read')
  const [outgoingText, setOutgoingText] = useState('')
  const [outgoingResult, setOutgoingResult] = useState('')
  const [outgoingStatus, setOutgoingStatus] = useState('')
  const [outgoingLoading, setOutgoingLoading] = useState(false)
  const autoTranslateRef = useRef(0)
  const targetMatches = state.kind === kind && state.tabId === tabId
  const canUseTranslation = networkReady && Boolean(tabId) && targetMatches
  const sourceText = targetMatches ? state.sourceText : ''
  const result = targetMatches ? state.result : ''
  const status = targetMatches ? state.status : ''
  const loading = targetMatches && state.loading
  const activeProviderConfig =
    state.config.provider === 'ai'
      ? state.config.ai
      : state.config.provider === 'offline'
        ? state.config.offline
        : state.config.api
  const targetDisplay = describeTranslationTarget(
    state.config.provider,
    activeProviderConfig.baseUrl,
  )

  useEffect(() => {
    void useTranslationStore.getState().load()
  }, [])

  useEffect(() => {
    useTranslationStore.getState().activateTarget(kind, tabId)
    cancelRef.current?.()
    cancelRef.current = null
    return () => {
      cancelRef.current?.()
      cancelRef.current = null
      useTranslationStore.getState().invalidateRequests(kind, tabId)
    }
  }, [kind, tabId])

  const patchConfig = (patch: Partial<TranslationSettings>) => {
    const token = useTranslationStore.getState().snapshotRequest(kind, tabId)
    void useTranslationStore
      .getState()
      .saveConfig(patch)
      .catch((error) => {
        if (!token) return
        useTranslationStore.getState().applyRequest(token, {
          status: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const closePanel = () => {
    cancelRef.current?.()
    cancelRef.current = null
    useTranslationStore.getState().close()
  }

  const capturePage = async (translateAfterCapture = false) => {
    if (!networkReady || !tabId) return
    const token = useTranslationStore.getState().beginRequest(kind, tabId, {
      result: '',
      status: '正在读取当前网页…',
    })
    if (!token) return
    try {
      const page = await api.captureAiPageText(kind, tabId, currentAiEnvironmentOperation(kind))
      useTranslationStore.getState().applyRequest(token, {
        sourceText: page.text,
        result: '',
        status: page.truncated ? '内容较长，已读取前 30000 个字符' : '已读取当前网页',
      })
      if (translateAfterCapture) void translate()
    } catch (error) {
      useTranslationStore.getState().applyRequest(token, {
        status: error instanceof Error ? error.message : String(error),
      })
    } finally {
      useTranslationStore.getState().applyRequest(token, { loading: false })
    }
  }

  const translate = async () => {
    if (!networkReady || !tabId) return
    const current = useTranslationStore.getState()
    const text = current.sourceText.trim()
    if (!text) {
      const token = current.snapshotRequest(kind, tabId)
      if (token) current.applyRequest(token, { status: '请先输入、选中或读取要翻译的内容' })
      return
    }
    cancelRef.current?.()
    const token = current.beginRequest(kind, tabId, { result: '', status: '正在翻译…' })
    if (!token) return

    if (current.config.provider === 'ai') {
      const provider = current.config.ai
      if (!provider.baseUrl || !provider.apiKey) {
        current.applyRequest(token, {
          loading: false,
          settingsOpen: true,
          status: '请先配置 AI 接口地址和密钥',
        })
        return
      }
      let cancel: () => void = () => undefined
      cancel = runAi(
        {
          provider,
          mode: 'translate',
          text,
          ctx: { targetLanguage: TARGET_LABELS[current.config.targetLanguage] || '中文' },
        },
        {
          onDelta: (delta) => {
            useTranslationStore.getState().appendRequestResult(token, delta)
          },
          onStatus: (status) => {
            useTranslationStore.getState().applyRequest(token, { status })
          },
          onDone: () => {
            if (cancelRef.current === cancel) cancelRef.current = null
            useTranslationStore.getState().applyRequest(token, {
              loading: false,
              status: '翻译完成',
            })
          },
          onError: (message) => {
            if (cancelRef.current === cancel) cancelRef.current = null
            useTranslationStore.getState().applyRequest(token, { loading: false, status: message })
          },
        },
      )
      cancelRef.current = cancel
      return
    }

    let cancelRequest: null | (() => void) = null
    try {
      const provider = current.config.provider
      const config = provider === 'offline' ? current.config.offline : current.config.api
      const requestId = `translate-${crypto.randomUUID()}`
      cancelRequest = () => {
        void api.cancelTranslation(requestId)
      }
      cancelRef.current = cancelRequest
      const response = await api.translateText({
        requestId,
        mode: provider,
        baseUrl: config.baseUrl,
        apiKey: provider === 'api' ? current.config.api.apiKey : undefined,
        text,
        source: current.config.sourceLanguage,
        target: current.config.targetLanguage,
      })
      useTranslationStore.getState().applyRequest(token, {
        result: response.translatedText,
        status: '翻译完成',
      })
    } catch (error) {
      useTranslationStore.getState().applyRequest(token, {
        status: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (cancelRef.current === cancelRequest) cancelRef.current = null
      useTranslationStore.getState().applyRequest(token, { loading: false })
    }
  }

  useEffect(() => {
    if (state.autoTranslateGeneration <= autoTranslateRef.current || !sourceText.trim()) return
    autoTranslateRef.current = state.autoTranslateGeneration
    setMode('read')
    void translate()
    // Selection events carry their own monotonically increasing generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.autoTranslateGeneration])

  const translateOutgoing = async (action: 'preview' | 'fill' | 'send') => {
    if (!networkReady || !tabId || outgoingLoading) return
    const text = outgoingText.trim()
    if (!text) {
      setOutgoingStatus('请先输入要提问的内容')
      return
    }
    cancelRef.current?.()
    cancelRef.current = null
    setOutgoingLoading(true)
    setOutgoingResult('')
    setOutgoingStatus(action === 'preview' ? '正在翻译为网页语言…' : '正在翻译并准备填入网页…')
    try {
      const current = useTranslationStore.getState()
      const targetLanguage = current.config.siteLanguage || 'en'
      let translated = ''
      if (current.config.provider === 'ai') {
        const provider = current.config.ai
        if (!provider.baseUrl || !provider.apiKey) {
          current.setSettingsOpen(kind, tabId, true)
          throw new Error('请先配置 AI 接口地址和密钥')
        }
        translated = await new Promise<string>((resolve, reject) => {
          let accumulated = ''
          let cancel: () => void = () => undefined
          cancel = runAi(
            {
              provider,
              mode: 'translate',
              text,
              ctx: { targetLanguage: TARGET_LABELS[targetLanguage] || targetLanguage },
            },
            {
              onDelta: (delta) => {
                accumulated += delta
                setOutgoingResult(accumulated)
              },
              onStatus: setOutgoingStatus,
              onDone: () => {
                if (cancelRef.current === cancel) cancelRef.current = null
                resolve(accumulated.trim())
              },
              onError: (message) => {
                if (cancelRef.current === cancel) cancelRef.current = null
                reject(new Error(message))
              },
            },
          )
          cancelRef.current = cancel
        })
      } else {
        const provider = current.config.provider
        const config = provider === 'offline' ? current.config.offline : current.config.api
        const requestId = `translate-${crypto.randomUUID()}`
        const cancel = () => void api.cancelTranslation(requestId)
        cancelRef.current = cancel
        const response = await api.translateText({
          requestId,
          mode: provider,
          baseUrl: config.baseUrl,
          apiKey: provider === 'api' ? current.config.api.apiKey : undefined,
          text,
          source: 'auto',
          target: targetLanguage,
        })
        if (cancelRef.current === cancel) cancelRef.current = null
        translated = response.translatedText.trim()
        setOutgoingResult(translated)
      }
      if (!translated) throw new Error('翻译服务没有返回内容')
      if (action !== 'preview') {
        await api.writeAiComposer({
          ...currentAiEnvironmentOperation(kind),
          kind,
          tabId,
          text: translated,
          send: action === 'send',
        })
      }
      setOutgoingStatus(
        action === 'send' ? '已翻译并发送' : action === 'fill' ? '已填入网页输入框' : '翻译完成',
      )
    } catch (error) {
      setOutgoingStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setOutgoingLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="关闭翻译侧栏"
        className="fixed inset-0 z-20 bg-black/35 backdrop-blur-[1px] lg:hidden"
        onClick={closePanel}
      />
      <aside
        aria-label="翻译侧栏"
        className="fixed inset-y-0 right-0 z-30 flex w-[min(92vw,380px)] flex-col border-l border-border bg-background shadow-2xl lg:static lg:z-auto lg:w-[clamp(280px,30vw,420px)] lg:min-w-0 lg:shrink-0 lg:shadow-none"
      >
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
            onClick={() => state.setSettingsOpen(kind, tabId, !state.settingsOpen)}
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="关闭翻译侧栏"
            aria-label="关闭翻译侧栏"
            onClick={closePanel}
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
              onClick={() => patchConfig({ provider: provider.id })}
            >
              {provider.label}
            </button>
          ))}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border p-2">
          <button
            type="button"
            className={cn(
              'h-8 rounded-md text-xs font-medium transition-colors',
              mode === 'read'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60',
            )}
            onClick={() => setMode('read')}
          >
            阅读翻译
          </button>
          <button
            type="button"
            className={cn(
              'h-8 rounded-md text-xs font-medium transition-colors',
              mode === 'compose'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60',
            )}
            onClick={() => setMode('compose')}
          >
            中文提问
          </button>
        </div>

        <div className="flex h-7 min-w-0 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[11px] text-muted-foreground">
          <span className="shrink-0">发送到</span>
          <span
            className="min-w-0 truncate font-medium text-foreground"
            title={targetDisplay.title}
          >
            {targetDisplay.label}
          </span>
        </div>

        {state.settingsOpen && (
          <TranslationSettingsForm
            key={state.config.provider}
            config={state.config}
            onSave={(config) => {
              const token = useTranslationStore.getState().snapshotRequest(kind, tabId)
              void useTranslationStore
                .getState()
                .saveConfig(config)
                .then(() => {
                  if (!token) return
                  useTranslationStore.getState().applyRequest(token, {
                    status: '翻译设置已保存',
                    settingsOpen: false,
                  })
                })
                .catch((error) => {
                  if (!token) return
                  useTranslationStore.getState().applyRequest(token, {
                    status: error instanceof Error ? error.message : String(error),
                  })
                })
            }}
          />
        )}

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
              value={sourceText}
              onChange={(event) => state.setSourceText(kind, tabId, event.target.value)}
              disabled={!canUseTranslation}
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
                disabled={!canUseTranslation || loading}
                onClick={() => void capturePage(true)}
              >
                <FileText className="size-3.5" />
                整页翻译
              </Button>
              <Button
                size="sm"
                className="ml-auto gap-1.5"
                disabled={!canUseTranslation || loading}
                onClick={() => void translate()}
              >
                {loading ? (
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
                  disabled={!result}
                  onClick={() => {
                    const token = useTranslationStore.getState().snapshotRequest(kind, tabId)
                    void navigator.clipboard
                      .writeText(result)
                      .then(() => setCopied())
                      .catch(() => {
                        if (token) {
                          useTranslationStore
                            .getState()
                            .applyRequest(token, { status: '复制失败，请检查剪贴板权限' })
                        }
                      })
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
                {result || <span className="text-muted-foreground">译文将在这里显示</span>}
              </div>
              <div className="min-h-6 pt-1.5 text-xs text-muted-foreground" role="status">
                {status}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">我的语言</span>
              <span>→</span>
              <LanguageSelect
                value={state.config.siteLanguage}
                label="网页接收语言"
                onChange={(siteLanguage) => patchConfig({ siteLanguage })}
              />
            </div>
            <textarea
              value={outgoingText}
              onChange={(event) => setOutgoingText(event.target.value)}
              disabled={!canUseTranslation || outgoingLoading}
              placeholder="在这里用中文提问，网页只会收到翻译后的内容"
              aria-label="中文提问内容"
              className="min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canUseTranslation || outgoingLoading || !outgoingText.trim()}
                onClick={() => void translateOutgoing('preview')}
              >
                <Languages className="mr-1.5 size-3.5" />
                预览译文
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canUseTranslation || outgoingLoading || !outgoingText.trim()}
                onClick={() => void translateOutgoing('fill')}
              >
                <MessageSquareText className="mr-1.5 size-3.5" />
                翻译并填入
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                disabled={!canUseTranslation || outgoingLoading || !outgoingText.trim()}
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
              <div className="mb-1 flex h-8 items-center text-xs font-medium text-muted-foreground">
                网页将收到
                <span className="ml-1">
                  {TARGET_LABELS[state.config.siteLanguage] || state.config.siteLanguage}
                </span>
              </div>
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
    </>
  )
}

function TranslationSettingsForm({
  config,
  onSave,
}: {
  config: TranslationSettings
  onSave: (config: TranslationSettings) => void
}) {
  const inputClass = 'h-8 text-xs'
  const [draft, setDraft] = useState(config)
  const changed = JSON.stringify(draft) !== JSON.stringify(config)
  const remoteUrl = draft.provider === 'ai' ? draft.ai.baseUrl : draft.api.baseUrl
  const showRemoteHttpWarning = usesRemoteHttp(remoteUrl)
  return (
    <div className="max-h-[42vh] shrink-0 space-y-2 overflow-y-auto border-b border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">网页接收语言</span>
        <LanguageSelect
          value={draft.siteLanguage}
          label="网页接收语言"
          onChange={(siteLanguage) => setDraft((current) => ({ ...current, siteLanguage }))}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-2.5 py-2">
        <label htmlFor="confirm-non-target-send" className="text-xs">
          非目标语言发送前确认
        </label>
        <Switch
          id="confirm-non-target-send"
          checked={draft.confirmNonTargetSend}
          onCheckedChange={(confirmNonTargetSend) =>
            setDraft((current) => ({ ...current, confirmNonTargetSend }))
          }
        />
      </div>
      {draft.provider === 'ai' && (
        <>
          <Input
            className={inputClass}
            value={draft.ai.baseUrl}
            aria-label="AI 接口地址"
            placeholder="AI 接口地址"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                ai: { ...current.ai, baseUrl: event.target.value },
              }))
            }
          />
          <Input
            className={inputClass}
            type="password"
            value={draft.ai.apiKey}
            aria-label="AI 接口密钥"
            placeholder="AI 接口密钥"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                ai: { ...current.ai, apiKey: event.target.value },
              }))
            }
          />
          <div className="flex gap-2">
            <Input
              className={inputClass}
              value={draft.ai.model}
              aria-label="AI 模型"
              placeholder="模型"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ai: { ...current.ai, model: event.target.value },
                }))
              }
            />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="推理强度"
              value={draft.ai.effort}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ai: { ...current.ai, effort: event.target.value },
                }))
              }
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
        </>
      )}
      {draft.provider === 'api' && (
        <>
          <Input
            className={inputClass}
            value={draft.api.baseUrl}
            aria-label="翻译 API 地址"
            placeholder="LibreTranslate 兼容接口地址"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                api: { ...current.api, baseUrl: event.target.value },
              }))
            }
          />
          <Input
            className={inputClass}
            type="password"
            value={draft.api.apiKey}
            aria-label="翻译 API 密钥"
            placeholder="API 密钥（可选）"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                api: { ...current.api, apiKey: event.target.value },
              }))
            }
          />
        </>
      )}
      {draft.provider === 'offline' && (
        <>
          <Input
            className={inputClass}
            value={draft.offline.baseUrl}
            aria-label="本地翻译服务地址"
            placeholder="http://127.0.0.1:5000"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                offline: { baseUrl: event.target.value },
              }))
            }
          />
          <p className="text-[11px] text-muted-foreground">
            仅允许本机回环地址，文本不会发送到远程服务。
          </p>
        </>
      )}
      {showRemoteHttpWarning && (
        <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {REMOTE_HTTP_WARNING}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" disabled={!changed} onClick={() => setDraft(config)}>
          取消
        </Button>
        <Button size="sm" disabled={!changed} onClick={() => onSave(draft)}>
          保存设置
        </Button>
      </div>
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
