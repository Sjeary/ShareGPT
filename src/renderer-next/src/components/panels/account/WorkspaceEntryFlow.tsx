import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  Download,
  HardDrive,
  Laptop,
  Link2,
  Loader2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { autoLoginParams } from '@/lib/autoLogin'
import { isStaleAttemptError } from '@/lib/latestAttempt'
import { describeUserError } from '@/lib/userFacingError'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { TeamAuthCard, useTeamLoginFormState, type OrgAuthTab } from './TeamAuthCard'
import { checkGithubUpdate, compareVersions, type BootstrapUpdate } from './bootstrap'

type WorkspaceEntryView = 'welcome' | 'choice' | 'organization' | 'personal'
type StepDirection = 'forward' | 'back'

function EntryUpdateBanner() {
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
    <div className="motion-tab-panel w-full max-w-[440px] rounded-xl border border-primary/35 bg-primary/10 px-4 py-3 shadow-xs">
      <div className="flex items-start gap-2.5">
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
      <div className="mt-2.5 flex items-center gap-2">
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

function StepBreadcrumb({ view }: { view: Exclude<WorkspaceEntryView, 'welcome'> }) {
  const stepTwoLabel = view === 'personal' ? '本机配置' : '团队认证'
  const onSecondStep = view !== 'choice'
  return (
    <div
      aria-label="入口步骤"
      className="mb-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium transition-colors',
          !onSecondStep ? 'bg-primary/12 text-primary' : 'text-muted-foreground',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            !onSecondStep ? 'bg-primary' : 'bg-muted-foreground/50',
          )}
        />
        选择方式
      </span>
      <span className="h-px w-5 bg-border" />
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium transition-colors',
          onSecondStep ? 'bg-primary/12 text-primary' : 'text-muted-foreground/70',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            onSecondStep ? 'bg-primary' : 'bg-muted-foreground/35',
          )}
        />
        {stepTwoLabel}
      </span>
    </div>
  )
}

