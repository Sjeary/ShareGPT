import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'

import { LogOut, UserCog, Laptop } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { CollabSettings } from '@/types/settings'
import { BrowserPrivacySection } from './BrowserPrivacySection'
import { InterfaceSettings } from './InterfaceSettings'
import { SessionRecoveryForm } from './SessionRecoveryForm'
import { ImportActions } from './ImportActions'
import { AboutSection, ChangelogSection, UpdateSection } from './AppInfoSections'

// 协作通知开关项 (对应 collab.notify_* 字段，全部默认关闭，按需开启)。
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

const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'account', label: '账户' },
  { id: 'interface', label: '界面与通知' },
  { id: 'privacy', label: '隐私与环境' },
  { id: 'data', label: '本机资料' },
  { id: 'updates', label: '更新与关于' },
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

// 反馈建议: 登录用户提交一条文本反馈, 直连协作服务器 POST /api/feedback (Bearer)。
// 管理端在 Admin 控制台「反馈」面板查看。
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
      </CardHeader>
      <CardContent className="grid gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="使用中的问题或建议，写在这里提交给管理员～"
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

export function LoggedInView() {
  const collab = useAppStore((s) => s.settings?.collab)
  const patchSection = useAppStore((s) => s.patchSection)
  const profile = useAuthStore((s) => s.profile)
  const { logout } = useAuth()
  const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode)

  const [category, setCategory] = useState<SettingsCategory>('all')
  const [loggingOut, setLoggingOut] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const displayName = profile?.displayName || collab?.last_username || '未知账号'
  const username = profile?.username || collab?.last_username || ''
  const avatar = profile?.avatar || collab?.last_avatar || ''

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
    const serverUrl = collab?.server_url ?? ''
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
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <div
        role="tablist"
        aria-label="设置分类"
        className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-lg border border-border bg-background/95 p-1.5 backdrop-blur-sm"
      >
        {SETTINGS_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            onClick={() => setCategory(item.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              category === item.id
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <SessionRecoveryForm />

      {show('account') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">账户</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-4">
              <Avatar size="lg">
                {avatar && <AvatarImage src={avatar} alt={displayName} />}
                <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="selectable truncate text-base font-semibold">{displayName}</p>
                {username && username !== displayName && (
                  <p className="selectable truncate text-xs text-muted-foreground">{username}</p>
                )}
                <p className="truncate text-xs text-success">已连接协作服务</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </CardContent>
        </Card>
      )}

      {show('interface') && (
        <>
          <InterfaceSettings />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">协作通知</CardTitle>
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
        </>
      )}

      {show('updates') && (
        <>
          <UpdateSection />
          <ChangelogSection />
          <FeedbackSection />
          <AboutSection />
        </>
      )}

      {show('data') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">本机资料</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportActions />
          </CardContent>
        </Card>
      )}

      {show('privacy') && <BrowserPrivacySection />}
    </div>
  )
}
