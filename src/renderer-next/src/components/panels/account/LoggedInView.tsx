import { useState } from 'react'
import { toast } from 'sonner'
import {
  Copy,
  HardDrive,
  Keyboard,
  Laptop,
  LayoutGrid,
  LogOut,
  Palette,
  Shield,
  Sparkles,
  UserCog,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import type { CollabSettings } from '@/types/settings'
import { AboutSection, ChangelogSection, UpdateSection } from './AppInfoSections'
import { BrowserPrivacySection } from './BrowserPrivacySection'
import { ImportActions } from './ImportActions'
import { InterfaceSettings } from './InterfaceSettings'
import { SessionRecoveryForm } from './SessionRecoveryForm'

const NOTIFY_FIELDS: ReadonlyArray<{
  key: keyof Pick<
    CollabSettings,
    | 'notify_message_popup'
    | 'notify_system_notification'
    | 'notify_sound_play'
    | 'notify_user_online'
  >
  label: string
  desc: string
  defaultOn: boolean
}> = [
  {
    key: 'notify_message_popup',
    label: '消息弹窗',
    desc: '收到新消息时在应用内右上角提示（默认关闭）',
    defaultOn: false,
  },
  {
    key: 'notify_system_notification',
    label: '系统通知',
    desc: '通过操作系统通知中心提醒（默认关闭）',
    defaultOn: false,
  },
  {
    key: 'notify_sound_play',
    label: '提示音',
    desc: '收到新消息时播放提示音（默认关闭）',
    defaultOn: false,
  },
  {
    key: 'notify_user_online',
    label: '上线提醒',
    desc: '有成员上线时提醒（默认关闭）',
    defaultOn: false,
  },
]

type SettingsCategory = 'all' | 'account' | 'interface' | 'privacy' | 'data' | 'updates'

const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategory
  label: string
  desc: string
  icon: LucideIcon
}> = [
  { id: 'all', label: '全部设置', desc: '一览所有配置项', icon: LayoutGrid },
  { id: 'account', label: '账户与权限', desc: '身份、资料与工作区', icon: UserRound },
  { id: 'interface', label: '界面与通知', desc: '主题、模块与快捷键', icon: Palette },
  { id: 'privacy', label: '隐私与环境', desc: '浏览器分区与清理', icon: Shield },
  { id: 'data', label: '本机资料', desc: '备份导出与导入', icon: HardDrive },
  { id: 'updates', label: '更新与反馈', desc: '版本日志与建议', icon: Sparkles },
]

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2).toUpperCase()
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function FeedbackSection() {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    const body = text.trim()
    if (!body) {
      toast.error('请先填写反馈内容')
      return
    }
    const serverUrl = safeText(useAppStore.getState().settings?.collab?.server_url)
    const token = useAuthStore.getState().token
    if (!serverUrl || !token) {
      toast.error('请先登录后再提交反馈')
      return
    }
    setSending(true)
    try {
      const resp = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: body.slice(0, 2000),
          version: safeText(useAppStore.getState().meta.version),
          platform: String(api.platform || ''),
        }),
      })
      if (!resp.ok) {
        const t = await resp.text().catch(() => '')
        throw new Error(t || `提交失败（${resp.status}）`)
      }
      toast.success('感谢反馈，已提交！')
      setText('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交反馈失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">反馈建议</CardTitle>
        <CardDescription>直接发送给团队管理员，帮助持续改进产品体验。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="使用中的问题或建议，写在这里提交给管理员…"
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length}/2000</span>
          <Button size="sm" onClick={submit} disabled={sending || !text.trim()}>
            {sending ? '提交中…' : '提交反馈'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ShortcutsCard() {
  const isMac = api.platform === 'darwin'
  const mod = isMac ? '⌘' : 'Ctrl'
  const items = [
    { keys: `${mod} + K`, label: '打开全局快速跳转与命令面板' },
    { keys: 'F11', label: '切换全屏浏览 AI 网页' },
    { keys: 'Esc', label: '恢复已隐藏的侧栏与顶部信息栏' },
    { keys: `${mod} + 滚轮`, label: '缩放内嵌 AI 网页字体大小' },
  ]
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Keyboard className="size-4 text-primary" />
          常用快捷键
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.keys}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs"
          >
            <span className="text-muted-foreground">{item.label}</span>
            <kbd className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
              {item.keys}
            </kbd>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function LoggedInView() {
  const collab = useAppStore((s) => s.settings?.collab)
  const patchSection = useAppStore((s) => s.patchSection)
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode)
  const profile = useAuthStore((s) => s.profile)
  const { logout } = useAuth()

  const [category, setCategory] = useState<SettingsCategory>('all')
  const [loggingOut, setLoggingOut] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const displayName = profile?.displayName || collab?.last_username || '未知账号'
  const username = profile?.username || collab?.last_username || ''
  const avatar = profile?.avatar || collab?.last_avatar || ''
  const serverUrl = safeText(collab?.server_url)
  const isAdmin = profile?.isAdmin === true

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      toast.success('已退出登录')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '退出失败')
    } finally {
      setLoggingOut(false)
    }
  }

  async function handleEnterPersonal() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      setWorkspaceMode('personal')
      toast.success('已进入个人工作区')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换个人工作区失败')
    } finally {
      setLoggingOut(false)
    }
  }

  async function handleEditProfile() {
    const token = useAuthStore.getState().token
    const user = username || useChatStore.getState().identity.username
    if (!token) {
      toast.error('请先登录账号，再打开个人资料。')
      return
    }
    try {
      await api.openProfileEditor({ serverUrl, token, username: user })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开个人资料失败')
    }
  }

  async function copyServerUrl() {
    if (!serverUrl) return
    try {
      await navigator.clipboard.writeText(serverUrl)
      toast.success('已复制团队服务器地址')
    } catch {
      toast.error('复制失败')
    }
  }

  async function toggleNotify(key: string, defaultOn: boolean, next: boolean) {
    setSavingKey(key)
    try {
      await patchSection('collab', { [key]: next } as Partial<CollabSettings>)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存设置失败')
    } finally {
      setSavingKey(null)
    }
    void defaultOn
  }

  const show = (target: Exclude<SettingsCategory, 'all'>) =>
    category === 'all' || category === target

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start">
      {/* 左侧固定设置分类导轨：点击即时切换，无 backdrop-blur 拖慢与强制重挂载 */}
      <nav
        role="tablist"
        aria-label="设置分类"
        className="flex flex-wrap gap-1.5 lg:sticky lg:top-6 lg:flex-col lg:gap-1"
      >
        {SETTINGS_CATEGORIES.map((item) => {
          const Icon = item.icon
          const selected = category === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setCategory(item.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-card/60 text-foreground hover:bg-muted lg:bg-transparent',
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  selected ? 'text-primary-foreground' : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium lg:text-sm">{item.label}</span>
                <span
                  className={cn(
                    'hidden truncate text-[11px] lg:block',
                    selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {item.desc}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* 右侧主内容区：不按 category 设 key，切换分类零卸载/重拉 */}
      <div
        className={cn('flex min-w-0 flex-col gap-4', category === 'all' && 'settings-all-stack')}
      >
        <SessionRecoveryForm />

        {show('account') && (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <Avatar size="lg" className="ring-2 ring-primary/20">
                    {avatar && <AvatarImage src={avatar} alt={displayName} />}
                    <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="selectable truncate text-lg font-semibold leading-tight">
                        {displayName}
                      </p>
                      <Badge variant={isAdmin ? 'default' : 'secondary'} className="text-[11px]">
                        {isAdmin ? '管理员' : '团队成员'}
                      </Badge>
                    </div>
                    {username && (
                      <p className="selectable mt-0.5 truncate text-xs text-muted-foreground">
                        @{username}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-success">
                        <span className="size-1.5 rounded-full bg-success" />
                        已连接协作服务
                      </span>
                      {serverUrl && (
                        <button
                          type="button"
                          onClick={() => void copyServerUrl()}
                          title="点击复制团队服务器地址"
                          className="inline-flex max-w-xs items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <span className="truncate">{serverUrl}</span>
                          <Copy className="size-3 shrink-0" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              <Button variant="outline" size="sm" onClick={handleEditProfile}>
                <UserCog />
                编辑个人资料
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEnterPersonal}
                disabled={loggingOut}
              >
                <Laptop />
                个人工作区
              </Button>
              <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
                <LogOut />
                {loggingOut ? '退出中…' : '退出登录'}
              </Button>
            </CardContent>
          </Card>
        )}

        {show('interface') && (
          <>
            <InterfaceSettings />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">协作通知</CardTitle>
                <CardDescription>控制团队聊天与成员上线提醒方式。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1">
                {NOTIFY_FIELDS.map((item, idx) => {
                  const raw = collab?.[item.key]
                  const checked = item.defaultOn ? raw !== false : raw === true
                  return (
                    <div key={item.key}>
                      {idx > 0 && <Separator className="my-1" />}
                      <div className="flex items-center justify-between gap-3 py-1.5">
                        <div className="min-w-0">
                          <Label htmlFor={`notify-${item.key}`} className="cursor-pointer">
                            {item.label}
                          </Label>
                          <p className="truncate text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                        <Switch
                          id={`notify-${item.key}`}
                          checked={checked}
                          disabled={savingKey === item.key}
                          onCheckedChange={(next) => toggleNotify(item.key, item.defaultOn, next)}
                        />
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
            <ShortcutsCard />
          </>
        )}

        {show('privacy') && <BrowserPrivacySection />}

        {show('data') && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">本机资料</CardTitle>
              <CardDescription>导出或从备份恢复当前账号的本地配置与资料包。</CardDescription>
            </CardHeader>
            <CardContent>
              <ImportActions />
            </CardContent>
          </Card>
        )}

        {show('updates') && (
          <>
            <UpdateSection />
            <ChangelogSection />
            <FeedbackSection />
            <AboutSection />
          </>
        )}
      </div>
    </div>
  )
}
