import { useState } from 'react'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useAuth } from '@/hooks/useAuth'
import type { CollabSettings } from '@/types/settings'

// 协作通知开关项 (对应 collab.notify_* 字段)。
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
  // 旧版默认: 前三项默认开 (!== false), user_online 默认关。
  defaultOn: boolean
}> = [
  { key: 'notify_message_popup', label: '消息弹窗', desc: '收到新消息时在应用内提示', defaultOn: true },
  { key: 'notify_system_notification', label: '系统通知', desc: '通过操作系统通知中心提醒', defaultOn: true },
  { key: 'notify_sound_play', label: '提示音', desc: '收到新消息时播放提示音', defaultOn: true },
  { key: 'notify_user_online', label: '上线提醒', desc: '有成员上线时提醒', defaultOn: false },
]

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2).toUpperCase()
}

export function LoggedInView() {
  const collab = useAppStore((s) => s.settings?.collab)
  const patchSection = useAppStore((s) => s.patchSection)
  const profile = useAuthStore((s) => s.profile)
  const { logout } = useAuth()

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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Card>
        <CardContent className="flex items-center gap-4 pt-6">
          <Avatar size="lg">
            {avatar && <AvatarImage src={avatar} alt={displayName} />}
            <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{displayName}</p>
            {username && username !== displayName && (
              <p className="truncate text-xs text-muted-foreground">{username}</p>
            )}
            <p className="truncate text-xs text-success">已连接协作服务</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut />
            {loggingOut ? '退出中…' : '退出'}
          </Button>
        </CardContent>
      </Card>

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
    </div>
  )
}
