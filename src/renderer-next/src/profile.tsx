import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, Check, Loader2, RefreshCw, Save, X } from 'lucide-react'
import { Titlebar } from '@/components/layout/Titlebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export function ProfileApp() {
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
  const [error, setError] = useState(() =>
    !serverUrl || !token ? '登录信息已失效，请回到主页面重新打开个人资料。' : '',
  )
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)
  const [saved, setSaved] = useState<ProfileData | null>(null)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  // 头像取首字; 与主窗 settings.ui.theme 对齐主题。
  useEffect(() => {
    if (!api) return
    void api
      .getSettingsPrincipal()
      .then((principal) =>
        api.loadSettings({
          expectedPrincipalId: principal.principalId,
          expectedPrincipalGeneration: principal.generation,
        }),
      )
      .then((s) => {
        const theme = (s as { ui?: { theme?: string } })?.ui?.theme
        const nextDark = safeText(theme).toLowerCase() !== 'light'
        document.documentElement.classList.toggle('dark', nextDark)
        setDark(nextDark)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    if (!serverUrl || !token) {
      return
    }
    void (async () => {
      try {
        const resp = await fetch(`${serverUrl}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!resp.ok) throw new Error((await resp.text()) || `读取资料失败（${resp.status}）`)
        const payload = await resp.json()
        const p = (payload?.profile ?? {}) as Partial<ProfileData>
        if (controller.signal.aborted) return
        setUsername(safeText(p.username) || queryUsername)
        setDisplayName(safeText(p.displayName) || safeText(p.username) || queryUsername)
        setBio(safeText(p.bio))
        setAvatar(firstChar(p.avatar))
        setRoomScope(safeText(payload?.roomScope))
        setSaved({
          username: safeText(p.username) || queryUsername,
          displayName: safeText(p.displayName) || safeText(p.username) || queryUsername,
          bio: safeText(p.bio),
          avatar: firstChar(p.avatar),
        })
        setLoaded(true)
      } catch (e) {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : '读取资料失败')
      }
    })()
    return () => controller.abort()
  }, [serverUrl, token, queryUsername, retry])

  const dirty =
    saved !== null &&
    ((safeText(displayName) || username) !== saved.displayName ||
      safeText(bio) !== saved.bio ||
      firstChar(avatar) !== saved.avatar)

  async function handleSave() {
    if (saving || !loaded || !dirty) return
    setSaveError('')
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
      const accepted = {
        username: safeText(profile.username) || username,
        displayName: safeText(profile.displayName) || dn,
        bio: safeText(profile.bio),
        avatar: firstChar(profile.avatar),
      }
      setDisplayName(accepted.displayName)
      setBio(accepted.bio)
      setAvatar(accepted.avatar)
      setSaved(accepted)
      api?.emitProfileUpdated?.({ profile })
      toast.success('资料已保存')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const previewName = safeText(displayName) || username || '-'
  const previewBio = safeText(bio) || '暂未填写简介'
  const previewAvatar = firstChar(avatar) || username.slice(0, 1).toUpperCase() || '?'

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar title="个人资料" auxiliary />

      {error ? (
        <div className="grid flex-1 place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
            {serverUrl && token && (
              <Button
                variant="outline"
                onClick={() => {
                  setError('')
                  setRetry((value) => value + 1)
                }}
              >
                <RefreshCw />
                重新加载
              </Button>
            )}
          </div>
        </div>
      ) : !loaded ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          正在加载资料
        </div>
      ) : (
        <main className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8">
          <form
            id="profile-form"
            className="mx-auto max-w-xl"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <section
              aria-label="资料预览"
              className="flex min-w-0 items-center gap-4 border-b border-border pb-5"
            >
              <Avatar size="lg" className="size-14 data-[size=lg]:size-14">
                <AvatarFallback className="text-xl">{previewAvatar}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-lg font-semibold">{previewName}</h1>
                <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
                  {previewBio}
                </p>
              </div>
            </section>
            <dl className="grid gap-3 border-b border-border py-4 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">登录账号</dt>
                <dd className="mt-1 select-text break-all">{username}</dd>
              </div>
              {roomScope && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">当前房间</dt>
                  <dd className="mt-1 select-text break-all">{roomScope}</dd>
                </div>
              )}
            </dl>
            <fieldset disabled={saving} className="mt-5 grid min-w-0 gap-5 disabled:opacity-60">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="p-name">显示昵称</Label>
                  <span id="p-name-count" className="text-xs tabular-nums text-muted-foreground">
                    {displayName.length}/30
                  </span>
                </div>
                <Input
                  id="p-name"
                  maxLength={30}
                  placeholder={username}
                  value={displayName}
                  aria-describedby="p-name-count"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-avatar">头像文字</Label>
                <Input
                  id="p-avatar"
                  maxLength={4}
                  placeholder="字或符号"
                  value={avatar}
                  onChange={(event) => setAvatar(firstChar(event.target.value))}
                  className="w-28"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="p-bio">个人简介</Label>
                  <span id="p-bio-count" className="text-xs tabular-nums text-muted-foreground">
                    {bio.length}/200
                  </span>
                </div>
                <textarea
                  id="p-bio"
                  rows={3}
                  maxLength={200}
                  placeholder="暂未填写简介"
                  value={bio}
                  aria-describedby="p-bio-count"
                  onChange={(event) => setBio(event.target.value)}
                  className="w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                />
              </div>
            </fieldset>
          </form>
        </main>
      )}

      <footer className="shrink-0 border-t border-border px-5 py-3 sm:px-8">
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-end gap-3">
          <div className="min-w-0 flex-1 basis-24 text-xs">
            {saveError ? (
              <p role="alert" className="break-words text-destructive">
                {saveError}
              </p>
            ) : (
              <p role="status" className="flex items-center gap-1.5 text-muted-foreground">
                {loaded && !dirty && <Check className="size-3.5 shrink-0" />}
                {saving ? '正在保存' : loaded ? (dirty ? '有未保存的更改' : '已同步') : ''}
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={() => api?.closeWindow?.()} disabled={saving}>
            <X />
            关闭
          </Button>
          <Button type="submit" form="profile-form" disabled={!loaded || saving || !dirty}>
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />}
            {saving ? '保存中…' : '保存更改'}
          </Button>
        </div>
      </footer>

      <Toaster position="top-right" theme={dark ? 'dark' : 'light'} richColors />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProfileApp />
  </StrictMode>,
)
