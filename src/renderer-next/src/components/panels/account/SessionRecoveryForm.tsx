import { useState, type FormEvent } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// The global recovery action reveals this form. Credentials are submitted to the existing
// session owner; entering another account or changing the server still uses normal login.
export function SessionRecoveryForm() {
  const open = useChatStore((s) => s.recoveryFormOpen)
  const identity = useChatStore((s) => s.identity)
  if (!open) return null
  return <RecoveryCredentials key={`${identity.serverUrl}\n${identity.username}`} />
}

function RecoveryCredentials() {
  const identity = useChatStore((s) => s.identity)
  const retryLogin = useChatStore((s) => s.retryLogin)
  const busy = useChatStore((s) => s.connection === 'connecting')
  const error = useChatStore((s) => s.recoveryError)
  const [password, setPassword] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !password || !retryLogin) return
    if (await retryLogin(password)) setPassword('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">恢复团队连接</CardTitle>
        <CardDescription>
          为账号 {identity.username} 输入当前密码，继续使用此工作区。
        </CardDescription>
        <p className="break-all text-xs text-muted-foreground">{identity.serverUrl}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit}>
          <Label htmlFor="session-recovery-password">当前密码</Label>
          <Input
            id="session-recovery-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
            required
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password || !retryLogin}>
              {busy ? '正在连接…' : '恢复连接'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => useChatStore.setState({ recoveryFormOpen: false })}
            >
              稍后再试
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
