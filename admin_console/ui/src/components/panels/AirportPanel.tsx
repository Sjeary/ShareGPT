import { useEffect, useMemo, useState } from 'react'
import { Plane, RotateCw, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAdminStore } from '@/store/useAdminStore'
import { parseClashProxies, clashNodeToSingbox, type ClashNode } from '@/lib/clash'
import { PanelScaffold } from './PanelScaffold'

export function AirportPanel() {
  const airport = useAdminStore((s) => s.airport)
  const loading = useAdminStore((s) => s.airportLoading)
  const load = useAdminStore((s) => s.loadAirport)
  const save = useAdminStore((s) => s.saveAirport)

  const [text, setText] = useState('')
  const [nodes, setNodes] = useState<ClashNode[]>([])
  const [selected, setSelected] = useState<number>(-1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void load({ silent: true })
  }, [load])

  function handleParse() {
    const list = parseClashProxies(text)
    setNodes(list)
    setSelected(-1)
    if (!list.length) {
      toast.error('未解析到节点，请确认粘贴的是 Clash 订阅 YAML（含 proxies:）')
    } else {
      toast.success(`解析到 ${list.length} 个节点`)
    }
  }

  const preview = useMemo(() => {
    if (selected < 0 || !nodes[selected]) return null
    return clashNodeToSingbox(nodes[selected])
  }, [selected, nodes])

  async function handleSave() {
    const node = nodes[selected]
    if (!node) return
    const outbound = clashNodeToSingbox(node)
    if (!outbound) {
      toast.error(`暂不支持该协议（${node.type}），请换 ss/vmess/trojan/vless 节点`)
      return
    }
    setSaving(true)
    try {
      await save(node.name, outbound)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      await save('', null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PanelScaffold
      icon={Plane}
      title="机场代理"
      hint="粘贴 Clash 订阅，选一个节点下发给本群客户端作为可选代理（不替换统一梯子）"
      toolbar={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RotateCw className={loading ? 'animate-spin' : ''} />
          刷新
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {/* 当前下发的节点 */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Plane className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                当前下发：{airport?.outbound ? airport.name || '(未命名节点)' : '未下发'}
              </div>
              {airport?.outbound ? (
                <div className="truncate text-xs text-muted-foreground">
                  {String(airport.outbound.type)} · {String(airport.outbound.server)}:
                  {String(airport.outbound.server_port)}
                  {airport.updatedAt ? ` · ${new Date(airport.updatedAt).toLocaleString()}` : ''}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  本群客户端在「发送端设置 - 代理方式」里看不到机场选项，直到这里下发。
                </div>
              )}
            </div>
            {airport?.outbound && (
              <Button variant="outline" size="sm" onClick={handleClear} disabled={saving}>
                <Trash2 />
                清除
              </Button>
            )}
          </CardContent>
        </Card>

        {/* 粘贴订阅 */}
        <div className="grid gap-2">
          <label className="text-sm font-medium">Clash 订阅 YAML</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="把机场的 Clash 配置（含 proxies: 列表）整段粘贴到这里…"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div>
            <Button size="sm" onClick={handleParse} disabled={!text.trim()}>
              <UploadCloud />
              解析节点
            </Button>
          </div>
        </div>

        {/* 节点列表 */}
        {nodes.length > 0 && (
          <div className="grid gap-1.5">
            <div className="text-sm font-medium">选择一个节点（{nodes.length}）</div>
            <div className="max-h-52 overflow-auto rounded-md border border-border">
              {nodes.map((n, i) => (
                <button
                  key={`${n.name}-${i}`}
                  type="button"
                  disabled={!n.supported}
                  onClick={() => setSelected(i)}
                  className={[
                    'flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 disabled:opacity-40',
                    selected === i ? 'bg-primary/10' : 'hover:bg-accent/40',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
                  <Badge variant="outline">{n.type || '?'}</Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {n.server}:{n.port}
                  </span>
                  {!n.supported && (
                    <span className="shrink-0 text-[11px] text-destructive">不支持</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 保存(主操作) + 预览。保存按钮放在预览上方, 避免被长预览顶到看不见/点不到。 */}
        {preview && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Plane />
                {saving ? '下发中…' : '保存并下发给本群'}
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                已选：{nodes[selected]?.name}
              </span>
            </div>
            <details className="rounded-md border border-border bg-muted/40">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                转换后的 sing-box 出站（预览，点击展开）
              </summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-border px-3 py-2 font-mono text-[11px]">
                {JSON.stringify(preview, null, 2)}
              </pre>
            </details>
          </div>
        )}
        {selected >= 0 && !preview && (
          <p className="text-xs text-destructive">
            该节点协议暂不支持转换（仅支持 ss / vmess / trojan / vless）。
          </p>
        )}
      </div>
    </PanelScaffold>
  )
}
