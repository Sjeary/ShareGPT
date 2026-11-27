import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, Copy, Link2, Loader2, Plus, RotateCw, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'
import type { AdminInvite, AdminInviteStatus } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

type FilterMode = 'all' | 'active' | 'inactive'

const STATUS_META: Record<
  AdminInviteStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    className?: string
  }
> = {
  active: { label: '生效中', variant: 'default', className: 'bg-success text-white' },
  expired: { label: '已过期', variant: 'secondary' },
  exhausted: { label: '已用完', variant: 'secondary' },
  revoked: { label: '已撤销', variant: 'destructive' },
}

const MAX_USES_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: '1 次', value: 1 },
  { label: '5 次', value: 5 },
  { label: '10 次', value: 10 },
  { label: '不限', value: null },
]

const EXPIRY_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: '24 小时', hours: 24 },
  { label: '7 天', hours: 24 * 7 },
  { label: '30 天', hours: 24 * 30 },
  { label: '永不过期', hours: null },
]

function buildInviteLink(serverUrl: string, code: string): string {
  const base = String(serverUrl || '')
    .trim()
    .replace(/\/+$/, '')
  return `sharegpt://invite?server=${encodeURIComponent(base)}&code=${encodeURIComponent(code)}`
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function InvitesPanel() {
  const serverUrl = useAdminStore((s) => s.serverUrl)
  const invites = useAdminStore((s) => s.invites)
  const invitesLoading = useAdminStore((s) => s.invitesLoading)
  const proxyRoutes = useAdminStore((s) => s.proxyRoutes)
  const loadInvites = useAdminStore((s) => s.loadInvites)
  const createInvite = useAdminStore((s) => s.createInvite)
  const revokeInvite = useAdminStore((s) => s.revokeInvite)

  const [filter, setFilter] = useState<FilterMode>('all')
  const [copiedId, setCopiedId] = useState('')
  const [revokingId, setRevokingId] = useState('')

  // 创建表单状态
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState<number | null>(10)
  const [customMaxUses, setCustomMaxUses] = useState('10')
  const [expiresInHours, setExpiresInHours] = useState<number | null>(24 * 7)
  const [chatDisabled, setChatDisabled] = useState(false)
  const [allowedRouteIds, setAllowedRouteIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [lastCreated, setLastCreated] = useState<AdminInvite | null>(null)

  useEffect(() => {
    void loadInvites({ silent: true })
  }, [loadInvites])

  const filtered = useMemo(() => {
    return invites.filter((item) => {
      if (filter === 'active') return item.status === 'active'
      if (filter === 'inactive') return item.status !== 'active'
      return true
    })
  }, [filter, invites])

  async function handleCopy(invite: AdminInvite) {
    const link = buildInviteLink(serverUrl, invite.code)
    const ok = await copyText(link)
    if (ok) {
      setCopiedId(invite.id)
      toast.success('邀请链接已复制，可直接发给新成员')
      window.setTimeout(() => {
        setCopiedId((current) => (current === invite.id ? '' : current))
      }, 2000)
    } else {
      toast.error('剪贴板写入失败，请手动选中复制')
    }
  }

  async function handleRevoke(invite: AdminInvite) {
    setRevokingId(invite.id)
    try {
      await revokeInvite(invite.id)
      if (lastCreated?.id === invite.id) setLastCreated(null)
      toast.success('邀请链接已撤销')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRevokingId('')
    }
  }

  async function handleCreate() {
    let resolvedMaxUses = maxUses
    if (maxUses !== null) {
      const parsed = Number.parseInt(customMaxUses.trim(), 10)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
        toast.error('可用次数需为 1 到 1000 的整数，或选择「不限」')
        return
      }
      resolvedMaxUses = parsed
    }

    setCreating(true)
    try {
      const created = await createInvite({
        note: note.trim(),
        maxUses: resolvedMaxUses,
        expiresInHours,
        chatDisabled,
        allowedProxyRouteIds: allowedRouteIds,
      })
      if (created) {
        setLastCreated(created)
        setNote('')
        const link = buildInviteLink(serverUrl, created.code)
        const copied = await copyText(link)
        toast.success(copied ? '邀请链接已生成并自动复制' : '邀请链接已生成')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const routeOptions = [
    { id: 'internal-unified', name: '内置统一代理' },
    ...proxyRoutes.map((route) => ({ id: route.id, name: route.name })),
  ]

  return (
    <PanelScaffold
      icon={Link2}
      title="邀请链接"
      hint="生成团队自助注册链接，成员下载客户端后粘贴链接即可自行注册账号"
      toolbar={
        <Button
          variant="outline"
          size="sm"
          disabled={invitesLoading}
          onClick={() => void loadInvites()}
        >
          <RotateCw className={invitesLoading ? 'size-4 animate-spin' : 'size-4'} />
          刷新
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-6 xl:flex-row">
        {/* 左侧：邀请列表 */}
        <Card className="min-w-0 flex-1">
          <CardHeader className="gap-3">
            <CardTitle className="text-base">
              已生成链接
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {filtered.length} / {invites.length}
              </span>
            </CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'active', label: '生效中' },
                  { key: 'inactive', label: '已失效' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === tab.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {invites.length
                  ? '当前筛选条件下没有邀请链接。'
                  : '还没有生成邀请链接，可在右侧快速创建一条发给成员。'}
              </p>
            ) : (
              filtered.map((invite) => {
                const statusInfo = STATUS_META[invite.status]
                const link = buildInviteLink(serverUrl, invite.code)
                const active = invite.status === 'active'
                return (
                  <div
                    key={invite.id}
                    className="grid gap-2.5 rounded-lg border border-border p-3.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {invite.note || '团队成员邀请'}
                      </span>
                      <Badge variant={statusInfo.variant} className={statusInfo.className}>
                        {statusInfo.label}
                      </Badge>
                      {invite.chatDisabled && <Badge variant="outline">默认禁聊天</Badge>}
                      {invite.allowedProxyRouteIds.length > 0 && (
                        <Badge variant="outline">
                          指定 {invite.allowedProxyRouteIds.length} 条线路
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        使用次数：
                        {invite.maxUses === null
                          ? `${invite.usedCount} / 不限`
                          : `${invite.usedCount} / ${invite.maxUses}`}
                      </span>
                      <span>
                        有效期：
                        {invite.expiresAt
                          ? new Date(invite.expiresAt).toLocaleString()
                          : '永不过期'}
                      </span>
                      <span>创建人：{invite.createdBy}</span>
                    </div>

                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/35 px-2.5 py-1.5">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground select-all">
                        {link}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 gap-1 px-2 text-xs"
                        onClick={() => void handleCopy(invite)}
                      >
                        {copiedId === invite.id ? (
                          <>
                            <Check className="size-3.5 text-success" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" />
                            复制链接
                          </>
                        )}
                      </Button>
                      {active && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={revokingId === invite.id}
                          onClick={() => void handleRevoke(invite)}
                        >
                          {revokingId === invite.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Ban className="size-3.5" />
                          )}
                          撤销
                        </Button>
                      )}
                    </div>

                    {invite.registrations.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="size-3.5 shrink-0" />
                        <span>已注册：</span>
                        {invite.registrations.slice(-8).map((reg) => (
                          <span
                            key={`${reg.username}-${reg.registeredAt}`}
                            className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-foreground"
                          >
                            @{reg.username}
                          </span>
                        ))}
                        {invite.registrations.length > 8 && (
                          <span>等 {invite.registrations.length} 人</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* 右侧：生成新邀请链接 */}
        <div className="flex w-full shrink-0 flex-col gap-4 self-start xl:sticky xl:top-6 xl:w-[390px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">生成邀请链接</CardTitle>
              <CardDescription>
                生成后把链接直接发给新成员，对方在客户端选择「邀请链接注册」粘贴即可完成注册。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-note">备注（可选）</Label>
                <Input
                  id="invite-note"
                  value={note}
                  maxLength={80}
                  placeholder="例如：研发部新成员 / 临时试用"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label>可使用次数</Label>
                <div className="flex flex-wrap gap-1.5">
                  {MAX_USES_PRESETS.map((preset) => {
                    const selected =
                      preset.value === null
                        ? maxUses === null
                        : maxUses !== null && Number(customMaxUses) === preset.value
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setMaxUses(preset.value)
                          if (preset.value !== null) setCustomMaxUses(String(preset.value))
                        }}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
                {maxUses !== null && (
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={customMaxUses}
                    onChange={(e) => {
                      setCustomMaxUses(e.target.value)
                      const n = Number.parseInt(e.target.value, 10)
                      if (Number.isInteger(n) && n >= 1) setMaxUses(n)
                    }}
                    placeholder="1 ~ 1000"
                    className="h-8 text-xs"
                  />
                )}
              </div>

              <div className="grid gap-1.5">
                <Label>有效期</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setExpiresInHours(preset.hours)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        expiresInHours === preset.hours
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <Label htmlFor="invite-chat-disabled" className="cursor-pointer text-sm">
                    默认禁止协作聊天
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    开启后，通过此链接注册的成员不显示聊天入口。
                  </p>
                </div>
                <Switch
                  id="invite-chat-disabled"
                  checked={chatDisabled}
                  onCheckedChange={setChatDisabled}
                />
              </div>

              {routeOptions.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>可选：限定可用代理线路（留空则沿用团队默认）</Label>
                  <div className="grid gap-1.5 rounded-md border border-border p-2.5">
                    {routeOptions.map((route) => {
                      const checked = allowedRouteIds.includes(route.id)
                      return (
                        <label
                          key={route.id}
                          className="flex cursor-pointer items-center gap-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAllowedRouteIds((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, route.id])]
                                  : prev.filter((id) => id !== route.id),
                              )
                            }}
                          />
                          <span className="truncate">{route.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>通过邀请链接注册的账号均为普通成员，不会自动授予管理员或高级功能权限。</span>
              </div>

              <Button disabled={creating} onClick={() => void handleCreate()}>
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                {creating ? '生成中…' : '生成邀请链接'}
              </Button>

              {lastCreated && (
                <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3">
                  <p className="text-xs font-medium text-foreground">新邀请链接已就绪</p>
                  <code className="break-all rounded bg-background/80 p-2 font-mono text-[11px] text-foreground select-all">
                    {buildInviteLink(serverUrl, lastCreated.code)}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopy(lastCreated)}
                  >
                    <Copy />
                    再次复制链接
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PanelScaffold>
  )
}