export function WorkspaceEntryFlow() {
  const meta = useAppStore((s) => s.meta)
  const patchSection = useAppStore((s) => s.patchSection)
  const { login, enterPersonal } = useAuth()
  const form = useTeamLoginFormState()

  const brandName = String((meta?.productName as string) || 'ShareGPT').replace(
    /\s+(Sender|Receiver)$/i,
    '',
  )

  const [entryView, setEntryView] = useState<WorkspaceEntryView>(() =>
    form.hasSeenWorkspaceIntro ? 'choice' : 'welcome',
  )
  const [direction, setDirection] = useState<StepDirection>('forward')
  const [orgAuthTab, setOrgAuthTab] = useState<OrgAuthTab>('login')
  const [enteringPersonal, setEnteringPersonal] = useState(false)
  const [autoEnterPersonal, setAutoEnterPersonal] = useState(() =>
    Boolean(useAppStore.getState().settings?.ui?.auto_enter_personal),
  )

  const autoLoginAttempted = useRef(false)
  const { collab, loginUiBusyRef, setSubmitting, setError, setErrorField, setErrorShakeKey } = form

  function navigateTo(nextView: WorkspaceEntryView, dir: StepDirection) {
    setDirection(dir)
    setEntryView(nextView)
  }

  useEffect(() => {
    const params = autoLoginParams(collab)
    if (params) {
      if (autoLoginAttempted.current || loginUiBusyRef.current) return
      autoLoginAttempted.current = true
      loginUiBusyRef.current = true
      setDirection('forward')
      setEntryView('organization')
      setSubmitting(true)
      setError('')
      setErrorField(null)
      void login(params)
        .catch((err) => {
          if (isStaleAttemptError(err)) return
          setError(err)
          setErrorShakeKey((k) => k + 1)
          const category = describeUserError(err).category
          setErrorField(
            category === 'connection' ? 'server' : category === 'credentials' ? 'password' : null,
          )
        })
        .finally(() => {
          loginUiBusyRef.current = false
          setSubmitting(false)
        })
      return
    }
    const shouldAutoPersonal = Boolean(useAppStore.getState().settings?.ui?.auto_enter_personal)
    if (!shouldAutoPersonal || autoLoginAttempted.current || loginUiBusyRef.current) return
    autoLoginAttempted.current = true
    setEnteringPersonal(true)
    void enterPersonal()
      .catch((err) => {
        setError(err)
      })
      .finally(() => {
        setEnteringPersonal(false)
      })
  }, [
    collab,
    enterPersonal,
    login,
    loginUiBusyRef,
    setError,
    setErrorField,
    setErrorShakeKey,
    setSubmitting,
  ])

  async function handleEnterPersonal() {
    if (enteringPersonal) return
    setEnteringPersonal(true)
    form.setError('')
    form.setErrorField(null)
    try {
      const uiPatch: Record<string, boolean> = {}
      if (!form.hasSeenWorkspaceIntro) uiPatch.workspace_entry_intro_done = true
      uiPatch.auto_enter_personal = autoEnterPersonal
      await patchSection('ui', uiPatch).catch(() => undefined)
      await enterPersonal()
    } catch (err) {
      form.setError(err)
    } finally {
      setEnteringPersonal(false)
    }
  }

  const stageMotionClass = direction === 'back' ? 'motion-stage-back' : 'motion-stage-forward'

  if (entryView === 'welcome') {
    return (
      <div className="motion-ambient-stage h-full overflow-y-auto">
        <div className="grid min-h-full place-items-center p-6">
          <main
            key="welcome"
            className="workspace-entry-step mx-auto flex w-full max-w-lg flex-col items-center text-center"
            aria-labelledby="workspace-welcome-title"
          >
            <div className="workspace-entry-mark grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md ring-4 ring-primary/15">
              <Cable className="size-8" />
            </div>
            <span className="mt-6 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
              首次设置
            </span>
            <h1 id="workspace-welcome-title" className="mt-3 text-3xl font-semibold tracking-tight">
              欢迎来到 {brandName}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              你可以连接团队一起协作，也可以只在这台电脑上独立使用。接下来选择本次启动要进入的工作区。
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3 py-1 shadow-2xs">
                <Sparkles className="size-3.5 text-primary" />
                独立 AI 工作区
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3 py-1 shadow-2xs">
                <Users className="size-3.5 text-primary" />
                团队实时协作
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3 py-1 shadow-2xs">
                <ShieldCheck className="size-3.5 text-primary" />
                资料分区隔离
              </span>
            </div>

            <Button
              size="lg"
              className="mt-8 min-w-44 shadow-sm"
              onClick={() => navigateTo('choice', 'forward')}
            >
              开始设置
              <ArrowRight />
            </Button>
            <p className="mt-4 text-xs text-muted-foreground">稍后仍可切换，选择不会删除已有数据</p>
          </main>
        </div>
      </div>
    )
  }

  if (entryView === 'choice') {
    return (
      <div className="motion-ambient-stage h-full overflow-y-auto">
        <div className="grid min-h-full place-items-center px-6 py-5">
          <main
            key="choice"
            className={cn(stageMotionClass, 'mx-auto w-full max-w-2xl')}
            aria-labelledby="workspace-choice-title"
          >
            <StepBreadcrumb view="choice" />

            <div className="text-center">
              <h1 id="workspace-choice-title" className="text-2xl font-semibold tracking-tight">
                这次要进入哪个工作区？
              </h1>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                两种方式可以随时切换，配置、账号和 AI 网页会话分别持久保存。
              </p>
            </div>

            <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
              <button
                type="button"
                className="motion-card-interactive group flex h-full w-full flex-col rounded-xl border border-border/90 bg-card p-5 text-left shadow-sm hover:border-primary/55 hover:bg-card hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => {
                  setOrgAuthTab('login')
                  navigateTo('organization', 'forward')
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
                    <Users className="size-5" />
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
                    进入
                    <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none" />
                  </span>
                </div>
                <span className="mt-4 text-base font-semibold text-foreground">连接团队</span>
                <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                  登录团队服务器，使用协作聊天、在线成员、管理员分配的线路与组织用量服务。
                </span>
              </button>

              <button
                type="button"
                className="motion-card-interactive group flex h-full w-full flex-col rounded-xl border border-border/90 bg-card p-5 text-left shadow-sm hover:border-primary/55 hover:bg-card hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => navigateTo('personal', 'forward')}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground ring-1 ring-border">
                    <Laptop className="size-5" />
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
                    进入
                    <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none" />
                  </span>
                </div>
                <span className="mt-4 text-base font-semibold text-foreground">仅在本机使用</span>
                <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                  无需团队账号。自行配置个人代理和翻译服务，不显示聊天、成员和团队管理功能。
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setOrgAuthTab('invite')
                navigateTo('organization', 'forward')
              }}
              className="motion-card-interactive group mt-3.5 flex w-full items-center gap-3.5 rounded-xl border border-border/80 bg-card/80 px-4 py-3 text-left shadow-xs hover:border-primary/45 hover:bg-card hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Link2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  有管理员发的邀请链接？直接注册加入团队
                </span>
                <span className="block text-xs text-muted-foreground">
                  粘贴邀请链接即可校验服务器并自助创建普通成员账号
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transform-none" />
            </button>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0 text-primary" />
              个人与团队数据互相隔离；切换不会迁移、覆盖或清除另一侧内容。
            </p>
          </main>
        </div>
      </div>
    )
  }

  if (entryView === 'personal') {
    return (
      <div className="motion-ambient-stage h-full overflow-y-auto">
        <div className="grid min-h-full place-items-center p-6">
          <main
            key="personal"
            className={cn(stageMotionClass, 'mx-auto w-full max-w-lg')}
            aria-labelledby="personal-entry-title"
          >
            <StepBreadcrumb view="personal" />

            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground hover:text-foreground"
              onClick={() => navigateTo('choice', 'back')}
            >
              <ArrowLeft />
              返回选择使用方式
            </Button>

            <div className="mt-4 flex items-start gap-3.5">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
                <Laptop className="size-6" />
              </div>
              <div className="min-w-0">
                <h1 id="personal-entry-title" className="text-2xl font-semibold tracking-tight">
                  在本机独立使用
                </h1>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  适合不需要团队协作、希望自行管理代理和翻译服务的使用场景。
                </p>
              </div>
            </div>

            <div className="mt-5 divide-y divide-border/80 rounded-xl border border-border/90 bg-card px-4 shadow-sm">
              <div className="flex gap-3 py-3.5">
                <Settings2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">配置由你管理</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    个人代理、翻译接口和相关偏好只归当前本机工作区使用。
                  </p>
                </div>
              </div>
              <div className="flex gap-3 py-3.5">
                <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">网页会话独立保存</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    ChatGPT、Claude 和 Gemini
                    使用个人专属分区，不读取任何团队账号的登录状态或历史会话。
                  </p>
                </div>
              </div>
              <div className="flex gap-3 py-3.5">
                <Users className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">以后仍可连接团队</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    进入后打开侧栏底部的“账户”，选择“登录组织工作区”即可切换；两侧数据都会继续保留。
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between rounded-xl border border-border/90 bg-card px-4 py-3 shadow-xs">
              <div className="min-w-0 pr-3">
                <Label htmlFor="auto-enter-personal" className="cursor-pointer text-sm font-medium">
                  下次启动直接进入个人工作区
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  开启后重启直接进入，稍后可在「账户与设置」中关闭或切换团队。
                </p>
              </div>
              <Switch
                id="auto-enter-personal"
                checked={autoEnterPersonal}
                onCheckedChange={setAutoEnterPersonal}
                disabled={enteringPersonal}
              />
            </div>

            <Button
              size="lg"
              className="mt-4 w-full shadow-sm"
              onClick={() => void handleEnterPersonal()}
              disabled={enteringPersonal}
            >
              {enteringPersonal ? <Loader2 className="animate-spin" /> : <Laptop />}
              {enteringPersonal ? '正在准备个人工作区…' : '进入个人工作区'}
            </Button>
            {Boolean(form.error) && (
              <ErrorNotice error={form.error} context="登录与工作区" className="mt-3" />
            )}
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="motion-ambient-stage h-full overflow-y-auto">
      <div className="grid min-h-full place-items-center p-6">
        <div
          key="organization"
          className={cn(
            stageMotionClass,
            'mx-auto flex w-full max-w-[440px] flex-col items-center gap-3',
          )}
        >
          <StepBreadcrumb view="organization" />
          <EntryUpdateBanner />

          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 self-start text-muted-foreground hover:text-foreground"
            onClick={() => navigateTo('choice', 'back')}
          >
            <ArrowLeft />
            返回选择使用方式
          </Button>

          <TeamAuthCard
            mode="entry"
            activeTab={orgAuthTab}
            onTabChange={setOrgAuthTab}
            serverUrl={form.serverUrl}
            username={form.username}
            password={form.password}
            rememberPassword={form.rememberPassword}
            submitting={form.submitting}
            disabled={enteringPersonal}
            error={form.error}
            errorField={form.errorField}
            errorShakeKey={form.errorShakeKey}
            onServerUrlChange={form.setServerUrl}
            onUsernameChange={form.setUsername}
            onPasswordChange={form.setPassword}
            onRememberPasswordChange={form.setRememberPassword}
            onSubmit={(e) => void form.submitLogin(e, enteringPersonal)}
            onRegisteredNeedManualLogin={({ serverUrl: nextUrl, username: nextUser }) => {
              form.setServerUrl(nextUrl)
              form.setUsername(nextUser)
              form.setPassword('')
              setOrgAuthTab('login')
            }}
            serverRef={form.serverRef}
            usernameRef={form.usernameRef}
            passwordRef={form.passwordRef}
          />
        </div>
      </div>
    </div>
  )
}
