import {
  ArrowRight,
  BarChart3,
  Cable,
  Link2,
  Network,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import type { AdminTab } from '@/types/admin'

export function AdminOverviewTab({ onJump }: { onJump: (tab: AdminTab) => void }) {
  const overview = useIntegratedAdminStore((s) => s.overview)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.users))
  const session = useIntegratedAdminStore((s) => s.session)

  const stats = [
    { label: '团队总成员', value: overview ? String(overview.total) : '—', icon: Users },
    { label: '当前在线', value: overview ? String(overview.online) : '—', icon: UserCheck },
    { label: '管理员', value: overview ? String(overview.admins) : '—', icon: ShieldCheck },
    { label: '高级 AI 授权', value: overview ? String(overview.advancedAi) : '—', icon: Sparkles },
    { label: '已禁用账号', value: overview ? String(overview.disabled) : '—', icon: UserX },
  ]

  const shortcuts: Array<{ tab: AdminTab; title: string; desc: string; icon: typeof Users }> = [
    {
      tab: 'users',
      title: '成员与权限',
      desc: '创建账号、调整管理员/高级 AI/线路与聊天权限',
      icon: Users,
    },
    {
      tab: 'invites',
      title: '邀请链接',
      desc: '生成可复制的自助注册链接，控制次数与有效期',
      icon: Link2,
    },
    {
      tab: 'ai-usage',
      title: 'AI 使用统计',
      desc: '按 ChatGPT / Claude / Gemini 查看成员发送排行',
      icon: BarChart3,
    },
    {
      tab: 'airport',
      title: 'AI 线路策略',
      desc: '管理代理线路目录、默认出口与客户端健康上报',
      icon: Network,
    },
    {
      tab: 'bootstrap',
      title: '团队统一代理',
      desc: '维护统一下发代理参数与固定代理域名清单',
      icon: Cable,
    },
  ]

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label} className="gap-2 py-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <Icon className="size-4 text-primary" />
              </CardHeader>
              <CardContent className="px-4">
                <p className="tabular-nums text-2xl font-semibold">
                  {loading && !overview ? '…' : item.value}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快速管理入口</CardTitle>
          <CardDescription>
            当前已通过管理员账号 @{session?.username || '—'} 自动授权，所有操作直接同步至{' '}
            {session?.serverUrl || '团队服务器'}。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => onJump(item.tab)}
                className="group flex items-start gap-3 rounded-xl border border-border/80 bg-background/60 p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/35"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {item.title}
                    <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
