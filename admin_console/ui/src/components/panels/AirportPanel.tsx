import { useEffect, useMemo, useState } from 'react'
import { Network, Plus, RotateCw, Save, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useAdminStore } from '@/store/useAdminStore'
import type { ProxyRoute } from '@/types/admin'
import { parseClashProxies, clashNodeToSingbox, type ClashNode } from '@/lib/clash'
import { PanelScaffold } from './PanelScaffold'

const EMPTY_ROUTE_DEFAULTS = { gpt: '', gemini: '', claude: '' }
const AI_LABELS = { gpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' } as const

function newRouteId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
  return `route-${random || Date.now().toString(36)}`
}

export function AirportPanel() {
  const catalog = useAdminStore((s) => s.proxyRoutes)
  const loading = useAdminStore((s) => s.proxyRoutesLoading)
  const load = useAdminStore((s) => s.loadProxyRoutes)
  const health = useAdminStore((s) => s.proxyRouteHealth)
  const loadHealth = useAdminStore((s) => s.loadProxyRouteHealth)
  const save = useAdminStore((s) => s.saveProxyRoutes)
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const loadBootstrap = useAdminStore((s) => s.loadBootstrap)
  const saveBootstrap = useAdminStore((s) => s.saveBootstrap)
  const [routes, setRoutes] = useState<ProxyRoute[]>([])
  const [routeDefaults, setRouteDefaults] = useState({ ...EMPTY_ROUTE_DEFAULTS })
  const [text, setText] = useState('')
  const [nodes, setNodes] = useState<ClashNode[]>([])
  const [selected, setSelected] = useState(-1)
  const [saving, setSaving] = useState(false)
  const [routingSaving, setRoutingSaving] = useState(false)

  useEffect(() => {
    void Promise.all([
      load({ silent: true }),
      loadHealth({ silent: true }),
      loadBootstrap({ silent: true }),
    ])
  }, [load, loadHealth, loadBootstrap])
  useEffect(() => {
    setRoutes(catalog.map((route) => ({ ...route, expected: { ...route.expected } })))
  }, [catalog])
  useEffect(() => {
    setRouteDefaults({
      gpt: String(bootstrap?.aiRouting?.defaultRouteByKind?.gpt || ''),
      claude: String(bootstrap?.aiRouting?.defaultRouteByKind?.claude || ''),
      gemini: String(bootstrap?.aiRouting?.defaultRouteByKind?.gemini || ''),
    })
  }, [bootstrap?.aiRouting])

  const preview = useMemo(
    () => (selected >= 0 && nodes[selected] ? clashNodeToSingbox(nodes[selected]) : null),
    [selected, nodes],
  )
  const routeOptions = useMemo(() => {
    const sender = bootstrap?.sender || {}
    const unifiedReady = Boolean(
      String(sender.proxy_server || '').trim() &&
      String(sender.proxy_port || '').trim() &&
      String(sender.proxy_uuid || '').trim(),
    )
    return [
      ...(unifiedReady ? [{ id: 'internal-unified', name: '团队统一代理' }] : []),
      ...catalog
        .filter((route) => route.enabled)
        .map((route) => ({ id: route.id, name: route.name })),
    ]
  }, [bootstrap?.sender, catalog])

  function parseNodes() {
    const parsed = parseClashProxies(text)
    setNodes(parsed)
    setSelected(-1)
    if (!parsed.length) toast.error('未解析到节点，请确认内容包含 Clash proxies 列表')
    else toast.success(`解析到 ${parsed.length} 个节点`)
  }

  function addSelected() {
    const node = nodes[selected]
    const outbound = node ? clashNodeToSingbox(node) : null
    if (!node || !outbound) return
    setRoutes((current) => [
      ...current,
      {
        id: newRouteId(),
        name: node.name || '内置代理线路',
        enabled: true,
        outbound,
        expected: { ip: '', countryCode: '', asn: '' },
      },
    ])
    setSelected(-1)
    toast.success('已加入待下发线路，请检查出口预期后保存')
  }

  function patchRoute(id: string, patch: Partial<ProxyRoute>) {
    setRoutes((current) =>
      current.map((route) => (route.id === id ? { ...route, ...patch } : route)),
    )
  }

  async function saveCatalog() {
    setSaving(true)
    try {
      await save(routes)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function saveRouteDefaults() {
    const availableIds = new Set(routeOptions.map((route) => route.id))
    const unavailableKind = (Object.keys(AI_LABELS) as Array<keyof typeof AI_LABELS>).find(
      (kind) => routeDefaults[kind] && !availableIds.has(routeDefaults[kind]),
    )
    if (unavailableKind) {
      toast.error(`${AI_LABELS[unavailableKind]} 当前选择的线路已停用或不存在，请重新选择`)
      return
    }
    setRoutingSaving(true)
    try {
      await saveBootstrap({
        sender: bootstrap?.sender || {},
        update: bootstrap?.update || {},
        aiRouting: {
          version: 1,
          defaultRouteByKind: routeDefaults,
          updatedAt: bootstrap?.aiRouting?.updatedAt || '',
        },
        extra: bootstrap?.extra || {},
      })
      toast.success('各 AI 默认出口已保存并下发')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRoutingSaving(false)
    }
  }

  return (
    <PanelScaffold
      icon={Network}
      title="内置代理线路"
      hint="管理员维护 sing-box 线路目录并按用户授权；客户端只能选择获准线路"
      toolbar={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([load(), loadHealth(), loadBootstrap()])}
            disabled={loading}
          >
            <RotateCw className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
          <Button size="sm" onClick={() => void saveCatalog()} disabled={saving}>
            <Save />
            {saving ? '下发中' : '保存并下发'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto grid max-w-4xl gap-6 p-6">
        <section className="grid gap-4 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">各 AI 默认出口</h3>
              <p className="text-xs text-muted-foreground">
                为 ChatGPT、Claude 和 Gemini 分别指定团队推荐线路。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={routingSaving}
              onClick={() => void saveRouteDefaults()}
            >
              <Save />
              {routingSaving ? '保存中' : '保存默认出口'}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(AI_LABELS) as Array<keyof typeof AI_LABELS>).map((kind) => (
              <ExpectedField
                key={kind}
                label={AI_LABELS[kind]}
                value={routeDefaults[kind]}
                options={routeOptions}
                onChange={(value) => setRouteDefaults((current) => ({ ...current, [kind]: value }))}
              />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            普通成员直接跟随这里的设置；管理员和高级用户创建独立环境时优先采用该线路，
            仍可在本人获授权的线路中调整。线路配置和成员授权分别在本页下方与“成员与权限”中维护。
          </p>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">线路目录</h3>
              <p className="text-xs text-muted-foreground">
                稳定 ID 绑定账号环境；启停或排序不会改绑。
              </p>
            </div>
            <Badge variant="outline">{routes.length} 条</Badge>
          </div>
          {!routes.length && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              尚未配置托管线路。统一代理仍由发送端配置单独提供。
            </div>
          )}
          {routes.map((route) => (
            <div key={route.id} className="grid gap-3 rounded-md border border-border p-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={route.enabled}
                  onCheckedChange={(enabled) => patchRoute(route.id, { enabled })}
                />
                <Input
                  value={route.name}
                  onChange={(event) => patchRoute(route.id, { name: event.target.value })}
                  className="min-w-0 flex-1"
                  aria-label="线路名称"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title="删除线路"
                  onClick={() =>
                    setRoutes((current) => current.filter((item) => item.id !== route.id))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <ExpectedField
                  label="预期出口 IP"
                  value={route.expected?.ip || ''}
                  placeholder="203.0.113.7"
                  onChange={(ip) => patchRoute(route.id, { expected: { ...route.expected, ip } })}
                />
                <ExpectedField
                  label="国家代码"
                  value={route.expected?.countryCode || ''}
                  placeholder="US"
                  maxLength={2}
                  onChange={(countryCode) =>
                    patchRoute(route.id, {
                      expected: { ...route.expected, countryCode: countryCode.toUpperCase() },
                    })
                  }
                />
                <ExpectedField
                  label="预期 ASN"
                  value={route.expected?.asn || ''}
                  placeholder="可选"
                  onChange={(asn) => patchRoute(route.id, { expected: { ...route.expected, asn } })}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>ID: {route.id}</span>
                <span>{String(route.outbound.type || '?')}</span>
                <span>
                  {String(route.outbound.server || '')}:{String(route.outbound.server_port || '')}
                </span>
              </div>
              <div className="grid gap-1 border-t border-border/60 pt-2">
                <span className="text-xs font-medium">最近客户端线路预检</span>
                <span className="text-xs text-muted-foreground">
                  客户端上报的出口预检结果，不代表服务器已验证网页会话无泄漏。
                </span>
                {!health.some((report) => report.routeId === route.id) && (
                  <span className="text-xs text-muted-foreground">暂无上报</span>
                )}
                {health
                  .filter((report) => report.routeId === route.id)
                  .slice(0, 3)
                  .map((report) => (
                    <div
                      key={`${report.username}-${report.checkedAt}`}
                      className="flex flex-wrap items-center gap-x-3 text-xs"
                    >
                      <span className={report.ok ? 'text-emerald-500' : 'text-destructive'}>
                        {report.ok ? '通过' : '失败'}
                      </span>
                      <span>{report.username}</span>
                      <span className="text-muted-foreground">
                        {report.ip || '未知 IP'}
                        {report.countryCode ? ` · ${report.countryCode}` : ''}
                        {report.asn ? ` · ${report.asn}` : ''}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(report.checkedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-3 border-t border-border pt-5">
          <div>
            <h3 className="text-sm font-semibold">导入 Clash 节点</h3>
            <p className="text-xs text-muted-foreground">
              订阅内容只在管理端解析；客户端不会看到导入入口。
            </p>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={6}
            placeholder="粘贴包含 proxies: 的 Clash YAML"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div>
            <Button size="sm" variant="outline" onClick={parseNodes} disabled={!text.trim()}>
              <UploadCloud />
              解析节点
            </Button>
          </div>
          {!!nodes.length && (
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              {nodes.map((node, index) => (
                <button
                  key={`${node.name}-${index}`}
                  type="button"
                  disabled={!node.supported}
                  onClick={() => setSelected(index)}
                  className={`flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 disabled:opacity-40 ${selected === index ? 'bg-primary/10' : 'hover:bg-accent/40'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <Badge variant="outline">{node.type || '?'}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {node.server}:{node.port}
                  </span>
                </button>
              ))}
            </div>
          )}
          {preview && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={addSelected}>
                <Plus />
                加入线路目录
              </Button>
              <span className="truncate text-xs text-muted-foreground">
                {nodes[selected]?.name}
              </span>
            </div>
          )}
        </section>
      </div>
    </PanelScaffold>
  )
}

function ExpectedField({
  label,
  value,
  placeholder,
  maxLength,
  options,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  maxLength?: number
  options?: Array<{ id: string; name: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {options ? (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">沿用团队当前默认代理</option>
          {!options.some((option) => option.id === value) && value && (
            <option value={value} disabled>
              原线路不可用
            </option>
          )}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}
