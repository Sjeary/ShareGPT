import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  Loader2,
  LogIn,
  Download,
  Sparkles,
  X,
  Cable,
  Eye,
  MessageCircle,
  Bot,
  BarChart3,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/hooks/useAuth'
import { ImportActions } from './ImportActions'
import { compareVersions, checkGithubUpdate, type BootstrapUpdate } from './bootstrap'

// 登录页「发现新版本」提醒。自动更新源 = GitHub Releases (参考 cc-switch), 不再查询任何自建服务器,
// 与本机版本比较; 有新版且未被「不再提示」(按版本记忆) 时展示。GitHub 不可达 -> 静默不显示。
function LoginUpdateBanner() {
  const meta = useAppStore((s) => s.meta)
  const dismissed = useAppStore((s) => s.settings?.ui?.dismissed_update_versions)
  const patchSection = useAppStore((s) => s.patchSection)
  const [info, setInfo] = useState<BootstrapUpdate | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const update = await checkGithubUpdate()
      if (alive) setInfo(update)
    })()
    return () => {
      alive = false
    }
  }, [])

  const current = String(meta.version || '')
  const latest = info?.version || ''
  const downloadUrl = info?.url || info?.htmlUrl || ''
  const hasNew = Boolean(latest && current && downloadUrl && compareVersions(latest, current) > 0)
  const isDismissed = Array.isArray(dismissed) && dismissed.includes(latest)
  if (!hasNew || isDismissed) return null

  async function dismiss() {
    const next = Array.from(new Set([...(dismissed ?? []), latest]))
    await patchSection('ui', { dismissed_update_versions: next }).catch(() => undefined)
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            发现新版本 <span className="selectable">v{latest}</span>
          </p>
          {info?.notes && (
            <p className="selectable mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {info.notes}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          title="不再提示此版本"
          className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => downloadUrl && void api.openExternal(downloadUrl)}>
          <Download />
          下载新版本
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          不再提示
        </Button>
      </div>
    </div>
  )
}

type ErrorField = 'server' | 'username' | 'password'

// 未登录态: 居中登录表单。预填 store.settings.collab。
export function LoginForm() {
  const collab = useAppStore((s) => s.settings?.collab)
  const meta = useAppStore((s) => s.meta)
  const previewMode = useAppStore((s) => s.previewMode)
  const setPreviewMode = useAppStore((s) => s.setPreviewMode)
  const { login } = useAuth()

  // 品牌名: 取 app 元信息 productName, 去掉「Sender/Receiver」后缀, 回退 ShareGPT。
  const brandName = String((meta?.productName as string) || 'ShareGPT').replace(
    /\s+(Sender|Receiver)$/i,
    '',
  )
  // 本表单既用于应用级登录页(LoginScreen), 也用于 Shell 内账户面板(预览态下未登录时)。
  // 仅在登录页(非预览态)给"先逛逛"入口与品牌头; 预览态下已在 Shell 内, 不再重复。
  const showPreviewEntry = !previewMode

  const [serverUrl, setServerUrl] = useState(collab?.server_url ?? '')
  const [username, setUsername] = useState(collab?.last_username ?? '')
  const [rememberPassword, setRememberPassword] = useState(collab?.remember_password ?? false)
  const [password, setPassword] = useState(
    collab?.remember_password ? (collab?.saved_password ?? '') : '',
  )
  const [submitting, setSubmitting] = useState(false)
  // 内联错误条 + 出错字段 (用于 aria-invalid 触发红边)。
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<ErrorField | null>(null)

  const serverRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  // 登录失败时聚焦并选中密码框 (移植自旧 renderer.js focusCollabField("c_password", true) ~4688)。
  const passwordRef = useRef<HTMLInputElement>(null)

  function focusField(field: ErrorField, select = false) {
    const ref = field === 'server' ? serverRef : field === 'username' ? usernameRef : passwordRef
    window.setTimeout(() => {
      ref.current?.focus()
      if (select) ref.current?.select()
    }, 0)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return

    // 提交前必填校验: 聚焦首个空字段并显示内联错误 (旧 collabLogin -> performCollabLogin 校验)。
    const trimmedServer = serverUrl.trim()
    const trimmedUser = username.trim()
    if (!trimmedServer) {
      setError('请填写服务地址')
      setErrorField('server')
      focusField('server')
      return
    }
    if (!trimmedUser) {
      setError('请填写账号')
      setErrorField('username')
      focusField('username')
      return
    }
    if (!password) {
      setError('请填写密码')
      setErrorField('password')
      focusField('password')
      return
    }

    setError('')
    setErrorField(null)
    setSubmitting(true)
    try {
      const profile = await login({ serverUrl, username, password, rememberPassword })
      toast.success(`登录成功，欢迎 ${profile.displayName}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请稍后重试'
      toast.error(message)
      // 内联持久错误条 + 红边密码框 + 聚焦选中 (对齐旧版失败聚焦密码语义)。
      setError(message)
      setErrorField('password')
      focusField('password', true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // 外层只负责竖向滚动(窗口矮时), 内层 grid 居中一列 max-w-sm 内容,
    // 避免 flex + overflow 同时作用时出现的横向偏移。
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full place-items-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          <LoginUpdateBanner />

          {/* 品牌头 (仅登录页): logo + 名称 + 友好欢迎语 + 一句话功能点, 让开局不再是一张冷冰冰的表单。 */}
          {showPreviewEntry && (
            <div className="flex w-full flex-col items-center gap-3 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <Cable className="size-7" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">欢迎使用 {brandName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  一站式的团队协作与 AI 网页客户端 · 登录后开启全部能力
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="size-3.5 text-primary" />
                  协作聊天
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Bot className="size-3.5 text-primary" />
                  内嵌 AI 网页
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BarChart3 className="size-3.5 text-primary" />
                  用量统计
                </span>
              </div>
            </div>
          )}

          <Card className="w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">登录协作服务</CardTitle>
              <CardDescription>填写服务地址与账号即可登录</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={handleSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="account-server">服务地址</Label>
                  <Input
                    ref={serverRef}
                    id="account-server"
                    placeholder="http://example.com:8088"
                    autoComplete="off"
                    spellCheck={false}
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    disabled={submitting}
                    aria-invalid={errorField === 'server' || undefined}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="account-username">账号</Label>
                  <Input
                    ref={usernameRef}
                    id="account-username"
                    placeholder="用户名"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={submitting}
                    aria-invalid={errorField === 'username' || undefined}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="account-password">密码</Label>
                  <Input
                    ref={passwordRef}
                    id="account-password"
                    type="password"
                    placeholder="密码"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    aria-invalid={errorField === 'password' || undefined}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <Label htmlFor="account-remember" className="cursor-pointer text-sm font-normal">
                    记住密码
                  </Label>
                  <Switch
                    id="account-remember"
                    checked={rememberPassword}
                    onCheckedChange={setRememberPassword}
                    disabled={submitting}
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      登录中…
                    </>
                  ) : (
                    <>
                      <LogIn />
                      登录
                    </>
                  )}
                </Button>
              </form>

              <Separator className="my-4" />

              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">从备份文件恢复本机配置或资料包</p>
                <ImportActions />
              </div>
            </CardContent>
          </Card>

          {/* 不登录也能先逛逛: 进入只读预览态 (Shell 顶部会挂"预览条"引导随时登录)。 */}
          {showPreviewEntry && (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setPreviewMode(true)}
            >
              <Eye />
              先不登录，随便逛逛
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
