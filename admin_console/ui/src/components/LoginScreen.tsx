import { useEffect, useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminStore } from '@/store/useAdminStore'

export function LoginScreen() {
  const storeServerUrl = useAdminStore((s) => s.serverUrl)
  const storeUsername = useAdminStore((s) => s.username)
  const busy = useAdminStore((s) => s.busy)
  const login = useAdminStore((s) => s.login)
  const setupFirstAdmin = useAdminStore((s) => s.setupFirstAdmin)

  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // store.init 异步载入 prefs 后回填表单 (仅在用户尚未输入时)。
  useEffect(() => {
    setServerUrl((cur) => cur || storeServerUrl)
  }, [storeServerUrl])
  useEffect(() => {
    setUsername((cur) => cur || storeUsername)
  }, [storeUsername])

  async function run(action: 'login' | 'setup') {
    try {
      if (action === 'login') await login(serverUrl, username, password)
      else await setupFirstAdmin(serverUrl, username, password)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-lg">管理员登录</CardTitle>
          <p className="text-sm text-muted-foreground">
            连接 ShareGPT 协作服务，集中管理用户、下发配置与版本发布。
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
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

          <div className="mt-1 grid gap-2">
            <Button disabled={busy} onClick={() => void run('login')}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              登录管理后台
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run('setup')}
            >
              首次初始化管理员
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            服务器还没有管理员时，点击「首次初始化管理员」用当前账号密码创建。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
