import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Minus, Square, X, Save, UserRound } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import './index.css'

function safeText(v: unknown): string {
  return String(v ?? '').trim()
}
function firstChar(v: unknown): string {
  const arr = Array.from(safeText(v))
  return arr.length ? arr[0] : ''
}

const api = typeof window !== 'undefined' ? window.api : undefined

// 渲染前据 settings.ui.theme / localStorage 定主题(默认深色), 与主窗一致。
function applyInitialTheme() {
  let dark = true
  try {
    dark = localStorage.getItem('sharegpt-theme') !== 'light'
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle('dark', dark)
}
applyInitialTheme()

interface ProfileData {
  username: string
  displayName: string
  bio: string
  avatar: string
}

function WindowControls() {
  return (
    <div className="app-no-drag flex items-center gap-1">
      <button
        onClick={() => api?.minimizeWindow?.()}
        aria-label="最小化"
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Minus className="size-4" />
      </button>
      <button
        onClick={() => api?.toggleMaximizeWindow?.()}
        aria-label="最大化"
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Square className="size-3.5" />
      </button>
      <button
        onClick={() => api?.closeWindow?.()}
        aria-label="关闭"
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive hover:text-destructive-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function ProfileApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const serverUrl = safeText(params.get('serverUrl')).replace(/\/+$/, '')
  const token = safeText(params.get('token'))
  const queryUsername = safeText(params.get('username'))

  const [username, setUsername] = useState(queryUsername)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatar, setAvatar] = useState('')
  const [roomScope, setRoomScope] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 头像取首字; 与主窗 settings.ui.theme 对齐主题。
  useEffect(() => {
    api
      ?.loadSettings?.()
      .then((s) => {
        const theme = (s as { ui?: { theme?: string } })?.ui?.theme
        document.documentElement.classList.toggle('dark', safeText(theme).toLowerCase() !== 'light')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!serverUrl || !token) {
      setError('登录信息已失效，请回到主页面重新打开个人资料。')
      return
    }
    void (async () => {
      try {
        const resp = await fetch(`${serverUrl}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) throw new Error((await resp.text()) || `读取资料失败（${resp.status}）`)
        const payload = await resp.json()
        const p = (payload?.profile ?? {}) as Partial<ProfileData>
        setUsername(safeText(p.username) || queryUsername)
        setDisplayName(safeText(p.displayName) || safeText(p.username) || queryUsername)
        setBio(safeText(p.bio))
        setAvatar(firstChar(p.avatar))
        setRoomScope(safeText(payload?.roomScope))
        setLoaded(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : '读取资料失败')
      }
    })()
  }, [serverUrl, token, queryUsername])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const dn = safeText(displayName).slice(0, 30) || username
      const b = safeText(bio).slice(0, 200)
      const av = firstChar(avatar)
      const resp = await fetch(`${serverUrl}/api/profile/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: dn, bio: b, avatar: av, avatarKind: 'emoji' }),
      })
      if (!resp.ok) throw new Error((await resp.text()) || `保存失败（${resp.status}）`)
      const payload = await resp.json()
      const profile = payload?.profile ?? {
        username,
        displayName: dn,
        bio: b,
        avatar: av,
        avatarKind: 'emoji',
      }
      api?.emitProfileUpdated?.({ profile })
      toast.success('资料已保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const previewName = safeText(displayName) || username || '-'
  const previewBio = safeText(bio) || '暂未填写简介'
  const previewAvatar = firstChar(avatar) || username.slice(0, 1).toUpperCase() || '?'

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 标题栏 (可拖拽) */}
      <header className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <UserRound className="size-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">个人资料</span>
        </div>
        <WindowControls />
      </header>

      {error ? (
        <div className="grid flex-1 place-items-center p-6">
          <p className="max-w-sm text-center text-sm text-destructive">{error}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-[1fr_320px]">
            {/* 表单 */}
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold">编辑显示信息</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                保存后会同步显示在账号信息、联系人列表和聊天消息里。
              </p>
              <div className="mt-5 grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="p-username">登录账号</Label>
                  <Input id="p-username" value={username} disabled />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-name">显示昵称</Label>
                  <Input
                    id="p-name"
                    maxLength={30}
                    placeholder="例如 小王 / 设计部 / 助理 01"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={!loaded}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-bio">一句话介绍</Label>
                  <textarea
                    id="p-bio"
                    rows={5}
                    maxLength={200}
                    placeholder="例如：白天在线，急事请直接私聊"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    disabled={!loaded}
                    className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="p-avatar">头像文字</Label>
                  <Input
                    id="p-avatar"
                    maxLength={4}
                    placeholder="例如 王 / A / 星"
                    value={avatar}
                    onChange={(e) => setAvatar(firstChar(e.target.value))}
                    disabled={!loaded}
                    className="w-28"
                  />
                </div>
              </div>
            </section>

            {/* 预览 */}
            <aside className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold">别人看到的样子</h2>
                <div className="mt-4 flex items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                    {previewAvatar}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{previewName}</div>
                    <div className="truncate text-xs text-muted-foreground">{previewBio}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                <p className="mb-1.5">· 昵称尽量简洁，列表里更清楚。</p>
                <p className="mb-1.5">· 头像可用一个字或符号，便于识别。</p>
                <p>· 简介可填在线时间、用途或提醒信息。</p>
              </div>
              {roomScope && (
                <p className="px-1 text-xs text-muted-foreground">当前房间：{roomScope}</p>
              )}
            </aside>
          </div>
        </div>
      )}

      {/* 底部操作 */}
      {!error && (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="ghost" onClick={() => api?.closeWindow?.()}>
            关闭
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!loaded || saving}
            className={cn(saving && 'opacity-80')}
          >
            <Save className="size-4" />
            {saving ? '保存中…' : '保存更改'}
          </Button>
        </footer>
      )}

      <Toaster position="bottom-right" richColors />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProfileApp />
  </StrictMode>,
)
