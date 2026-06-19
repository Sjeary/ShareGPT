import { useEffect } from 'react'
import { ShieldAlert, RotateCw, Inbox, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAdminStore } from '@/store/useAdminStore'
import { PanelScaffold } from './PanelScaffold'

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ProxyMissingPanel() {
  const items = useAdminStore((s) => s.proxyMissing)
  const loading = useAdminStore((s) => s.proxyMissingLoading)
  const load = useAdminStore((s) => s.loadProxyMissing)

  useEffect(() => {
    void load({ silent: true })
  }, [load])

  async function copyAll() {
    const text = items.map((i) => i.host).join(',')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${items.length} 个域名`)
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <PanelScaffold
      icon={ShieldAlert}
      title="漏走代理域名"
      hint="客户端检测到会用到但没走代理的域名，按次数倒序。把它们补进内置清单即可。"
      toolbar={
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy />
              复制全部
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RotateCw className={loading ? 'animate-spin' : ''} />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
            <Inbox className="size-8 opacity-40" />
            {loading ? '加载中…' : '暂无上报的漏走代理域名'}
          </div>
        ) : (
          items.map((item) => (
            <Card key={item.host}>
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="font-mono text-sm font-medium">{item.host}</span>
                <Badge variant="outline">{item.count} 次</Badge>
                <Badge variant="outline">{item.reporters?.length || 0} 人</Badge>
                {item.versions?.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    v{item.versions.join(' / ')}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  最近 {formatTime(item.lastSeen)}
                </span>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PanelScaffold>
  )
}
