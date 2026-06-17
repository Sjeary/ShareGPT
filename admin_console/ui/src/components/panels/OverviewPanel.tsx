import { useMemo } from 'react'
import {
  LayoutDashboard,
  Users,
  Wifi,
  ShieldCheck,
  Ban,
  RotateCw,
  Rocket,
  Server,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAdminStore } from '@/store/useAdminStore'
import { PanelScaffold } from './PanelScaffold'

function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: number | string
  tone?: 'default' | 'success' | 'primary' | 'destructive'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-500'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'primary'
          ? 'text-primary'
          : 'text-muted-foreground'
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
          <Icon className={`size-5 ${toneClass}`} />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums leading-tight">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function OverviewPanel() {
  const users = useAdminStore((s) => s.users)
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const serverUrl = useAdminStore((s) => s.serverUrl)
  const profile = useAdminStore((s) => s.profile)
  const usersLoading = useAdminStore((s) => s.usersLoading)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const loadBootstrap = useAdminStore((s) => s.loadBootstrap)

  const stats = useMemo(() => {
    const total = users.length
    const online = users.filter((u) => u.online).length
    const admins = users.filter((u) => u.isAdmin).length
    const disabled = users.filter((u) => u.disabled).length
    return { total, online, admins, disabled }
  }, [users])

  // 客户端版本分布 (仅统计已上报版本的用户)。
  const versionDist = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of users) {
      const v = (u.client?.version || '').trim()
      if (!v) continue
      map.set(v, (map.get(v) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [users])

  const update = bootstrap?.update || {}
  const winConfigured = Boolean(update.windows?.url)
  const macConfigured = Boolean(update.macos?.url)

  return (
    <PanelScaffold
      icon={LayoutDashboard}
      title="概览"
      hint="服务器与用户的全局状态一览"
      toolbar={
        <Button
          variant="outline"
          size="sm"
          disabled={usersLoading}
          onClick={() => {
            void loadUsers()
            void loadBootstrap({ silent: true })
          }}
        >
          <RotateCw className={usersLoading ? 'size-4 animate-spin' : 'size-4'} />
          刷新
        </Button>
      }
    >
      <div className="grid gap-4 p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Users} label="总用户" value={stats.total} />
          <StatCard icon={Wifi} label="在线" value={stats.online} tone="success" />
          <StatCard icon={ShieldCheck} label="管理员" value={stats.admins} tone="primary" />
          <StatCard icon={Ban} label="已禁用" value={stats.disabled} tone="destructive" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="size-4 text-primary" />
                当前发布版本
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">版本号</span>
                <span className="font-medium">{update.version || '未发布'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">发布时间</span>
                <span className="font-medium">{update.publishedAt || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">安装包</span>
                <span className="flex gap-1.5">
                  <Badge variant={winConfigured ? 'default' : 'outline'}>
                    Windows {winConfigured ? '已配置' : '未配置'}
                  </Badge>
                  <Badge variant={macConfigured ? 'default' : 'outline'}>
                    macOS {macConfigured ? '已配置' : '未配置'}
                  </Badge>
                </span>
              </div>
              {update.notes && (
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {update.notes}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="size-4 text-primary" />
                客户端版本分布
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">服务器</span>
                <span className="truncate font-medium" title={serverUrl}>
                  {serverUrl || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">当前管理员</span>
                <span className="font-medium">
                  {profile?.displayName || profile?.username || '—'}
                </span>
              </div>
              <div className="mt-1 border-t border-border pt-2">
                {versionDist.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无客户端版本上报。</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {versionDist.map(([version, count]) => (
                      <li key={version} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 truncate text-xs font-medium">
                          v{version}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.round((count / stats.total) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PanelScaffold>
  )
}
