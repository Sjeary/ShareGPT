import { useState } from 'react'
import { Network, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { createAiEnvironmentId } from '@/lib/aiEnvironments'
import type { AiKind } from '@/store/useAiStore'
import type { AdvancedAiEnvironment, AdvancedAiRoute, AdvancedAiSettings } from '@/types/settings'
import { toast } from 'sonner'

const KIND_LABEL: Record<AiKind, string> = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }

interface Props {
  kind: AiKind
  settings: AdvancedAiSettings
  routes: AdvancedAiRoute[]
  onChange: (settings: AdvancedAiSettings) => Promise<void>
  onClose: () => void
}

export function AiEnvironmentPanel({ kind, settings, routes, onChange, onClose }: Props) {
  const [environmentName, setEnvironmentName] = useState('')
  const [checkingId, setCheckingId] = useState('')
  const environments = settings.environments.filter((environment) => environment.kind === kind)

  async function addEnvironment() {
    const routeId = routes[0]?.id
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
        <Badge variant="secondary">内置 sing-box</Badge>
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
              value={
                routes.some((route) => route.id === environment.routeId)
                  ? environment.routeId
                  : routes[0]?.id || ''
              }
              aria-label="内置网络线路"
              className="h-8 min-w-44 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={!routes.length}
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
              disabled={checkingId === environment.id || !routes.length}
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
          <Button
            size="sm"
            variant="outline"
            disabled={!routes.length}
            onClick={() => void addEnvironment()}
          >
            <Plus />
            新建环境
          </Button>
        </div>
      </div>
    </div>
  )
}
