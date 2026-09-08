import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, CalendarRange, RotateCw, Send, Users, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'
import type { AiServiceKind } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

const SERVICES: Array<{ key: AiServiceKind; label: string }> = [
  { key: 'gpt', label: 'ChatGPT' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
]

export function AiUsagePanel() {
  const report = useAdminStore((state) => state.aiUsage)
  const loading = useAdminStore((state) => state.aiUsageLoading)
  const load = useAdminStore((state) => state.loadAiUsage)
  const [service, setService] = useState<AiServiceKind>('gpt')
  const [range, setRange] = useState({ from: '', to: '' })

  useEffect(() => {
    void load({ silent: true, filters: { service } })
  }, [load, service])

  const current = report?.service === service ? report : null
  const users = useMemo(() => current?.users || [], [current?.users])

  function refresh() {
    void load({ filters: { service, ...range } })
  }

  return (
    <PanelScaffold
      icon={BarChart3}
      title="AI 使用统计"
      hint="按服务查看网页确认发送成功的次数与成员排行"
      toolbar={
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RotateCw className={loading ? 'animate-spin' : ''} />
          刷新
        </Button>
      }
    >
      <div className="mx-auto grid max-w-4xl gap-5 p-6">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {SERVICES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setService(item.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                service === item.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="size-4 text-primary" />
              统计区间
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="开始日期">
              <Input
                type="date"
                value={range.from}
                onChange={(event) =>
                  setRange((currentRange) => ({ ...currentRange, from: event.target.value }))
                }
              />
            </Field>
            <Field label="结束日期">
              <Input
                type="date"
                value={range.to}
                onChange={(event) =>
                  setRange((currentRange) => ({ ...currentRange, to: event.target.value }))
                }
              />
            </Field>
            <Button variant="outline" onClick={refresh} disabled={loading}>
              查询
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              日期留空表示全部时间。这里只统计网页确认成功发出的消息；网页模型的 token
              与账单不可验证，因此不会在这里估算。
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard icon={Send} label="成功发送" value={current?.totalQueries || 0} suffix="次" />
          <MetricCard icon={Users} label="使用成员" value={current?.userCount || 0} suffix="人" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">成员使用排行</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!users.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? '正在读取统计…' : '所选范围内暂无已确认的发送记录。'}
              </p>
            ) : (
              users.map((user, index) => {
                const percent = Math.max(0, Math.min(100, Math.round(user.ratio * 100)))
                return (
                  <div
                    key={user.username}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3"
                  >
                    <span className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium" title={user.username}>
                          {user.displayName || user.username}
                          {user.displayName && user.displayName !== user.username
                            ? ` · @${user.username}`
                            : ''}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{percent}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                    <span className="pt-0.5 text-sm font-medium tabular-nums">
                      {user.count.toLocaleString('zh-CN')} 次
                    </span>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
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

function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: LucideIcon
  label: string
  value: number
  suffix: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p data-testid={`ai-usage-${label}`} className="mt-1 text-2xl font-semibold tabular-nums">
            {value.toLocaleString('zh-CN')}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
