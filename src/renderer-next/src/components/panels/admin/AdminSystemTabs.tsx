import { useState } from 'react'
import { toast } from 'sonner'
import { Braces, Cable, Loader2, MessageSquareText, Rocket, Save, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import type { BootstrapSender } from '@/types/admin'

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function AdminBootstrapTab() {
  const bootstrap = useIntegratedAdminStore((s) => s.bootstrap)
  const saveBootstrap = useIntegratedAdminStore((s) => s.saveBootstrap)
  const [draft, setDraft] = useState<Partial<BootstrapSender> | null>(null)
  const [saving, setSaving] = useState(false)

  const sender = draft ?? bootstrap?.sender ?? {}

  async function handleSave() {
    if (!bootstrap) return
    setSaving(true)
    try {
      const saved = await saveBootstrap({ ...bootstrap, sender })
      if (saved) {
        setDraft(null)
        toast.success('已保存团队统一代理参数')
      }
    } catch (err) {
      toast.error(errMsg(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="size-4 text-primary" />
          团队统一代理参数
        </CardTitle>
        <CardDescription>
          修改后成员客户端下次同步将自动获取最新代理参数与固定代理域名。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>代理服务器地址</Label>
            <Input
              value={sender.proxy_server ?? ''}
              onChange={(e) => setDraft({ ...sender, proxy_server: e.target.value })}
              placeholder="proxy.example.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>连接端口</Label>
            <Input
              value={sender.proxy_port ?? ''}
              onChange={(e) => setDraft({ ...sender, proxy_port: e.target.value })}
              placeholder="443"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>连接身份码 (UUID)</Label>
            <Input
              value={sender.proxy_uuid ?? ''}
              onChange={(e) => setDraft({ ...sender, proxy_uuid: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>本地 SOCKS 端口</Label>
            <Input
              value={sender.socks_listen_port ?? ''}
              onChange={(e) => setDraft({ ...sender, socks_listen_port: e.target.value })}
              placeholder="1080"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>固定走代理的域名（逗号分隔）</Label>
          <textarea
            rows={4}
            value={sender.target_domains ?? ''}
            onChange={(e) => setDraft({ ...sender, target_domains: e.target.value })}
            className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <Button size="sm" disabled={saving || !bootstrap} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            保存下发参数
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function AdminReleasesTab() {
  const releases = useIntegratedAdminStore((s) => s.releases)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4 text-primary" />
          当前客户端版本信息
        </CardTitle>
        <CardDescription>
          正式版本发布由 GitHub Releases
          与开发者流程管理，此处供管理员查看当前服务器记录的版本元数据。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
          <span className="text-muted-foreground">当前登记版本</span>
          <span className="font-mono font-medium">{releases?.version || '未登记'}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
          <span className="text-muted-foreground">发布时间</span>
          <span className="text-xs text-muted-foreground">{releases?.publishedAt || '—'}</span>
        </div>
        {releases?.notes && (
          <div className="rounded-lg border border-border/70 bg-muted/25 p-3 text-xs whitespace-pre-wrap">
            {releases.notes}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminFeedbackTab() {
  const feedback = useIntegratedAdminStore((s) => s.feedback)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.feedback))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4 text-primary" />
          成员反馈建议 ({feedback.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2.5">
        {loading && feedback.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在加载反馈…</p>
        ) : feedback.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">暂无成员反馈</p>
        ) : (
          feedback.map((item) => (
            <div
              key={item.id}
              className="grid gap-1.5 rounded-xl border border-border/80 bg-background/50 p-3.5 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {item.displayName || item.username} · @{item.username}
                </span>
                <span>
                  v{item.version || '?'} · {item.platform || 'unknown'} ·{' '}
                  {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                </span>
              </div>
              <p className="selectable whitespace-pre-wrap text-sm leading-relaxed">{item.text}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function AdminProxyMissingTab() {
  const items = useIntegratedAdminStore((s) => s.proxyMissing)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.proxyMissing))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-primary" />
          漏走代理域名上报 ({items.length})
        </CardTitle>
        <CardDescription>
          客户端代理检测上报的未命中域名，可按需补充到「团队统一代理」。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {loading && items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在加载上报记录…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">暂无漏走代理域名上报</p>
        ) : (
          items.map((item) => (
            <div
              key={item.host}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2 text-xs"
            >
              <span className="selectable font-mono font-medium">{item.host}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{item.count} 次</Badge>
                <span className="text-muted-foreground">
                  {item.reporters.slice(0, 3).join(', ')}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function AdminExtrasTab() {
  const bootstrap = useIntegratedAdminStore((s) => s.bootstrap)
  const saveExtras = useIntegratedAdminStore((s) => s.saveExtras)
  const [text, setText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const value = text ?? JSON.stringify(bootstrap?.extra ?? {}, null, 2)

  async function handleSave() {
    let parsed: Record<string, unknown>
    try {
      const obj = JSON.parse(value)
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('not object')
      }
      parsed = obj as Record<string, unknown>
    } catch {
      toast.error('高级配置必须是合法 JSON 对象')
      return
    }
    setSaving(true)
    try {
      const saved = await saveExtras(parsed)
      if (saved) {
        setText(null)
        toast.success('已保存高级扩展配置')
      }
    } catch (err) {
      toast.error(errMsg(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Braces className="size-4 text-primary" />
          高级扩展 JSON
        </CardTitle>
        <CardDescription>保留给团队自定义扩展字段的 JSON 存储区。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <textarea
          rows={10}
          spellCheck={false}
          value={value}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div>
          <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            保存扩展配置
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
