import { useState, type FormEvent } from 'react'
import { Building2, ChevronDown, FolderInput, Loader2, LogIn } from 'lucide-react'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { ImportActions } from './ImportActions'
import { InviteRegisterForm } from './InviteRegisterForm'
import type { TeamLoginErrorField } from './useTeamLoginFormState'

export type OrgAuthTab = 'login' | 'invite'

interface TeamAuthCardProps {
  mode: 'entry' | 'personal'
  activeTab: OrgAuthTab
  onTabChange: (tab: OrgAuthTab) => void
  serverUrl: string
  username: string
  password: string
  rememberPassword: boolean
  submitting: boolean
  disabled?: boolean
  error: unknown
  errorField: TeamLoginErrorField | null
  errorShakeKey: number
  onServerUrlChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onRememberPasswordChange: (value: boolean) => void
  onSubmit: (e: FormEvent) => void
  onRegisteredNeedManualLogin: (info: { serverUrl: string; username: string }) => void
  serverRef?: React.RefObject<HTMLInputElement | null>
  usernameRef?: React.RefObject<HTMLInputElement | null>
  passwordRef?: React.RefObject<HTMLInputElement | null>
}

// 统一的团队认证卡片（账号登录 + 邀请链接注册），由入口舞台与个人工作区共用，保证视觉和交互完全一致。
export function TeamAuthCard({
  mode,
  activeTab,
  onTabChange,
  serverUrl,
  username,
  password,
  rememberPassword,
  submitting,
  disabled = false,
  error,
  errorField,
  errorShakeKey,
  onServerUrlChange,
  onUsernameChange,
  onPasswordChange,
  onRememberPasswordChange,
  onSubmit,
  onRegisteredNeedManualLogin,
  serverRef,
  usernameRef,
  passwordRef,
}: TeamAuthCardProps) {
  const [restoreOpen, setRestoreOpen] = useState(false)
  const formDisabled = submitting || disabled

  return (
    <Card className="w-full overflow-hidden border-border/90 shadow-md">
      <CardHeader className="gap-3 pb-4 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
          <Building2 className="size-5" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl tracking-tight">
            {mode === 'entry' ? '连接团队' : '登录组织工作区'}
          </CardTitle>
          <CardDescription className="text-xs leading-5">
            {activeTab === 'invite'
              ? '粘贴管理员分享的邀请链接，自主创建账号并加入团队'
              : mode === 'entry'
                ? '使用团队提供的服务地址和账号登录'
                : '登录后切换到该账号的独立配置和网页会话'}
          </CardDescription>
        </div>

        <div
          role="tablist"
          aria-label="团队连接方式"
          className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-muted/50 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'login'}
            onClick={() => onTabChange('login')}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
              activeTab === 'login'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            账号登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'invite'}
            onClick={() => onTabChange('invite')}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
              activeTab === 'invite'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            邀请链接注册
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div key={activeTab} className="motion-tab-panel">
          {activeTab === 'invite' ? (
            <InviteRegisterForm onRegisteredNeedManualLogin={onRegisteredNeedManualLogin} />
          ) : (
            <form className="grid gap-3.5" onSubmit={onSubmit}>
              <div className="grid gap-1.5">
                <Label htmlFor="account-server">服务地址</Label>
                <Input
                  ref={serverRef}
                  id="account-server"
                  placeholder="http://example.com:8088"
                  autoComplete="off"
                  spellCheck={false}
                  value={serverUrl}
                  onChange={(e) => onServerUrlChange(e.target.value)}
                  disabled={formDisabled}
                  aria-invalid={errorField === 'server' || undefined}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="account-username">账号</Label>
                <Input
                  ref={usernameRef}
                  id="account-username"
                  placeholder="用户名"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => onUsernameChange(e.target.value)}
                  disabled={formDisabled}
                  aria-invalid={errorField === 'username' || undefined}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="account-password">密码</Label>
                <Input
                  ref={passwordRef}
                  id="account-password"
                  type="password"
                  placeholder="密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  disabled={formDisabled}
                  aria-invalid={errorField === 'password' || undefined}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-2">
                <Label htmlFor="account-remember" className="cursor-pointer text-sm font-normal">
                  记住密码
                </Label>
                <Switch
                  id="account-remember"
                  checked={rememberPassword}
                  onCheckedChange={onRememberPasswordChange}
                  disabled={formDisabled}
                />
              </div>

              {Boolean(error) && (
                <div key={errorShakeKey} className="motion-shake">
                  <ErrorNotice error={error} context="登录与工作区" />
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={formDisabled}>
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
          )}
        </div>

        {mode === 'entry' && (
          <>
            <Separator className="my-4" />
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setRestoreOpen((v) => !v)}
                aria-expanded={restoreOpen}
                className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FolderInput className="size-3.5" />
                  从备份文件恢复本机配置或资料包
                </span>
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-200',
                    restoreOpen && 'rotate-180',
                  )}
                />
              </button>
              {restoreOpen && (
                <div className="motion-tab-panel pt-1">
                  <ImportActions />
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
