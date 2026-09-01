import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, KeyRound, Languages, Plus, RotateCw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAdminStore } from '@/store/useAdminStore'
import type { AdminTranslationProfile } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

function newProfile(): AdminTranslationProfile {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36)
  return {
    id: `translation-${suffix}`,
    name: '新的翻译配置',
    type: 'ai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    effort: 'low',
    enabled: false,
    accessMode: 'restricted',
    allowedUsernames: [],
    pricing: { currency: 'USD', inputPerMillion: 0, outputPerMillion: 0, perRequest: 0 },
    apiKeyConfigured: false,
    apiKeyHint: '',
    usesPlainHttp: false,
  }
}

function cloneProfiles(profiles: AdminTranslationProfile[]) {
  return profiles.map((profile) => ({
    ...profile,
    allowedUsernames: [...profile.allowedUsernames],
    pricing: { ...profile.pricing },
    apiKey: '',
    clearApiKey: false,
  }))
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function formatCosts(costs: Record<string, number>) {
  const rows = Object.entries(costs || {}).filter(([, micros]) => micros > 0)
  if (!rows.length) return '0'
  return rows
    .map(([currency, micros]) => `${currency} ${(micros / 1_000_000).toFixed(6)}`)
    .join(' · ')
}

export function TranslationPanel() {
  const catalog = useAdminStore((state) => state.translationCatalog)
  const loading = useAdminStore((state) => state.translationLoading)
  const usage = useAdminStore((state) => state.translationUsage)
  const usageLoading = useAdminStore((state) => state.translationUsageLoading)
  const serverUrl = useAdminStore((state) => state.serverUrl)
  const users = useAdminStore((state) => state.users)
  const loadProfiles = useAdminStore((state) => state.loadTranslationProfiles)
  const loadUsage = useAdminStore((state) => state.loadTranslationUsage)
  const saveProfiles = useAdminStore((state) => state.saveTranslationProfiles)
  const [profiles, setProfiles] = useState<AdminTranslationProfile[]>([])
  const [defaultProfileId, setDefaultProfileId] = useState('')
  const [saving, setSaving] = useState(false)
  const [usageFilters, setUsageFilters] = useState({
    from: '',
    to: '',
    username: '',
    profileId: '',
  })

  useEffect(() => {
    void Promise.all([loadProfiles({ silent: true }), loadUsage({ silent: true })])
  }, [loadProfiles, loadUsage])

  useEffect(() => {
    if (!catalog) return
    setProfiles(cloneProfiles(catalog.profiles))
    setDefaultProfileId(catalog.defaultProfileId)
  }, [catalog])

  const enabledUsers = useMemo(
    () =>
      users.filter((user) => !user.disabled).sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  )
  const insecureAdminConnection = useMemo(() => {
    try {
      const endpoint = new URL(serverUrl)
      return (
        endpoint.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname.toLowerCase())
      )
    } catch {
      return false
    }
  }, [serverUrl])

  function patchProfile(id: string, patch: Partial<AdminTranslationProfile>) {
    setProfiles((current) =>
      current.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile)),
    )
  }

  function patchPricing(id: string, key: keyof AdminTranslationProfile['pricing'], value: string) {
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === id
          ? {
              ...profile,
              pricing: {
                ...profile.pricing,
                [key]: key === 'currency' ? value.toUpperCase() : Number(value) || 0,
              },
            }
          : profile,
      ),
    )
  }

  function toggleUser(profileId: string, username: string, checked: boolean) {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return
    const next = checked
      ? Array.from(new Set([...profile.allowedUsernames, username]))
      : profile.allowedUsernames.filter((item) => item !== username)
    patchProfile(profileId, { allowedUsernames: next })
  }

  async function save() {
    setSaving(true)
    try {
      await saveProfiles(defaultProfileId, profiles)
      await loadUsage({ silent: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function removeProfile(id: string) {
    setProfiles((current) => current.filter((profile) => profile.id !== id))
    if (defaultProfileId === id) setDefaultProfileId('')
  }

  return (
    <PanelScaffold
      icon={Languages}
      title="托管翻译服务"
      hint="服务端保管 API Key，按账号授权，并统计成功请求的 token 与估算费用"
      toolbar={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([loadProfiles(), loadUsage()])}
            disabled={loading || usageLoading}
          >
            <RotateCw className={loading || usageLoading ? 'animate-spin' : ''} />
            刷新
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            <Save />
            {saving ? '保存中' : '保存配置'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto grid max-w-5xl gap-8 p-6">
        {!catalog?.encryptionReady && (
          <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">服务器主密钥尚未配置</p>
              <p className="mt-1 text-xs text-muted-foreground">
                先设置 SHAREGPT_TRANSLATION_MASTER_KEY 并重启服务，才能保存启用的 API Key。
              </p>
            </div>
          </div>
        )}
        {insecureAdminConnection && (
          <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">管理端正在通过 HTTP 连接服务器</p>
              <p className="mt-1 text-xs text-muted-foreground">
                管理员密码、API Key 和管理令牌会以明文在网络中传输。生产服务器应使用 HTTPS。
              </p>
            </div>
          </div>
        )}

        <section className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">API 配置与用户授权</h3>
              <p className="text-xs text-muted-foreground">
                API Key 留空表示保留现有密钥；客户端不会获得地址、密钥或密文。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProfiles((current) => [...current, newProfile()])}
            >
              <Plus />
              添加配置
            </Button>
          </div>

          {!profiles.length && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              尚未配置团队翻译 API。用户仍可继续使用自己的 API 或离线翻译。
            </div>
          )}

          {profiles.map((profile) => (
            <div key={profile.id} className="grid gap-5 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  checked={profile.enabled}
                  onCheckedChange={(enabled) => {
                    patchProfile(profile.id, { enabled })
                    if (!enabled && defaultProfileId === profile.id) setDefaultProfileId('')
                  }}
                />
                <Input
                  value={profile.name}
                  onChange={(event) => patchProfile(profile.id, { name: event.target.value })}
                  aria-label="配置名称"
                  className="min-w-48 flex-1"
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="default-translation-profile"
                    checked={defaultProfileId === profile.id}
                    disabled={!profile.enabled}
                    onChange={() => setDefaultProfileId(profile.id)}
                  />
                  管理员默认
                </label>
                <Button
                  variant="outline"
                  size="icon"
                  title="删除配置"
                  onClick={() => removeProfile(profile.id)}
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="稳定 ID">
                  <Input value={profile.id} disabled />
                </Field>
                <Field label="接口类型">
                  <select
                    value={profile.type}
                    onChange={(event) =>
                      patchProfile(profile.id, { type: event.target.value as 'ai' | 'api' })
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="ai">OpenAI Responses 兼容</option>
                    <option value="api">通用翻译 JSON API</option>
                  </select>
                </Field>
                <Field label="上游地址">
                  <Input
                    value={profile.baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event) =>
                      patchProfile(profile.id, {
                        baseUrl: event.target.value,
                        usesPlainHttp: event.target.value.trim().startsWith('http:'),
                      })
                    }
                  />
                </Field>
                <Field label={profile.type === 'ai' ? '模型' : '模型（无需填写）'}>
                  <Input
                    value={profile.model}
                    disabled={profile.type !== 'ai'}
                    placeholder="gpt-5-mini"
                    onChange={(event) => patchProfile(profile.id, { model: event.target.value })}
                  />
                </Field>
                {profile.type === 'ai' && (
                  <Field label="推理强度">
                    <select
                      value={profile.effort}
                      onChange={(event) =>
                        patchProfile(profile.id, {
                          effort: event.target.value as AdminTranslationProfile['effort'],
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="none">无</option>
                      <option value="minimal">最低</option>
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                      <option value="xhigh">最高</option>
                    </select>
                  </Field>
                )}
              </div>

              {profile.usesPlainHttp && (
                <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  HTTP 会让翻译内容和 API Key 以明文在网络中传输。仅在可信网络且确有需要时使用。
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <Field label="API Key">
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      type="password"
                      value={profile.apiKey || ''}
                      disabled={profile.clearApiKey}
                      placeholder={
                        profile.apiKeyConfigured
                          ? `已加密保存 ····${profile.apiKeyHint || ''}，留空即保留`
                          : '输入后由服务端加密保存'
                      }
                      className="pl-9"
                      autoComplete="new-password"
                      onChange={(event) => patchProfile(profile.id, { apiKey: event.target.value })}
                    />
                  </div>
                </Field>
                <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(profile.clearApiKey)}
                    onChange={(event) => {
                      patchProfile(profile.id, {
                        clearApiKey: event.target.checked,
                        enabled: event.target.checked ? false : profile.enabled,
                        apiKey: '',
                      })
                      if (event.target.checked && defaultProfileId === profile.id) {
                        setDefaultProfileId('')
                      }
                    }}
                  />
                  清除已有密钥并停用
                </label>
              </div>

              <div className="grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-2">
                <div className="grid gap-3">
                  <Label>谁可以使用</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={profile.accessMode === 'all' ? 'default' : 'outline'}
                      onClick={() => patchProfile(profile.id, { accessMode: 'all' })}
                    >
                      全部用户
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={profile.accessMode === 'restricted' ? 'default' : 'outline'}
                      onClick={() => patchProfile(profile.id, { accessMode: 'restricted' })}
                    >
                      指定用户
                    </Button>
                  </div>
                  {profile.accessMode === 'restricted' && (
                    <div className="grid max-h-36 grid-cols-2 gap-2 overflow-auto rounded-md border border-border p-3 sm:grid-cols-3">
                      {enabledUsers.map((user) => (
                        <label
                          key={user.username}
                          className="flex min-w-0 items-center gap-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={profile.allowedUsernames.includes(user.username)}
                            onChange={(event) =>
                              toggleUser(profile.id, user.username, event.target.checked)
                            }
                          />
                          <span className="truncate" title={user.username}>
                            {user.displayName || user.username}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  <div>
                    <Label>估算计价</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      只用于管理统计，不替代供应商账单。
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <PriceField
                      label="币种"
                      value={profile.pricing.currency}
                      onChange={(value) => patchPricing(profile.id, 'currency', value)}
                    />
                    <PriceField
                      label="输入/百万 token"
                      value={profile.pricing.inputPerMillion}
                      onChange={(value) => patchPricing(profile.id, 'inputPerMillion', value)}
                    />
                    <PriceField
                      label="输出/百万 token"
                      value={profile.pricing.outputPerMillion}
                      onChange={(value) => patchPricing(profile.id, 'outputPerMillion', value)}
                    />
                    <PriceField
                      label="每次请求"
                      value={profile.pricing.perRequest}
                      onChange={(value) => patchPricing(profile.id, 'perRequest', value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">使用量</h3>
              <p className="text-xs text-muted-foreground">
                仅统计托管翻译成功请求，不保存翻译内容。
              </p>
            </div>
            <Badge variant="outline">最近 100 条明细</Badge>
          </div>
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] lg:items-end">
            <FilterField label="开始日期">
              <Input
                type="date"
                value={usageFilters.from}
                onChange={(event) =>
                  setUsageFilters((current) => ({ ...current, from: event.target.value }))
                }
                className="h-8 text-xs"
              />
            </FilterField>
            <FilterField label="结束日期">
              <Input
                type="date"
                value={usageFilters.to}
                onChange={(event) =>
                  setUsageFilters((current) => ({ ...current, to: event.target.value }))
                }
                className="h-8 text-xs"
              />
            </FilterField>
            <FilterField label="用户">
              <select
                value={usageFilters.username}
                onChange={(event) =>
                  setUsageFilters((current) => ({ ...current, username: event.target.value }))
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">全部用户</option>
                {users.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.displayName || user.username}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="API 配置">
              <select
                value={usageFilters.profileId}
                onChange={(event) =>
                  setUsageFilters((current) => ({ ...current, profileId: event.target.value }))
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">全部配置</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <Button
              variant="outline"
              size="sm"
              disabled={usageLoading}
              onClick={() => void loadUsage({ filters: usageFilters })}
            >
              查询
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="成功请求" value={formatCount(usage?.totals.requests || 0)} />
            <Metric label="输入字符" value={formatCount(usage?.totals.inputChars || 0)} />
            <Metric label="总 token" value={formatCount(usage?.totals.totalTokens || 0)} />
            <Metric label="估算费用" value={formatCosts(usage?.totals.costByCurrency || {})} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <UsageTable
              title="按配置"
              rows={(usage?.byProfile || []).map((row) => ({
                key: row.profileId,
                label: row.profileName,
                requests: row.requests,
                tokens: row.totalTokens,
                costs: row.costByCurrency,
              }))}
            />
            <UsageTable
              title="按用户"
              rows={(usage?.byUser || []).map((row) => ({
                key: row.username,
                label: row.username,
                requests: row.requests,
                tokens: row.totalTokens,
                costs: row.costByCurrency,
              }))}
            />
          </div>
          {!!usage?.recent.length && (
            <div className="grid gap-2">
              <h4 className="text-xs font-semibold">最近成功请求</h4>
              <div className="overflow-auto rounded-md border border-border">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[10rem_1fr_1fr_6rem_8rem] gap-2 bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                    <span>时间</span>
                    <span>用户</span>
                    <span>配置</span>
                    <span className="text-right">token</span>
                    <span className="text-right">估算费用</span>
                  </div>
                  {usage.recent.map((event) => (
                    <div
                      key={event.id}
                      className="grid grid-cols-[10rem_1fr_1fr_6rem_8rem] gap-2 border-t border-border px-3 py-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                      <span className="truncate">{event.username}</span>
                      <span className="truncate">{event.profileName || event.profileId}</span>
                      <span className="text-right tabular-nums">
                        {formatCount(event.totalTokens)}
                      </span>
                      <span className="truncate text-right tabular-nums">
                        {formatCosts({ [event.currency]: event.costMicros })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </PanelScaffold>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input
        value={value}
        type={typeof value === 'number' ? 'number' : 'text'}
        min={typeof value === 'number' ? 0 : undefined}
        step={typeof value === 'number' ? 'any' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-xs"
      />
    </label>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums" title={value}>
        {value}
      </p>
    </div>
  )
}

function UsageTable({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    key: string
    label: string
    requests: number
    tokens: number
    costs: Record<string, number>
  }>
}) {
  return (
    <div className="grid gap-2">
      <h4 className="text-xs font-semibold">{title}</h4>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] gap-2 bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          <span>名称</span>
          <span className="text-right">请求</span>
          <span className="text-right">token</span>
          <span className="text-right">估算费用</span>
        </div>
        {!rows.length && <p className="px-3 py-4 text-xs text-muted-foreground">暂无用量</p>}
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_8rem] gap-2 border-t border-border px-3 py-2 text-xs"
          >
            <span className="truncate" title={row.label}>
              {row.label}
            </span>
            <span className="text-right tabular-nums">{formatCount(row.requests)}</span>
            <span className="text-right tabular-nums">{formatCount(row.tokens)}</span>
            <span className="truncate text-right tabular-nums" title={formatCosts(row.costs)}>
              {formatCosts(row.costs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
