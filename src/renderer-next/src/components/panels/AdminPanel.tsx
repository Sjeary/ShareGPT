import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  BarChart3,
  Braces,
  Cable,
  KeyRound,
  Languages,
  LayoutDashboard,
  Link2,
  Loader2,
  MessageSquareText,
  Network,
  Rocket,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { normalizeServerUrl } from '@/lib/adminApi'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import { AuthExpiredError, type AdminTab } from '@/types/admin'
import { AdminOverviewTab } from './admin/AdminOverviewTab'
import { AdminInvitesTab, AdminUsersTab } from './admin/AdminUsersInvitesTabs'
import { AdminAiUsageTab, AdminRoutingTab, AdminTranslationTab } from './admin/AdminAiRoutingTabs'
import {
  AdminBootstrapTab,
  AdminExtrasTab,
  AdminFeedbackTab,
  AdminProxyMissingTab,
  AdminReleasesTab,
} from './admin/AdminSystemTabs'

const ADMIN_NAV: ReadonlyArray<{
  key: AdminTab
  label: string
  group: '团队运营' | '网络与服务' | '维护与反馈'
  icon: LucideIcon
}> = [
  { key: 'overview', label: '概览', group: '团队运营', icon: LayoutDashboard },
  { key: 'users', label: '成员与权限', group: '团队运营', icon: Users },
  { key: 'invites', label: '邀请链接', group: '团队运营', icon: Link2 },
  { key: 'ai-usage', label: 'AI 使用统计', group: '团队运营', icon: BarChart3 },
  { key: 'airport', label: 'AI 线路策略', group: '网络与服务', icon: Network },
  { key: 'translation', label: '翻译服务', group: '网络与服务', icon: Languages },
  { key: 'bootstrap', label: '团队统一代理', group: '网络与服务', icon: Cable },
  { key: 'feedback', label: '反馈建议', group: '维护与反馈', icon: MessageSquareText },
  { key: 'proxy-missing', label: '漏走代理域名', group: '维护与反馈', icon: ShieldAlert },
  { key: 'releases', label: '版本信息', group: '维护与反馈', icon: Rocket },
  { key: 'extras', label: '高级配置', group: '维护与反馈', icon: Braces },
]

