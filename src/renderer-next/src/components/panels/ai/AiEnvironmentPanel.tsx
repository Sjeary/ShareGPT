import { useState } from 'react'
import { CheckCircle2, Network, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { createAiEnvironmentId } from '@/lib/aiEnvironments'
import { normalizeEnvironmentNameDraft } from '@/lib/environmentName'
import type { AiKind } from '@/store/useAiStore'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import type {
  AdvancedAiEnvironment,
  AdvancedAiRoute,
  AdvancedAiSettings,
  AppSettings,
} from '@/types/settings'
import { toast } from 'sonner'

const KIND_LABEL: Record<AiKind, string> = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }
type RouteHealth = {
  ok: boolean
  routeId?: string
  routeFingerprint?: string
  configKey?: string
  ip?: string
  countryCode?: string
  asn?: string
  checks?: Record<string, 'passed' | 'failed' | 'not-checked'>
}

interface Props {
  kind: AiKind
  settings: AdvancedAiSettings
  routes: AdvancedAiRoute[]
  onChange: (settings: AdvancedAiSettings) => Promise<void>
  onClose: () => void
}

export function AiEnvironmentPanel({ kind, settings, routes, onChange, onClose }: Props) {
  const serverUrl = useAppStore((state) => state.settings?.collab?.server_url || '')
  const token = useAuthStore((state) => state.token)
  const [environmentName, setEnvironmentName] = useState('')
  const [newRouteId, setNewRouteId] = useState('')
  const [checkingId, setCheckingId] = useState('')
  const [savingId, setSavingId] = useState('')
  const [adding, setAdding] = useState(false)
  const [healthById, setHealthById] = useState<Record<string, RouteHealth>>({})
  const environments = settings.environments.filter((environment) => environment.kind === kind)
  const selectedNewRouteId = routes.some((route) => route.id === newRouteId)
    ? newRouteId
    : routes[0]?.id || ''

  async function addEnvironment() {
    const routeId = selectedNewRouteId
    if (!routeId) {
      toast.error('当前没有可用的内置 sing-box 线路')
      return
    }
    const name = environmentName.trim() || `${KIND_LABEL[kind]} 环境 ${environments.length + 1}`
    const environment: AdvancedAiEnvironment = {
      id: createAiEnvironmentId(),
      kind,
      name: name.slice(0, 60),
      routeId,
      createdAt: new Date().toISOString(),
    }
    await onChange({
      ...settings,
      environments: [...settings.environments, environment],
      activeByKind: { ...settings.activeByKind, [kind]: environment.id },
    })
    setEnvironmentName('')
    setAdding(false)
  }

  async function patchEnvironment(id: string, patch: Partial<AdvancedAiEnvironment>) {
    setSavingId(id)
    if (typeof patch.routeId === 'string') {
      setHealthById((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
    try {
      await onChange({
        ...settings,
        environments: settings.environments.map((environment) =>
          environment.id === id ? { ...environment, ...patch } : environment,
        ),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存环境失败')
      throw error
    } finally {
      setSavingId('')
    }
  }

  async function removeEnvironment(environment: AdvancedAiEnvironment) {
    if (!window.confirm(`删除“${environment.name}”并清除其中的登录状态？此操作无法撤销。`)) return
    try {
      setSavingId(environment.id)
      const result = (await api.deleteAiEnvironment({
        kind,
        environmentId: environment.id,
      })) as { settings?: AppSettings; dataCleared?: boolean }
      if (result.settings) {
        useAppStore.setState({ settings: result.settings })
      }
      if (result.dataCleared === false) {
        toast.warning('环境配置已删除；登录数据将在下次启动时再次清理')
      } else {
        toast.success('环境及其登录状态已清除')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除环境失败')
    } finally {
      setSavingId('')
    }
  }

  async function checkEnvironment(environment: AdvancedAiEnvironment) {
    setCheckingId(environment.id)
    try {
      const result = (await api.checkAiEnvironmentEgress({
        kind,
        environmentId: environment.id,
      })) as RouteHealth & { route?: string }
      const currentRoute = routes.find((route) => route.id === environment.routeId)
      const currentResult = { ...result, configKey: currentRoute?.configKey }
      setHealthById((current) => ({ ...current, [environment.id]: currentResult }))
      if (serverUrl && token && result.routeId) {
        void fetch(`${serverUrl.replace(/\/+$/, '')}/api/client/proxy-route-health`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(currentResult),
        }).catch(() => undefined)
      }
      if (result.ok) toast.success([result.route, result.ip].filter(Boolean).join(' · '))
      else toast.error('出口预期或防泄漏校验不一致，已阻止使用该线路')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '线路检测失败')
    } finally {
      setCheckingId('')
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="flex h-11 items-center gap-2 border-b border-border/70 px-4">
        <Network className="size-4 text-primary" />
        <span className="text-sm font-semibold">{KIND_LABEL[kind]} 环境</span>
        <span className="text-xs text-muted-foreground">{environments.length} 个</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="xs"
            variant={adding ? 'secondary' : 'outline'}
            onClick={() => setAdding((open) => !open)}
          >
            <Plus />
            新建
          </Button>
          <Button variant="ghost" size="icon-xs" title="收起" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto px-4 py-2">
        {!!environments.length && (
          <div className="hidden grid-cols-[minmax(140px,1fr)_minmax(150px,220px)_72px] gap-2 px-2 pb-1 text-[11px] font-medium text-muted-foreground sm:grid">
            <span>环境</span>
            <span>内置线路</span>
            <span className="text-right">操作</span>
          </div>
        )}
        <div className="grid gap-1">
          {environments.map((environment) => (
            <div
              key={environment.id}
              className="grid gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/45"
            >
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(140px,1fr)_minmax(150px,220px)_72px]">
                <EnvironmentNameInput
                  key={`${environment.id}:${environment.name}`}
                  environment={environment}
                  disabled={savingId === environment.id}
                  onSave={(name) => patchEnvironment(environment.id, { name })}
                />
                <select
                  value={
                    routes.some((route) => route.id === environment.routeId)
                      ? environment.routeId
                      : ''
                  }
                  aria-label="内置网络线路"
                  className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none hover:border-input focus-visible:border-input focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={!routes.length || savingId === environment.id}
                  onChange={(event) =>
                    void patchEnvironment(environment.id, { routeId: event.target.value }).catch(
                      () => undefined,
                    )
                  }
                >
                  {!routes.some((route) => route.id === environment.routeId) && (
                    <option value="" disabled>
                      原线路不可用，请重新选择
                    </option>
                  )}
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
                </select>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="检测出口"
                    disabled={
                      checkingId === environment.id ||
                      savingId === environment.id ||
                      !routes.some((route) => route.id === environment.routeId)
                    }
                    onClick={() => void checkEnvironment(environment)}
                  >
                    <RefreshCw className={checkingId === environment.id ? 'animate-spin' : ''} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="删除环境"
                    disabled={savingId === environment.id}
                    onClick={() => void removeEnvironment(environment)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {healthById[environment.id]?.routeId === environment.routeId &&
                healthById[environment.id]?.configKey ===
                  routes.find((route) => route.id === environment.routeId)?.configKey && (
                  <RouteHealthRow health={healthById[environment.id]} />
                )}
            </div>
          ))}

          {!environments.length && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-16 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="size-4" />
              新建第一个独立环境
            </button>
          )}

          {adding && (
            <div className="mt-1 grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[minmax(140px,1fr)_minmax(150px,220px)_auto]">
              <Input
                value={environmentName}
                onChange={(event) => setEnvironmentName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addEnvironment()
                }}
                placeholder={`${KIND_LABEL[kind]} 新环境名称`}
                className="h-8 min-w-0"
              />
              <select
                value={selectedNewRouteId}
                aria-label="新环境内置网络线路"
                className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={!routes.length}
                onChange={(event) => setNewRouteId(event.target.value)}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!routes.length} onClick={() => void addEnvironment()}>
                <CheckCircle2 />
                完成
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EnvironmentNameInput({
  environment,
  disabled,
  onSave,
}: {
  environment: AdvancedAiEnvironment
  disabled: boolean
  onSave: (name: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(environment.name)

  const commit = async () => {
    const committedName = environment.name
    const name = normalizeEnvironmentNameDraft(draft, committedName)
    if (name === committedName) {
      setDraft(committedName)
      return
    }
    setDraft(name)
    try {
      await onSave(name)
    } catch {
      setDraft(environment.name)
    }
  }

  return (
    <Input
      value={draft}
      maxLength={60}
      disabled={disabled}
      aria-label="环境名称"
      className="h-8 min-w-0 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus:border-input focus:bg-background"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(environment.name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function RouteHealthRow({ health }: { health: RouteHealth }) {
  const checks = health.checks || {}
  const items = [
    ['HTTP 双源', checks.httpCrossCheck],
    ['预期 IP', checks.expectedIp],
    ['预期国家', checks.expectedCountry],
    ['预期 ASN', checks.expectedAsn],
    ['DNS 路由配置', checks.dnsConfigured],
    ['观察到 IPv4 出口', checks.ipv4EgressObserved],
    ['WebRTC 策略', checks.webRtcPolicyApplied],
  ] as const
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 px-1 pt-1.5 text-[11px] text-muted-foreground">
      <span className={health.ok ? 'text-emerald-500' : 'text-destructive'}>
        {health.ip || '未识别出口'}
        {health.countryCode ? ` · ${health.countryCode}` : ''}
        {health.asn ? ` · ${health.asn}` : ''}
      </span>
      {items.map(([label, result]) => (
        <span
          key={label}
          className={
            result === 'passed'
              ? 'text-emerald-500'
              : result === 'failed'
                ? 'text-destructive'
                : 'text-muted-foreground'
          }
        >
          {result === 'passed' ? '通过' : result === 'failed' ? '失败' : '未检测'} · {label}
        </span>
      ))}
    </div>
  )
}
