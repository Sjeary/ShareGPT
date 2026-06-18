import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Users,
  RotateCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Ban,
  CircleCheck,
  UserPlus,
  Save,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'
import type { AdminUser, AdminClientInfo } from '@/types/admin'
import { PanelScaffold } from './PanelScaffold'

type StatusFilter = 'all' | 'online' | 'admin' | 'disabled'

function formatClient(client?: AdminClientInfo): string {
  if (!client) return '未知版本'
  const parts: string[] = []
  if (client.version) parts.push(`v${client.version}`)
  if (client.platform) parts.push(client.platform)
  if (client.arch) parts.push(client.arch)
  if (client.mode) parts.push(client.mode)
  return parts.length ? parts.join(' · ') : '未知版本'
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'online', label: '在线' },
  { key: 'admin', label: '管理员' },
  { key: 'disabled', label: '已禁用' },
]

export function UsersPanel() {
  const users = useAdminStore((s) => s.users)
  const usersLoading = useAdminStore((s) => s.usersLoading)
  const loadUsers = useAdminStore((s) => s.loadUsers)
  const createUser = useAdminStore((s) => s.createUser)
  const saveUser = useAdminStore((s) => s.saveUser)
  const autoRefresh = useAdminStore((s) => s.autoRefresh)
  const setAutoRefresh = useAdminStore((s) => s.setAutoRefresh)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (filter === 'online' && !u.online) return false
      if (filter === 'admin' && !u.isAdmin) return false
      if (filter === 'disabled' && !u.disabled) return false
      if (!q) return true
      return (
        u.username.toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q)
      )
    })
  }, [users, search, filter])

  const selectedUser = useMemo(
    () => users.find((u) => u.username === selected) || null,
    [users, selected],
  )

  // 默认选中第一个用户。
  useEffect(() => {
    if (!selected && users.length) setSelected(users[0].username)
  }, [users, selected])

  async function quickToggle(user: AdminUser, field: 'disabled' | 'isAdmin') {
    try {
      await saveUser(user.username, { [field]: !user[field] })
      toast.success(
        field === 'disabled'
          ? user.disabled
            ? `已启用 ${user.username}`
            : `已禁用 ${user.username}`
          : user.isAdmin
            ? `已取消 ${user.username} 的管理员`
            : `已设为管理员 ${user.username}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <PanelScaffold
      icon={Users}
      title="用户管理"
      hint="查看用户状态、新增账号或直接调整账号信息"
      toolbar={
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            自动刷新
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={usersLoading}
            onClick={() => void loadUsers()}
          >
            <RotateCw className={usersLoading ? 'size-4 animate-spin' : 'size-4'} />
            刷新
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-6 xl:flex-row">
        {/* 用户列表 */}
        <Card className="min-w-0 flex-1">
          <CardHeader className="gap-3">
            <CardTitle className="text-base">
              用户列表
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {filtered.length} / {users.length}
              </span>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索用户名或显示名…"
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === f.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="grid gap-1.5">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {users.length ? '没有匹配的用户。' : '当前还没有用户。'}
              </p>
            )}
            {filtered.map((u) => {
              const on = u.username === selected
              return (
                <div
                  key={u.username}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(u.username)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelected(u.username)
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                    on
                      ? 'border-primary/40 bg-accent/40'
                      : 'border-border hover:bg-accent/30',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {u.displayName || u.username}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        @{u.username}
                      </span>
                    </span>
                    {u.online && <Badge className="bg-success text-white">在线</Badge>}
                    {u.isAdmin && <Badge variant="secondary">管理员</Badge>}
                    {u.disabled && <Badge variant="destructive">已禁用</Badge>}
                    {u.chatDisabled && <Badge variant="outline">禁聊天</Badge>}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {formatClient(u.client)}
                      {u.client?.reportedAt
                        ? ` · ${new Date(u.client.reportedAt).toLocaleString()}`
                        : ''}
                    </span>
                    <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title={u.isAdmin ? '取消管理员' : '设为管理员'}
                        onClick={() => void quickToggle(u, 'isAdmin')}
                      >
                        {u.isAdmin ? (
                          <ShieldOff className="size-4" />
                        ) : (
                          <ShieldCheck className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title={u.disabled ? '启用账号' : '禁用账号'}
                        onClick={() => void quickToggle(u, 'disabled')}
                      >
                        {u.disabled ? (
                          <CircleCheck className="size-4" />
                        ) : (
                          <Ban className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* 编辑 + 新增 表单 */}
        <div className="flex w-full shrink-0 flex-col gap-4 self-start xl:w-[380px] xl:sticky xl:top-6">
          <EditUserCard
            key={selectedUser?.username || 'none'}
            user={selectedUser}
            onSave={saveUser}
          />
          <CreateUserCard onCreate={createUser} />
        </div>
      </div>
    </PanelScaffold>
  )
}

function EditUserCard({
  user,
  onSave,
}: {
  user: AdminUser | null
  onSave: (username: string, input: Record<string, unknown>) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [isAdmin, setIsAdmin] = useState(Boolean(user?.isAdmin))
  const [disabled, setDisabled] = useState(Boolean(user?.disabled))
  const [chatDisabled, setChatDisabled] = useState(Boolean(user?.chatDisabled))
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      await onSave(user.username, { displayName, password, avatar, bio, isAdmin, disabled, chatDisabled })
      setPassword('')
      toast.success(`已保存用户 ${user.username}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">编辑用户</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">请从左侧选择一个用户。</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">编辑用户 · {user.username}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="显示名">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="重设密码">
          <Input
            type="password"
            value={password}
            placeholder="留空则不修改"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="头像">
          <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} />
        </Field>
        <Field label="简介">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </Field>
        <div className="flex items-center justify-between">
          <Label className="cursor-default">管理员</Label>
          <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="cursor-default">禁用账号</Label>
          <Switch checked={disabled} onCheckedChange={setDisabled} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="cursor-default">禁止协作聊天</Label>
            <p className="truncate text-xs text-muted-foreground">无聊天入口、不收消息、别人发他也不弹窗</p>
          </div>
          <Switch checked={chatDisabled} onCheckedChange={setChatDisabled} />
        </div>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存用户
        </Button>
      </CardContent>
    </Card>
  )
}

function CreateUserCard({
  onCreate,
}: {
  onCreate: (input: {
    username: string
    displayName: string
    password: string
    avatar: string
    bio: string
    isAdmin: boolean
    chatDisabled: boolean
  }) => Promise<AdminUser | null>
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState('')
  const [bio, setBio] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [chatDisabled, setChatDisabled] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim() || !password) {
      toast.error('请填写用户名与密码')
      return
    }
    setBusy(true)
    try {
      const created = await onCreate({ username, displayName, password, avatar, bio, isAdmin, chatDisabled })
      toast.success(`已创建用户 ${created?.username || username}`)
      setUsername('')
      setDisplayName('')
      setPassword('')
      setAvatar('')
      setBio('')
      setIsAdmin(false)
      setChatDisabled(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="size-4 text-primary" />
          新增用户
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="用户名">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="显示名">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="头像 (可选, 单字符或 emoji)">
          <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} />
        </Field>
        <Field label="简介">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </Field>
        <div className="flex items-center justify-between">
          <Label className="cursor-default">赋予管理员权限</Label>
          <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="cursor-default">禁止协作聊天</Label>
            <p className="truncate text-xs text-muted-foreground">无聊天入口、不收消息、不弹窗</p>
          </div>
          <Switch checked={chatDisabled} onCheckedChange={setChatDisabled} />
        </div>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          创建用户
        </Button>
      </CardContent>
    </Card>
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