// 兼容尚未升级的旧版协作服务端：旧版 /api/admin/* 只认 /api/admin/login 颁发的管理员 token。
async function exchangeLegacyAdminToken(
  serverUrl: string,
  username: string,
  password: string,
  externalSignal?: AbortSignal,
): Promise<string> {
  const base = normalizeServerUrl(serverUrl)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10000)
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)
  try {
    const resp = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      body: JSON.stringify({ username, password }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(text || `管理员验证失败（${resp.status}）`)
    }
    const payload = (await resp.json().catch(() => null)) as { token?: unknown } | null
    const adminToken = typeof payload?.token === 'string' ? payload.token.trim() : ''
    if (!adminToken) throw new Error('服务端未返回有效的管理员令牌')
    return adminToken
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export default function AdminPanel() {
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const serverUrl = useAppStore((s) => String(s.settings?.collab?.server_url || '').trim())
  const token = useAuthStore((s) => s.token)
  const profile = useAuthStore((s) => s.profile)
  const isAdmin = workspaceMode === 'organization' && Boolean(token) && profile?.isAdmin === true

  // 非管理员彻底不渲染此界面。
  if (!isAdmin) return null

  const username = profile?.username || ''
  const sessionIdentityKey = `${serverUrl}\0${username}\0${token}`
  return <AdminPanelContent key={sessionIdentityKey} serverUrl={serverUrl} username={username} />
}

function AdminPanelContent({ serverUrl, username }: { serverUrl: string; username: string }) {
  const session = useIntegratedAdminStore((s) => s.session)
  const activeTab = useIntegratedAdminStore((s) => s.activeTab)
  const setActiveTab = useIntegratedAdminStore((s) => s.setActiveTab)
  const loadTab = useIntegratedAdminStore((s) => s.loadTab)
  const bindSession = useIntegratedAdminStore((s) => s.bindSession)
  const loading = useIntegratedAdminStore((s) => s.loading)
  const anyLoading = Object.values(loading).some(Boolean)

  const [verifying, setVerifying] = useState(false)
  const [autoExchange, setAutoExchange] = useState<'pending' | 'done'>(() =>
    !session && serverUrl && username && useAuthStore.getState().runtimePassword
      ? 'pending'
      : 'done',
  )
  const [manualPassword, setManualPassword] = useState('')
  const [verifyError, setVerifyError] = useState('')
  const legacyAttemptedRef = useRef(false)
  const exchangeControllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      exchangeControllerRef.current?.abort()
      exchangeControllerRef.current = null
    }
  }, [])

  const isSameAdminSession = useCallback(() => {
    const latestAuth = useAuthStore.getState()
    const latestApp = useAppStore.getState()
    return (
      latestApp.workspaceMode === 'organization' &&
      latestAuth.profile?.isAdmin === true &&
      latestAuth.profile.username === username
    )
  }, [username])

  const tryLegacyExchange = useCallback(
    async (password: string, manual: boolean) => {
      if (!serverUrl || !username || !password) return false
      exchangeControllerRef.current?.abort()
      const controller = new AbortController()
      exchangeControllerRef.current = controller
      setVerifying(true)
      setVerifyError('')
      try {
        const adminToken = await exchangeLegacyAdminToken(
          serverUrl,
          username,
          password,
          controller.signal,
        )
        if (!mountedRef.current || controller.signal.aborted) return false
        // 核对当前仍为同一管理员会话再绑定，防止切号串写。
        if (!isSameAdminSession()) return false
        bindSession({ serverUrl, token: adminToken, username, isAdmin: true })
        setManualPassword('')
        return true
      } catch (err) {
        if (!mountedRef.current || controller.signal.aborted) return false
        const msg = err instanceof Error ? err.message : '管理员验证失败'
        if (manual) setVerifyError(msg)
        return false
      } finally {
        if (exchangeControllerRef.current === controller) exchangeControllerRef.current = null
        if (mountedRef.current) setVerifying(false)
      }
    },
    [bindSession, isSameAdminSession, serverUrl, username],
  )

  useEffect(() => {
    if (!session) {
      if (autoExchange !== 'pending' || legacyAttemptedRef.current) return
      const runtimePwd = useAuthStore.getState().runtimePassword
      if (!runtimePwd || !serverUrl || !username) return
      legacyAttemptedRef.current = true
      const controller = new AbortController()
      exchangeControllerRef.current?.abort()
      exchangeControllerRef.current = controller
      void exchangeLegacyAdminToken(serverUrl, username, runtimePwd, controller.signal)
        .then((adminToken) => {
          if (!mountedRef.current || controller.signal.aborted) return
          if (!isSameAdminSession()) return
          bindSession({ serverUrl, token: adminToken, username, isAdmin: true })
          setManualPassword('')
        })
        .catch(() => undefined)
        .finally(() => {
          if (exchangeControllerRef.current === controller) exchangeControllerRef.current = null
          if (mountedRef.current && !controller.signal.aborted) setAutoExchange('done')
        })
      return () => {
        controller.abort()
        legacyAttemptedRef.current = false
      }
    }

    void loadTab(activeTab).catch((err) => {
      if (!mountedRef.current) return
      if (err instanceof AuthExpiredError) {
        if (!legacyAttemptedRef.current) {
          legacyAttemptedRef.current = true
          const runtimePwd = useAuthStore.getState().runtimePassword
          if (runtimePwd) {
            void tryLegacyExchange(runtimePwd, false)
            return
          }
        }
        return
      }
      const msg = err instanceof Error ? err.message : '加载管理数据失败'
      if (msg) toast.error(msg)
    })
  }, [
    activeTab,
    autoExchange,
    bindSession,
    isSameAdminSession,
    loadTab,
    serverUrl,
    session,
    tryLegacyExchange,
    username,
  ])

  const showVerifying = verifying || (!session && autoExchange === 'pending')

  async function handleManualVerify(e: FormEvent) {
    e.preventDefault()
    if (!manualPassword || verifying) return
    await tryLegacyExchange(manualPassword, true)
  }

  return (
    <PanelScaffold
      icon={ShieldCheck}
      title="管理后台"
      hint="团队成员、邀请、线路与系统配置"
      toolbar={
        <Button
          variant="outline"
          size="sm"
          disabled={!session || anyLoading}
          onClick={() =>
            void loadTab(activeTab).catch((err) =>
              toast.error(err instanceof Error ? err.message : '刷新失败'),
            )
          }
        >
          <RotateCw className={cn('size-3.5', anyLoading && 'animate-spin')} />
          刷新当前页
        </Button>
      }
    >
      {!session ? (
        <div className="grid h-full place-items-center p-6">
          {showVerifying ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              正在连接管理服务…
            </div>
          ) : (
            <Card className="w-full max-w-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="size-4 text-primary" />
                  验证管理员密码
                </CardTitle>
                <CardDescription>
                  当前服务器版本需要独立管理员会话，请确认 @{username} 的密码以继续。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-3" onSubmit={(e) => void handleManualVerify(e)}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="admin-verify-pwd">管理员密码</Label>
                    <Input
                      id="admin-verify-pwd"
                      type="password"
                      autoComplete="current-password"
                      value={manualPassword}
                      onChange={(e) => setManualPassword(e.target.value)}
                      placeholder="输入当前账号密码"
                    />
                  </div>
                  {verifyError && <p className="text-xs text-destructive">{verifyError}</p>}
                  <Button type="submit" disabled={!manualPassword || verifying}>
                    确认进入
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
          <nav
            aria-label="管理后台导航"
            className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col"
          >
            {ADMIN_NAV.map((item, idx) => {
              const Icon = item.icon
              const prevGroup = idx > 0 ? ADMIN_NAV[idx - 1]?.group : null
              const active = activeTab === item.key
              return (
                <div key={item.key} className="contents lg:block">
                  {item.group !== prevGroup && (
                    <div
                      className={cn(
                        'hidden px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/80 lg:block',
                        idx > 0 ? 'pt-3' : 'pt-0.5',
                      )}
                    >
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab(item.key)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors lg:w-full lg:text-sm',
                      active
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'bg-card/60 text-foreground hover:bg-muted lg:bg-transparent',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                </div>
              )
            })}
          </nav>

          <div className="min-w-0">
            {activeTab === 'overview' && <AdminOverviewTab onJump={setActiveTab} />}
            {activeTab === 'users' && <AdminUsersTab />}
            {activeTab === 'invites' && <AdminInvitesTab />}
            {activeTab === 'ai-usage' && <AdminAiUsageTab />}
            {activeTab === 'airport' && <AdminRoutingTab />}
            {activeTab === 'translation' && <AdminTranslationTab />}
            {activeTab === 'bootstrap' && <AdminBootstrapTab />}
            {activeTab === 'releases' && <AdminReleasesTab />}
            {activeTab === 'feedback' && <AdminFeedbackTab />}
            {activeTab === 'proxy-missing' && <AdminProxyMissingTab />}
            {activeTab === 'extras' && <AdminExtrasTab />}
          </div>
        </div>
      )}
    </PanelScaffold>
  )
}
