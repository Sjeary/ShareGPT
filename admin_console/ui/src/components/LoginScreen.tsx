import { useEffect, useState } from 'react'
import { ShieldCheck, Rocket, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAdminStore } from '@/store/useAdminStore'

type Mode = 'admin' | 'dev'

export function LoginScreen() {
  const storeServerUrl = useAdminStore((s) => s.serverUrl)
  const storeUsername = useAdminStore((s) => s.username)
  const busy = useAdminStore((s) => s.busy)
  const login = useAdminStore((s) => s.login)
  const setupFirstAdmin = useAdminStore((s) => s.setupFirstAdmin)
  const devLogin = useAdminStore((s) => s.devLogin)

  const [mode, setMode] = useState<Mode>('admin')
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [devKey, setDevKey] = useState('')

  useEffect(() => {
    setServerUrl((cur) => cur || storeServerUrl)
  }, [storeServerUrl])
  useEffect(() => {
    setUsername((cur) => cur || storeUsername)
  }, [storeUsername])

  async function run(action: 'login' | 'setup' | 'dev') {
    try {
      if (action === 'login') await login(serverUrl, username, password)
      else if (action === 'setup') await setupFirstAdmin(serverUrl, username, password)
      else await devLogin(serverUrl, devKey)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const isDev = mode === 'dev'

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div
            className={cn(
              'mb-2 grid size-12 place-items-center rounded-2xl',
              isDev ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/15 text-primary',
            )}
          >
            {isDev ? <Rocket className="size-6" /> : <ShieldCheck className="size-6" />}
          </div>
          <CardTitle className="text-lg">{isDev ? '开发者登录' : '管理员登录'}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isDev
              ? '用开发者密钥登录，统一向所有群推送 app 版本。'
              : '连接 ShareGPT 协作服务，管理当前群的用户与配置。'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* 身份切换 */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {(
              [
                { v: 'admin', label: '群管理员' },
                { v: 'dev', label: '开发者发布' },
              ] as const
            ).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => setMode(v)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === v
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="serverUrl">服务地址</Label>
            <Input
              id="serverUrl"
              autoFocus
              placeholder="http://server.example.com:8088"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>

          {isDev ? (
            <div className="grid gap-1.5">
              <Label htmlFor="devKey">开发者密钥</Label>
              <Input
                id="devKey"
                type="password"
                placeholder="请输入开发者密钥"
                value={devKey}
                onChange={(e) => setDevKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void run('dev')
                }}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="adminUser">管理员账号</Label>
                <Input
                  id="adminUser"
                  placeholder="请输入管理员账号"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="adminPass">管理员密码</Label>
                <Input
                  id="adminPass"
                  type="password"
                  placeholder="请输入管理员密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void run('login')
                  }}
                />
              </div>
            </>
          )}

          <div className="mt-1 grid gap-2">
            {isDev ? (
              <Button disabled={busy} onClick={() => void run('dev')}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                登录开发者发布
              </Button>
            ) : (
              <>
                <Button disabled={busy} onClick={() => void run('login')}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  登录管理后台
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void run('setup')}>
                  首次初始化管理员
                </Button>
              </>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {isDev
              ? '版本发布是开发者职责：一次推送，所有群生效。'
              : '服务器还没有管理员时，点击「首次初始化管理员」用当前账号密码创建。'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
