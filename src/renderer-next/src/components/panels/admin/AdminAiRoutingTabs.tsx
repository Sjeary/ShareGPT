import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Languages,
  Loader2,
  Network,
  Plus,
  RotateCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import type { AdminTranslationProfile, AiServiceKind } from '@/types/admin'

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

const SERVICES: Array<{ key: AiServiceKind; label: string }> = [
  { key: 'gpt', label: 'ChatGPT' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
]

export function AdminAiUsageTab() {
  const report = useIntegratedAdminStore((s) => s.aiUsage)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.aiUsage))
  const loadAiUsage = useIntegratedAdminStore((s) => s.loadAiUsage)

  const [service, setService] = useState<AiServiceKind>('gpt')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  function fetchUsage(nextService = service) {
    void loadAiUsage({ service: nextService, from: from || undefined, to: to || undefined }).catch(
      (err) => toast.error(errMsg(err, '加载 AI 使用统计失败')),
    )
  }

  const current = report?.service === service ? report : null

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {SERVICES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setService(item.key)
                fetchUsage(item.key)
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                service === item.key
                  ? 'bg-card text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <span className="text-xs text-muted-foreground">至</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-36 text-xs"
          />
          <Button size="sm" variant="outline" disabled={loading} onClick={() => fetchUsage()}>
            {loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
            查询
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-1">
            <span className="text-xs text-muted-foreground">成功发送总次数</span>
          </CardHeader>
          <CardContent className="px-4">
            <p className="tabular-nums text-2xl font-semibold">
              {current ? `${current.totalQueries} 次` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-1">
            <span className="text-xs text-muted-foreground">活跃成员数</span>
          </CardHeader>
          <CardContent className="px-4">
            <p className="tabular-nums text-2xl font-semibold">
              {current ? `${current.userCount} 人` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" />
            成员使用排行
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {!current || current.users.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无该区间的使用记录</p>
          ) : (
            current.users.map((u, idx) => (
              <div key={u.username} className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    #{idx + 1} {u.displayName || u.username} · @{u.username}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {u.count} 次 ({Math.round((u.ratio || 0) * 100)}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, Math.round((u.ratio || 0) * 100))}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function AdminRoutingTab() {
  const bootstrap = useIntegratedAdminStore((s) => s.bootstrap)
  const bootstrapLoaded = useIntegratedAdminStore((s) => Boolean(s.loaded.bootstrap))
  const routes = useIntegratedAdminStore((s) => s.proxyRoutes)
  const health = useIntegratedAdminStore((s) => s.proxyRouteHealth)
  const loadBootstrap = useIntegratedAdminStore((s) => s.loadBootstrap)
  const saveBootstrap = useIntegratedAdminStore((s) => s.saveBootstrap)
  const saveProxyRoutes = useIntegratedAdminStore((s) => s.saveProxyRoutes)
  const checkHealth = useIntegratedAdminStore((s) => s.checkProxyRouteHealth)

  useEffect(() => {
    if (!bootstrapLoaded) {
      void loadBootstrap().catch(() => undefined)
    }
  }, [bootstrapLoaded, loadBootstrap])

  const [savingDefault, setSavingDefault] = useState(false)
  const [savingRoutes, setSavingRoutes] = useState(false)
  const [draftDefaults, setDraftDefaults] = useState<Record<AiServiceKind, string> | null>(null)
  const [routesJson, setRoutesJson] = useState<string | null>(null)

  const defaults: Record<AiServiceKind, string> = draftDefaults ?? {
    gpt: bootstrap?.aiRouting?.defaultRouteByKind?.gpt || '',
    claude: bootstrap?.aiRouting?.defaultRouteByKind?.claude || '',
    gemini: bootstrap?.aiRouting?.defaultRouteByKind?.gemini || '',
  }

  async function handleSaveDefaults() {
    if (!bootstrap) return
    setSavingDefault(true)
    try {
      const saved = await saveBootstrap({
        ...bootstrap,
        aiRouting: {
          version: 1,
          defaultRouteByKind: defaults,
          updatedAt: new Date().toISOString(),
        },
      })
      if (saved) {
        setDraftDefaults(null)
        toast.success('已保存各 AI 默认出口策略')
      }
    } catch (err) {
      toast.error(errMsg(err, '保存默认出口失败'))
    } finally {
      setSavingDefault(false)
    }
  }

  async function handleSaveRoutesJson() {
    if (routesJson === null) return
    let parsed: unknown
    try {
      parsed = JSON.parse(routesJson)
    } catch {
      toast.error('线路目录 JSON 格式有误')
      return
    }
    if (!Array.isArray(parsed)) {
      toast.error('线路目录必须是 JSON 数组')
      return
    }
    setSavingRoutes(true)
    try {
      const saved = await saveProxyRoutes(parsed)
      if (saved) {
        setRoutesJson(null)
        toast.success(`已保存 ${saved.length} 条代理线路`)
      }
    } catch (err) {
      toast.error(errMsg(err, '保存线路目录失败'))
    } finally {
      setSavingRoutes(false)
    }
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4 text-primary" />各 AI 默认出口
          </CardTitle>
          <CardDescription>为 ChatGPT / Claude / Gemini 指定默认代理线路。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {SERVICES.map((item) => (
            <div key={item.key} className="grid gap-1.5">
              <Label>{item.label}</Label>
              <select
                disabled={!bootstrap || savingDefault}
                value={defaults[item.key]}
                onChange={(e) => setDraftDefaults({ ...defaults, [item.key]: e.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
              >
                <option value="">跟随团队统一代理</option>
                <option value="internal-unified">内置统一出口</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="sm:col-span-3">
            <Button
              size="sm"
              disabled={!bootstrap || savingDefault}
              onClick={() => void handleSaveDefaults()}
            >
              {savingDefault ? <Loader2 className="animate-spin" /> : <Save />}
              保存默认出口
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">代理线路目录 ({routes.length})</CardTitle>
            <CardDescription>查看线路启用状态，或直接编辑 JSON 维护线路配置。</CardDescription>
          </div>
          {routesJson === null ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setRoutesJson(JSON.stringify(routes, null, 2))}
            >
              编辑 JSON
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setRoutesJson(null)}>
                取消
              </Button>
              <Button size="xs" disabled={savingRoutes} onClick={() => void handleSaveRoutesJson()}>
                保存线路
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {routesJson !== null ? (
            <textarea
              value={routesJson}
              onChange={(e) => setRoutesJson(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : routes.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">暂未配置独立代理线路</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {routes.map((route) => (
                <div
                  key={route.id}
                  className="rounded-lg border border-border/80 bg-background/50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{route.name}</span>
                    <Badge
                      variant={route.enabled ? 'outline' : 'secondary'}
                      className="text-[10px]"
                    >
                      {route.enabled ? '已启用' : '已停用'}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    ID: {route.id}
                    {route.expected?.countryCode ? ` · ${route.expected.countryCode}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              客户端线路健康上报 ({health.length})
            </CardTitle>
            <CardDescription>汇总各成员客户端上报的最近出口检测结果。</CardDescription>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void checkHealth().catch((e) => toast.error(errMsg(e, '刷新健康报告失败')))
            }
          >
            <RotateCw className="size-3" />
            刷新上报
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2">
          {health.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">暂无客户端上报记录</p>
          ) : (
            health.slice(0, 20).map((item, idx) => (
              <div
                key={`${item.username}-${item.routeId}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  {item.ok ? (
                    <CheckCircle2 className="size-3.5 text-success" />
                  ) : (
                    <XCircle className="size-3.5 text-destructive" />
                  )}
                  <span className="font-medium">@{item.username}</span>
                  <span className="font-mono text-muted-foreground">{item.routeId}</span>
                </div>
                <span className="text-muted-foreground">
                  {item.ip || '—'} {item.countryCode ? `(${item.countryCode})` : ''}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function AdminTranslationTab() {
  const catalog = useIntegratedAdminStore((s) => s.translationCatalog)
  const usage = useIntegratedAdminStore((s) => s.translationUsage)
  const saveProfile = useIntegratedAdminStore((s) => s.saveTranslationProfile)
  const deleteProfile = useIntegratedAdminStore((s) => s.deleteTranslationProfile)
  const loadUsage = useIntegratedAdminStore((s) => s.loadTranslationUsage)

  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAddProfile() {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error('请填写配置名称与接口地址')
      return
    }
    setSaving(true)
    try {
      const profile: AdminTranslationProfile = {
        id: `tp-${Date.now().toString(36)}`,
        name: name.trim(),
        type: 'ai',
        baseUrl: baseUrl.trim(),
        model: model.trim() || 'gpt-4o-mini',
        effort: 'none',
        enabled: true,
        accessMode: 'all',
        allowedUsernames: [],
        pricing: { currency: 'USD', inputPerMillion: 0, outputPerMillion: 0, perRequest: 0 },
        apiKeyConfigured: Boolean(apiKey.trim()),
        apiKeyHint: '',
        usesPlainHttp: /^http:\/\//i.test(baseUrl.trim()),
        apiKey: apiKey.trim() || undefined,
      }
      const saved = await saveProfile(profile, !catalog?.defaultProfileId)
      if (saved) {
        toast.success(`已保存翻译配置「${profile.name}」`)
        setName('')
        setBaseUrl('')
        setModel('')
        setApiKey('')
      }
    } catch (err) {
      toast.error(errMsg(err, '保存翻译配置失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="size-4 text-primary" />
            团队托管翻译配置 ({catalog?.profiles.length ?? 0})
          </CardTitle>
          <CardDescription>
            {catalog?.encryptionReady === false
              ? '服务端尚未配置加密主密钥，保存新密钥可能受限。'
              : '管理员统一配置翻译服务，成员客户端无需各自填写 API Key。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(catalog?.profiles ?? []).map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/50 p-3 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  {catalog?.defaultProfileId === p.id && (
                    <Badge className="text-[10px]">默认</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {p.model || p.type}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {p.baseUrl} ·{' '}
                  {p.apiKeyConfigured ? `密钥已配置 (${p.apiKeyHint || '***'})` : '未设密钥'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(enabled) =>
                    void saveProfile({ ...p, enabled })
                      .then(() => toast.success('已更新配置状态'))
                      .catch((e) => toast.error(errMsg(e, '更新失败')))
                  }
                />
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    void deleteProfile(p.id)
                      .then(() => toast.success('已删除配置'))
                      .catch((e) => toast.error(errMsg(e, '删除失败')))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <div className="grid gap-2 rounded-xl border border-dashed border-border p-3.5 sm:grid-cols-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="配置名称（如：团队主力翻译）"
              className="h-8 text-xs"
            />
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="模型名（如：gpt-4o-mini）"
              className="h-8 text-xs"
            />
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="接口 Base URL（https://...）"
              className="h-8 text-xs"
            />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key（服务端加密存储）"
              className="h-8 text-xs"
            />
            <div className="sm:col-span-2">
              <Button size="xs" disabled={saving} onClick={() => void handleAddProfile()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                添加翻译配置
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">翻译用量统计</CardTitle>
            <CardDescription>按需拉取团队托管翻译请求与 Token 消耗。</CardDescription>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void loadUsage().catch((e) => toast.error(errMsg(e, '加载翻译用量失败')))
            }
          >
            <RotateCw className="size-3" />
            加载用量
          </Button>
        </CardHeader>
        <CardContent>
          {!usage ? (
            <p className="py-4 text-center text-xs text-muted-foreground">点击右上角加载翻译用量</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-lg border border-border p-3">
                <p className="text-muted-foreground">总请求数</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">{usage.totals.requests}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-muted-foreground">输入字符</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">{usage.totals.inputChars}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-muted-foreground">总 Tokens</p>
                <p className="mt-1 tabular-nums text-lg font-semibold">
                  {usage.totals.totalTokens}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
