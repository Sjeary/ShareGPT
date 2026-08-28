import { useState } from 'react'
import { RemoteHttpWarning } from '@/components/common/RemoteHttpWarning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usesRemoteHttp } from '@/lib/remoteHttp'
import type { TranslationProvider, TranslationSettings } from '@/types/settings'

export const LANGUAGES = [
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

export const PROVIDERS: Array<{ id: TranslationProvider; label: string }> = [
  { id: 'ai', label: 'AI' },
  { id: 'api', label: '翻译 API' },
  { id: 'offline', label: '本地离线' },
]

export function TranslationSettingsForm({
  config,
  onCancel,
  onSave,
}: {
  config: TranslationSettings
  onCancel: () => void
  onSave: (draft: TranslationSettings, baseline: TranslationSettings) => void
}) {
  const inputClass = 'h-8 text-xs'
  const [baseline] = useState(config)
  const [draft, setDraft] = useState(config)
  const changed = JSON.stringify(draft) !== JSON.stringify(baseline)
  const remoteUrl = draft.provider === 'ai' ? draft.ai.baseUrl : draft.api.baseUrl

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3">
      <div className="space-y-3">
        <Tabs
          value={draft.provider}
          onValueChange={(provider) =>
            setDraft((current) => ({ ...current, provider: provider as TranslationProvider }))
          }
        >
          <TabsList className="grid h-9 w-full grid-cols-3" aria-label="翻译服务">
            {PROVIDERS.map((provider) => (
              <TabsTrigger key={provider.id} value={provider.id} className="text-xs">
                {provider.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">网页接收语言</span>
          <LanguageSelect
            value={draft.siteLanguage}
            label="网页接收语言"
            onChange={(siteLanguage) => setDraft((current) => ({ ...current, siteLanguage }))}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-2.5 py-2">
          <label htmlFor="auto-translate-selection" className="text-xs">
            选中网页文字后自动翻译
          </label>
          <Switch
            id="auto-translate-selection"
            checked={draft.autoTranslateSelection}
            onCheckedChange={(autoTranslateSelection) =>
              setDraft((current) => ({ ...current, autoTranslateSelection }))
            }
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
        {usesRemoteHttp(remoteUrl) && <RemoteHttpWarning />}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" disabled={!changed} onClick={() => onSave(draft, baseline)}>
            保存设置
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LanguageSelect({
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
