import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { buildInviteLink } from '@/lib/inviteLink'
import { cn } from '@/lib/utils'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import type { AdminInvite, AdminInviteStatus, AdminUser } from '@/types/admin'

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function AdminUsersTab() {
  const users = useIntegratedAdminStore((s) => s.users)
  const routes = useIntegratedAdminStore((s) => s.proxyRoutes)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.users))
  const createUser = useIntegratedAdminStore((s) => s.createUser)
  const updateUser = useIntegratedAdminStore((s) => s.updateUser)
  const resetPassword = useIntegratedAdminStore((s) => s.resetPassword)

  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [newAdvancedAi, setNewAdvancedAi] = useState(false)
  const [newChatDisabled, setNewChatDisabled] = useState(false)

  const [busyUser, setBusyUser] = useState('')
  const [resetTarget, setResetTarget] = useState('')
  const [resetPwdValue, setResetPwdValue] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q),
    )
  }, [query, users])

  async function handleCreate() {
    const username = newUsername.trim()
    if (!username || !newPassword) {
      toast.error('请填写用户名和初始密码')
      return
    }
    setCreating(true)
    try {
      const created = await createUser({
        username,
        password: newPassword,
        displayName: newDisplayName.trim() || undefined,
        isAdmin: newIsAdmin,
        advancedAiAllowed: newIsAdmin || newAdvancedAi,
        chatDisabled: newChatDisabled,
      })
      if (created) {
        toast.success(`已创建成员 @${created.username}`)
        setNewUsername('')
        setNewDisplayName('')
        setNewPassword('')
        setNewIsAdmin(false)
        setNewAdvancedAi(false)
        setNewChatDisabled(false)
      }
    } catch (err) {
      toast.error(errMsg(err, '创建成员失败'))
    } finally {
      setCreating(false)
    }
  }

  async function patchUser(
    user: AdminUser,
    patch: Parameters<typeof updateUser>[1],
    okText: string,
  ) {
    setBusyUser(user.username)
    try {
      const updated = await updateUser(user.username, patch)
      if (updated) toast.success(okText)
    } catch (err) {
      toast.error(errMsg(err, '更新成员失败'))
    } finally {
      setBusyUser('')
    }
  }

  async function submitResetPassword(username: string) {
    if (!resetPwdValue || resetPwdValue.length < 6) {
      toast.error('新密码至少需要 6 位')
      return
    }
    setBusyUser(username)
    try {
      const updated = await resetPassword(username, resetPwdValue)
      if (updated) {
        toast.success(`已重置 @${username} 的密码`)
        setResetTarget('')
        setResetPwdValue('')
      }
    } catch (err) {
      toast.error(errMsg(err, '重置密码失败'))
    } finally {
      setBusyUser('')
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">成员列表 ({users.length})</CardTitle>
              <CardDescription>实时调整管理员、高级 AI、聊天与账号启用状态。</CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索用户名或昵称"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {loading && users.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">正在加载成员列表…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的成员</p>
          ) : (
            filtered.map((user) => {
              const busy = busyUser === user.username
              const resetting = resetTarget === user.username
              return (
                <div
                  key={user.username}
                  className="grid gap-2.5 rounded-xl border border-border/80 bg-background/50 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="selectable font-medium">
                          {user.displayName || user.username}
                        </span>
                        <span className="selectable text-xs text-muted-foreground">
                          @{user.username}
                        </span>
                        {user.online && (
                          <Badge
                            variant="outline"
                            className="border-success/50 text-[10px] text-success"
                          >
                            在线
                          </Badge>
                        )}
                        {user.isAdmin && <Badge className="text-[10px]">管理员</Badge>}
                        {user.disabled && (
                          <Badge variant="destructive" className="text-[10px]">
                            已禁用
                          </Badge>
                        )}
                      </div>
                      {user.client?.version && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          客户端 v{user.client.version} · {user.client.platform || 'unknown'}
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => {
                        setResetTarget(resetting ? '' : user.username)
                        setResetPwdValue('')
                      }}
                    >
                      <KeyRound className="size-3" />
                      重置密码
                    </Button>
                  </div>

                  {resetting && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
                      <Input
                        type="password"
                        value={resetPwdValue}
                        onChange={(e) => setResetPwdValue(e.target.value)}
                        placeholder="输入新密码（至少 6 位）"
                        className="h-8 text-xs"
                      />
                      <Button
                        size="xs"
                        disabled={busy}
                        onClick={() => void submitResetPassword(user.username)}
                      >
                        确认
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Switch
                        checked={user.isAdmin}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          void patchUser(
                            user,
                            { isAdmin: checked },
                            `已更新 @${user.username} 管理员权限`,
                          )
                        }
                      />
                      管理员
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Switch
                        checked={user.advancedAiAllowed}
                        disabled={busy || user.isAdmin}
                        onCheckedChange={(checked) =>
                          void patchUser(
                            user,
                            { advancedAiAllowed: checked },
                            `已更新 @${user.username} 高级 AI 权限`,
                          )
                        }
                      />
                      高级 AI / 终端
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Switch
                        checked={Boolean(user.chatDisabled)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          void patchUser(
                            user,
                            { chatDisabled: checked },
                            `已更新 @${user.username} 聊天限制`,
                          )
                        }
                      />
                      禁用聊天
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-destructive">
                      <Switch
                        checked={user.disabled}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          void patchUser(
                            user,
                            { disabled: checked },
                            checked ? `已禁用 @${user.username}` : `已重新启用 @${user.username}`,
                          )
                        }
                      />
                      禁用账号
                    </label>
                  </div>

                  {routes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px]">
                      <span className="text-muted-foreground">授权线路：</span>
                      {routes.map((route) => {
                        const allowed = user.allowedProxyRouteIds.includes(route.id)
                        return (
                          <button
                            key={route.id}
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const next = allowed
                                ? user.allowedProxyRouteIds.filter((id) => id !== route.id)
                                : [...user.allowedProxyRouteIds, route.id]
                              void patchUser(
                                user,
                                { allowedProxyRouteIds: next },
                                `已更新 @${user.username} 的线路授权`,
                              )
                            }}
                            className={cn(
                              'rounded-full border px-2 py-0.5 transition-colors',
                              allowed
                                ? 'border-primary/50 bg-primary/12 text-primary'
                                : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {route.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card className="xl:sticky xl:top-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            新建成员
          </CardTitle>
          <CardDescription>手动创建团队账号，也可改用「邀请链接」让成员自助注册。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="admin-new-user">用户名</Label>
            <Input
              id="admin-new-user"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="例如：zhangsan"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="admin-new-name">显示名（可选）</Label>
            <Input
              id="admin-new-name"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="团队聊天展示昵称"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="admin-new-pwd">初始密码</Label>
            <Input
              id="admin-new-pwd"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>
          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs">
            <label className="flex cursor-pointer items-center justify-between">
              <span>设为管理员</span>
              <Switch checked={newIsAdmin} onCheckedChange={setNewIsAdmin} />
            </label>
            <label className="flex cursor-pointer items-center justify-between">
              <span>允许高级 AI / 终端</span>
              <Switch
                checked={newIsAdmin || newAdvancedAi}
                disabled={newIsAdmin}
                onCheckedChange={setNewAdvancedAi}
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between">
              <span>禁用协作聊天</span>
              <Switch checked={newChatDisabled} onCheckedChange={setNewChatDisabled} />
            </label>
          </div>
          <Button disabled={creating} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            创建账号
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_BADGE: Record<AdminInviteStatus, { label: string; cls: string }> = {
  active: { label: '可用', cls: 'border-success/40 bg-success/10 text-success' },
  exhausted: { label: '已用完', cls: 'border-border bg-muted text-muted-foreground' },
  expired: { label: '已过期', cls: 'border-border bg-muted text-muted-foreground' },
  revoked: { label: '已撤销', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
}

export function AdminInvitesTab() {
  const session = useIntegratedAdminStore((s) => s.session)
  const invites = useIntegratedAdminStore((s) => s.invites)
  const routes = useIntegratedAdminStore((s) => s.proxyRoutes)
  const loading = useIntegratedAdminStore((s) => Boolean(s.loading.invites))
  const createInvite = useIntegratedAdminStore((s) => s.createInvite)
  const revokeInvite = useIntegratedAdminStore((s) => s.revokeInvite)

  const serverUrl = session?.serverUrl || ''
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState<string>('1')
  const [expiresInHours, setExpiresInHours] = useState<string>('168')
  const [chatDisabled, setChatDisabled] = useState(false)
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [lastCreated, setLastCreated] = useState<AdminInvite | null>(null)

  const filtered = useMemo(() => {
    if (filter === 'active') return invites.filter((i) => i.status === 'active')
    if (filter === 'inactive') return invites.filter((i) => i.status !== 'active')
    return invites
  }, [filter, invites])

  async function handleCopy(invite: AdminInvite) {
    const link = buildInviteLink(serverUrl, invite.code)
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(invite.id)
      window.setTimeout(() => setCopiedId((id) => (id === invite.id ? '' : id)), 1800)
      toast.success('已复制邀请链接')
    } catch {
      toast.error('复制失败')
    }
  }

  async function handleCreate() {
    setCreating(true)
    try {
      const parsedUses = maxUses === 'unlimited' ? null : Math.max(1, Number(maxUses) || 1)
      const parsedHours =
        expiresInHours === 'never' ? null : Math.max(1, Number(expiresInHours) || 168)
      const created = await createInvite({
        note: note.trim() || undefined,
        maxUses: parsedUses,
        expiresInHours: parsedHours,
        chatDisabled,
        allowedProxyRouteIds: selectedRoutes,
      })
      if (created) {
        setLastCreated(created)
        setNote('')
        const link = buildInviteLink(serverUrl, created.code)
        try {
          await navigator.clipboard.writeText(link)
          toast.success('邀请链接已生成并自动复制')
        } catch {
          toast.success('邀请链接已生成')
        }
      }
    } catch (err) {
      toast.error(errMsg(err, '生成邀请链接失败'))
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(invite: AdminInvite) {
    setRevokingId(invite.id)
    try {
      await revokeInvite(invite.id)
      toast.success('已撤销该邀请链接')
    } catch (err) {
      toast.error(errMsg(err, '撤销失败'))
    } finally {
      setRevokingId('')
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">已生成邀请链接 ({invites.length})</CardTitle>
              <CardDescription>发给新成员在客户端登录页粘贴即可自助注册普通账号。</CardDescription>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
              {(
                [
                  ['all', '全部'],
                  ['active', '可用'],
                  ['inactive', '已失效'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium transition-colors',
                    filter === id
                      ? 'bg-card text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {loading && invites.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">正在加载邀请链接…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无邀请链接</p>
          ) : (
            filtered.map((invite) => {
              const st = STATUS_BADGE[invite.status]
              return (
                <div
                  key={invite.id}
                  className="grid gap-2 rounded-xl border border-border/80 bg-background/50 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">
                          {invite.note || `邀请码 ${invite.code.slice(0, 8)}`}
                        </span>
                        <Badge variant="outline" className={cn('text-[10px]', st.cls)}>
                          {st.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        已用 {invite.usedCount}
                        {invite.maxUses === null ? ' / 不限' : ` / ${invite.maxUses}`} 次 ·{' '}
                        {invite.expiresAt
                          ? `到期 ${new Date(invite.expiresAt).toLocaleString()}`
                          : '永不过期'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={invite.status !== 'active'}
                        onClick={() => void handleCopy(invite)}
                      >
                        {copiedId === invite.id ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        复制链接
                      </Button>
                      {invite.status === 'active' && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={revokingId === invite.id}
                          onClick={() => void handleRevoke(invite)}
                        >
                          <Ban className="size-3" />
                          撤销
                        </Button>
                      )}
                    </div>
                  </div>
                  {invite.registrations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <span>已注册：</span>
                      {invite.registrations.map((r) => (
                        <span
                          key={`${r.username}-${r.registeredAt}`}
                          className="rounded bg-muted px-1.5 py-0.5 text-foreground"
                        >
                          @{r.username}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card className="xl:sticky xl:top-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 text-primary" />
            生成邀请链接
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="integrated-invite-note">备注（可选）</Label>
            <Input
              id="integrated-invite-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：研发部新成员 / 临时试用"
              maxLength={80}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="integrated-invite-uses">可用次数</Label>
              <select
                id="integrated-invite-uses"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="1">单次（1 人）</option>
                <option value="5">5 次</option>
                <option value="20">20 次</option>
                <option value="unlimited">不限次数</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="integrated-invite-exp">有效期</Label>
              <select
                id="integrated-invite-exp"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="24">24 小时</option>
                <option value="168">7 天</option>
                <option value="720">30 天</option>
                <option value="never">永不过期</option>
              </select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs">
            <span>新成员默认禁用聊天</span>
            <Switch checked={chatDisabled} onCheckedChange={setChatDisabled} />
          </label>
          {routes.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs">允许代理线路（留空走团队默认）</Label>
              <div className="flex flex-wrap gap-1.5">
                {routes.map((route) => {
                  const checked = selectedRoutes.includes(route.id)
                  return (
                    <button
                      key={route.id}
                      type="button"
                      onClick={() =>
                        setSelectedRoutes((prev) =>
                          checked ? prev.filter((id) => id !== route.id) : [...prev, route.id],
                        )
                      }
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                        checked
                          ? 'border-primary/50 bg-primary/12 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground',
                      )}
                    >
                      {route.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>通过邀请链接注册的账号均为普通成员，不会自动授予管理员或高级功能权限。</span>
          </div>
          <Button disabled={creating} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            生成邀请链接
          </Button>
          {lastCreated && (
            <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3">
              <p className="text-xs font-medium">新邀请链接已就绪</p>
              <code className="break-all rounded bg-background/80 p-2 font-mono text-[11px] select-all">
                {buildInviteLink(serverUrl, lastCreated.code)}
              </code>
              <Button size="xs" variant="outline" onClick={() => void handleCopy(lastCreated)}>
                <Copy className="size-3" />
                再次复制
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
