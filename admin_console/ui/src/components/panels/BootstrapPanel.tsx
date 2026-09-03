import { useEffect, useState, type ReactNode } from 'react'
import { Cable, RotateCw, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'
import type { Bootstrap } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

const EMPTY_SENDER = {
  proxy_server: '',
  proxy_port: '',
  proxy_uuid: '',
  socks_listen_port: '1080',
  fallback_mode: 'system_proxy',
  fallback_local_port: '',
  target_domains: '',
}

const EMPTY_ROUTE_DEFAULTS = { gpt: '', gemini: '', claude: '' }
const AI_LABELS = { gpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' } as const

export function BootstrapPanel() {
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const loadBootstrap = useAdminStore((s) => s.loadBootstrap)
  const saveBootstrap = useAdminStore((s) => s.saveBootstrap)
  const proxyRoutes = useAdminStore((s) => s.proxyRoutes)
  const loadProxyRoutes = useAdminStore((s) => s.loadProxyRoutes)

  const [form, setForm] = useState({ ...EMPTY_SENDER })
  const [routeDefaults, setRouteDefaults] = useState({ ...EMPTY_ROUTE_DEFAULTS })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  // bootstrap 变化(载入/保存)时回填表单; 编辑期间 bootstrap 不变, 不会覆盖输入。
  useEffect(() => {
    const sender = bootstrap?.sender || {}
    setForm({
      proxy_server: String(sender.proxy_server || ''),
      proxy_port: String(sender.proxy_port || ''),
      proxy_uuid: String(sender.proxy_uuid || ''),
      socks_listen_port: String(sender.socks_listen_port || '1080'),
      fallback_mode: String(sender.fallback_mode || 'system_proxy'),
      fallback_local_port: String(sender.fallback_local_port || ''),
      target_domains: String(sender.target_domains || ''),
    })
    setRouteDefaults({
      gpt: String(bootstrap?.aiRouting?.defaultRouteByKind?.gpt || ''),
      gemini: String(bootstrap?.aiRouting?.defaultRouteByKind?.gemini || ''),
      claude: String(bootstrap?.aiRouting?.defaultRouteByKind?.claude || ''),
    })
  }, [bootstrap])

  function patch(p: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...p }))
  }

  async function reload() {
    setLoading(true)
    try {
      await Promise.all([loadBootstrap(), loadProxyRoutes()])
      toast.success('已读取服务器端 Sender 默认配置。')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      const next: Bootstrap = {
        sender: { ...form },
        update: bootstrap?.update || {},
        aiRouting: {
          version: 1,
          defaultRouteByKind: routeDefaults,
          updatedAt: bootstrap?.aiRouting?.updatedAt || '',
        },
        extra: bootstrap?.extra || {},
      }
      await saveBootstrap(next)
      toast.success('Sender 默认配置已保存。')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const routeOptions = [
    ...(form.proxy_server.trim() && form.proxy_port.trim() && form.proxy_uuid.trim()
      ? [{ id: 'internal-unified', name: '内置统一代理' }]
      : []),
    ...proxyRoutes
      .filter((route) => route.enabled)
      .map((route) => ({ id: route.id, name: route.name })),
  ]

  return (
    <PanelScaffold
      icon={Cable}
      title="Sender 默认配置"
      hint="新用户首次登录成功后，会自动拉取这里的配置写入客户端"
      toolbar={
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void reload()}>
          <RotateCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          重新读取
        </Button>
      }
    >
      <div className="grid max-w-3xl gap-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">连接参数</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="服务器地址">
              <Input
                value={form.proxy_server}
                onChange={(e) => patch({ proxy_server: e.target.value })}
              />
            </Field>
            <Field label="连接端口">
              <Input
                value={form.proxy_port}
                onChange={(e) => patch({ proxy_port: e.target.value })}
              />
            </Field>
            <Field label="连接身份码">
              <Input
                value={form.proxy_uuid}
                onChange={(e) => patch({ proxy_uuid: e.target.value })}
              />
            </Field>
            <Field label="本地 SOCKS 端口">
              <Input
                value={form.socks_listen_port}
                onChange={(e) => patch({ socks_listen_port: e.target.value })}
              />
            </Field>
            <Field label="其他网站访问方式">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
                {(
                  [
                    { v: 'system_proxy', label: '走本机代理' },
                    { v: 'direct', label: '直接访问' },
                  ] as const
                ).map(({ v, label }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => patch({ fallback_mode: v })}
                    className={cn(
                      'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      form.fallback_mode === v
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="已有代理端口">
              <Input
                value={form.fallback_local_port}
                onChange={(e) => patch({ fallback_local_port: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">各 AI 默认线路</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(AI_LABELS) as Array<keyof typeof AI_LABELS>).map((kind) => (
              <Field key={kind} label={AI_LABELS[kind]}>
                <select
                  value={routeDefaults[kind]}
                  onChange={(event) =>
                    setRouteDefaults((current) => ({
                      ...current,
                      [kind]: event.target.value,
                    }))
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">沿用当前默认代理</option>
                  {!routeOptions.some((route) => route.id === routeDefaults[kind]) &&
                    routeDefaults[kind] && (
                      <option value={routeDefaults[kind]} disabled>
                        原线路不可用
                      </option>
                    )}
                  {routeOptions.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3">
              普通成员会直接跟随这里的线路；管理员和高级用户创建独立环境时优先采用该推荐，
              仍可在本人获授权的线路中调整。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">固定走代理的域名</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={form.target_domains}
              onChange={(e) => patch({ target_domains: e.target.value })}
              rows={6}
              placeholder="多个域名用英文逗号或换行分隔"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              此清单随首次登录下发给新用户的客户端。
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存 Sender 默认配置
          </Button>
        </div>
      </div>
    </PanelScaffold>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
