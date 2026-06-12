import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, LogIn } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/hooks/useAuth'
import { ImportActions } from './ImportActions'

type ErrorField = 'server' | 'username' | 'password'

// 未登录态: 居中登录表单。预填 store.settings.collab。
export function LoginForm() {
  const collab = useAppStore((s) => s.settings?.collab)
  const { login } = useAuth()

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
    const ref =
      field === 'server' ? serverRef : field === 'username' ? usernameRef : passwordRef
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
    <div className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">登录协作服务</CardTitle>
          <CardDescription>连接到协作服务器以使用聊天与统计</CardDescription>
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
            <p className="text-xs text-muted-foreground">
              从备份文件恢复本机配置或资料包
            </p>
            <ImportActions />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
