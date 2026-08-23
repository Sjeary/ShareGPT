import { useState } from 'react'
import { Network, Plus, RefreshCw, Route, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { BUILTIN_AI_ROUTES, createAiEnvironmentId, createAiRouteId } from '@/lib/aiEnvironments'
import type { AiKind } from '@/store/useAiStore'
import type { AdvancedAiEnvironment, AdvancedAiRoute, AdvancedAiSettings } from '@/types/settings'
import { toast } from 'sonner'

const KIND_LABEL: Record<AiKind, string> = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }

interface Props {
  kind: AiKind
  settings: AdvancedAiSettings
  onChange: (settings: AdvancedAiSettings) => Promise<void>
  onClose: () => void
}

export function AiEnvironmentPanel({ kind, settings, onChange, onClose }: Props) {
  const [environmentName, setEnvironmentName] = useState('')
  const [routeName, setRouteName] = useState('')
  const [routePort, setRoutePort] = useState('')
  const [checkingId, setCheckingId] = useState('')
  const environments = settings.environments.filter((environment) => environment.kind === kind)
  const routes = [...BUILTIN_AI_ROUTES, ...settings.routes]

  async function addEnvironment() {
    const name = environmentName.trim() || `${KIND_LABEL[kind]} 环境 ${environments.length + 1}`
    const environment: AdvancedAiEnvironment = {
      id: createAiEnvironmentId(),
      kind,
      name: name.slice(0, 60),
      routeId: 'sender',
      createdAt: new Date().toISOString(),
    }
    const next = {
      ...settings,
      environments: [...settings.environments, environment],
      activeByKind: { ...settings.activeByKind, [kind]: environment.id },
    }
    await onChange(next)
    setEnvironmentName('')
  }

  async function patchEnvironment(id: string, patch: Partial<AdvancedAiEnvironment>) {
    await onChange({
      ...settings,
      environments: settings.environments.map((environment) =>
        environment.id === id ? { ...environment, ...patch } : environment,
      ),
    })
  }

  async function removeEnvironment(environment: AdvancedAiEnvironment) {
    if (!window.confirm(`删除“${environment.name}”并清除其中的登录状态？此操作无法撤销。`)) return
    try {
      await api.deleteAiEnvironment({ kind, environmentId: environment.id })
      const remaining = settings.environments.filter((item) => item.id !== environment.id)
      const nextActive = remaining.find((item) => item.kind === kind)?.id || ''
      await onChange({
        ...settings,
        environments: remaining,
        activeByKind: { ...settings.activeByKind, [kind]: nextActive },
      })
      toast.success('环境及其登录状态已清除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除环境失败')
    }
  }

  async function addRoute() {
    const name = routeName.trim()
    const port = Number(routePort)
    if (!name) {
      toast.error('请输入线路名称')
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error('请输入有效的本机 SOCKS5 端口')
      return
    }
    const route: AdvancedAiRoute = {
      id: createAiRouteId(),
      name: name.slice(0, 60),
      mode: 'socks5',
      host: '127.0.0.1',
      port,
    }
    await onChange({ ...settings, routes: [...settings.routes, route] })
    setRouteName('')
    setRoutePort('')
  }

  async function removeRoute(route: AdvancedAiRoute) {
    const nextEnvironments = settings.environments.map((environment) =>
      environment.routeId === route.id ? { ...environment, routeId: 'sender' } : environment,
    )
    await onChange({
      ...settings,
      routes: settings.routes.filter((item) => item.id !== route.id),
      environments: nextEnvironments,
    })
  }

  async function checkEnvironment(environment: AdvancedAiEnvironment) {
    setCheckingId(environment.id)
    try {
      const result = (await api.checkAiEnvironmentEgress({
        kind,
        environmentId: environment.id,
      })) as { ip?: string; country?: string; region?: string; route?: string }
      toast.success(
        [result.route, result.ip, result.country, result.region].filter(Boolean).join(' · ') ||
          '线路检测完成',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '线路检测失败')
    } finally {
      setCheckingId('')
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <Network className="size-4 text-primary" />
        <span className="text-sm font-semibold">{KIND_LABEL[kind]} 环境</span>
        <Badge variant="outline">{environments.length}</Badge>
        <Button variant="ghost" size="icon-xs" className="ml-auto" title="收起" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="grid gap-2">
        {environments.map((environment) => (
          <div key={environment.id} className="flex min-w-0 items-center gap-2">
            <Input
              defaultValue={environment.name}
              aria-label="环境名称"
              className="h-8 min-w-28 flex-1"
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== environment.name)
                  void patchEnvironment(environment.id, { name })
              }}
            />
            <select
              value={environment.routeId}
              aria-label="网络线路"
              className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                void patchEnvironment(environment.id, { routeId: event.target.value })
              }
            >
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon-sm"
              title="检测出口"
              disabled={checkingId === environment.id}
              onClick={() => void checkEnvironment(environment)}
            >
              <RefreshCw className={checkingId === environment.id ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="删除环境"
              onClick={() => void removeEnvironment(environment)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={environmentName}
            onChange={(event) => setEnvironmentName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addEnvironment()
            }}
            placeholder={`${KIND_LABEL[kind]} 新环境名称`}
            className="h-8 min-w-0 flex-1"
          />
          <Button size="sm" variant="outline" onClick={() => void addEnvironment()}>
            <Plus />
            新建环境
          </Button>
        </div>
      </div>

      <div className="my-3 h-px bg-border" />

      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Route className="size-4 text-muted-foreground" />
        本机 SOCKS5 线路
      </div>
      {settings.routes.length > 0 && (
        <div className="mb-2 grid gap-1">
          {settings.routes.map((route) => (
            <div key={route.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{route.name}</span>
              <code className="text-xs text-muted-foreground">127.0.0.1:{route.port}</code>
              <Button
                variant="ghost"
                size="icon-xs"
                title="删除线路"
                onClick={() => void removeRoute(route)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={routeName}
          onChange={(event) => setRouteName(event.target.value)}
          placeholder="线路名称"
          className="h-8 min-w-0 flex-1"
        />
        <Input
          value={routePort}
          onChange={(event) => setRoutePort(event.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          placeholder="端口"
          className="h-8 w-24"
        />
        <Button size="sm" variant="outline" onClick={() => void addRoute()}>
          <Plus />
          添加线路
        </Button>
      </div>
    </div>
  )
}
