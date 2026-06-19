import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import {
  Download,
  LogOut,
  PanelLeft,
  PanelRight,
  RefreshCw,
  UserCog,
  History,
  Star,
  Github,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { compareVersions, checkGithubUpdate } from './bootstrap'
import { CHANGELOG } from './changelog'
import type { CollabSettings } from '@/types/settings'

// 协作通知开关项 (对应 collab.notify_* 字段)。
const NOTIFY_FIELDS: ReadonlyArray<{
  key: keyof Pick<
    CollabSettings,
    | 'notify_message_popup'
    | 'notify_system_notification'
    | 'notify_sound_play'
    | 'notify_user_online'
  >
  label: string
  desc: string
  // 旧版默认: 前三项默认开 (!== false), user_online 默认关。
  defaultOn: boolean
}> = [
  {
    key: 'notify_message_popup',
    label: '消息弹窗',
    desc: '收到新消息时在应用内提示',
    defaultOn: true,
  },
  {
    key: 'notify_system_notification',
    label: '系统通知',
    desc: '通过操作系统通知中心提醒',
    defaultOn: true,
  },
  { key: 'notify_sound_play', label: '提示音', desc: '收到新消息时播放提示音', defaultOn: true },
  { key: 'notify_user_online', label: '上线提醒', desc: '有成员上线时提醒', defaultOn: false },
]

// 仓库地址 (Star / 源码 / Issue 入口)。fork 后改这里即可。
const REPO_URL = 'https://github.com/Sjeary/ShareGPT'

// 「支持项目」区: 引导去 GitHub Star。无法替用户 star (需其本人 GitHub 授权),
// 只能打开仓库主页由其自行点击 Star; 另给源码 / Issue 入口。
function AboutSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">支持项目</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          ShareGPT 是开源项目。如果它对你有帮助，欢迎到 GitHub 给个 ⭐ Star
          支持一下，也欢迎反馈问题、参与改进。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void api.openExternal(REPO_URL)}>
            <Star />去 GitHub 点个 Star
          </Button>
          <Button size="sm" variant="outline" onClick={() => void api.openExternal(REPO_URL)}>
            <Github />
            源码仓库
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void api.openExternal(`${REPO_URL}/issues`)}
          >
            提 Issue
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2).toUpperCase()
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

// 旧 formatBytes(~205): 字节人性化展示。
function formatBytes(value: unknown): string {
  const size = Math.max(0, Number(value) || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

interface UpdateProgress {
  transferred?: number
  total?: number
  percent?: number
  fileName?: string
}

// 应用内更新区。读 useAuthStore.updateInfo (bootstrap.update) 判定有无更新,
// 接 api.onAppUpdateProgress 显示进度, 安装走 downloadAppUpdate -> openAppUpdate。
// 移植自旧 renderer.js syncUpdateControls(~2811) / installAppUpdate(~2911)。
function UpdateSection() {
  const meta = useAppStore((s) => s.meta)
  const updateInfo = useAuthStore((s) => s.updateInfo)

  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  // 是否支持「原地无感更新」(Windows 打包版 = true)。mac / dev 回退到下载安装包方式。
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const off = api.onAppUpdateProgress((raw) => {
      setProgress(raw && typeof raw === 'object' ? (raw as UpdateProgress) : null)
    })
    return off
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setSupported(Boolean(await api.isUpdateSupported()))
      } catch {
        setSupported(false)
      }
    })()
  }, [])

  // 挂载时自动从 GitHub Releases 查询最新版 (自动更新源, 不经任何自建服务器)。
  useEffect(() => {
    let alive = true
    void (async () => {
      const update = await checkGithubUpdate()
      if (alive && update) useAuthStore.getState().setUpdateInfo(update)
    })()
    return () => {
      alive = false
    }
  }, [])

  const currentVersion = safeText(meta.version) || '-'
  const latestVersion = safeText(updateInfo?.version)
  const notes = safeText(updateInfo?.notes)
  const hasPackage = Boolean(safeText(updateInfo?.url))
  const hasNewVersion = Boolean(
    latestVersion &&
    currentVersion &&
    compareVersions(latestVersion, currentVersion) > 0 &&
    hasPackage,
  )

  const releaseUrl = safeText(updateInfo?.htmlUrl)
  let hint: string
  if (!updateInfo) {
    hint = '点击“检查更新”从 GitHub 读取最新发布。'
  } else if (!hasPackage) {
    hint = 'GitHub 最新发布暂无本平台 (.exe / .dmg) 安装包，可前往发布页查看。'
  } else if (hasNewVersion) {
    hint = supported
      ? `发现新版本 ${latestVersion}，点击「下载并安装」会自动更新并重启，账号 / 聊天记录 / 配置 / 网页登录态都会保留。`
      : `发现新版本 ${latestVersion}，下载后会保留账号、聊天记录、配置和网页登录状态。`
  } else {
    hint = '当前已经是最新版本。'
  }
  const hintTone =
    hasNewVersion || (!!updateInfo && hasPackage && !hasNewVersion) ? 'success' : 'muted'

  // 检查更新: 从 GitHub Releases 查询最新版 (自动更新源, 不经任何自建服务器)。
  async function handleCheck() {
    setDownloading(true)
    try {
      const update = await checkGithubUpdate()
      if (!update) {
        throw new Error('无法连接 GitHub 获取更新信息（请先开启代理，或检查网络）后重试')
      }
      useAuthStore.getState().setUpdateInfo(update)
      toast.success('已从 GitHub 刷新更新信息')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '检查更新失败')
    } finally {
      setDownloading(false)
    }
  }

  // 下载并安装。Windows 打包版走 electron-updater 原地无感更新 (下载完自动安装并重启);
  // mac / dev 回退到「下载安装包 + 打开」。
  async function handleInstall() {
    if (supported) {
      setDownloading(true)
      setProgress({ transferred: 0, total: 0, percent: 0, fileName: '更新包' })
      try {
        const res = (await api.installAppUpdate()) as { updated?: boolean } | null
        if (res?.updated) {
          toast.success('新版本已下载，正在原地安装并自动重启…')
        } else {
          toast.info('当前已经是最新版本')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '自动更新失败')
      } finally {
        setDownloading(false)
      }
      return
    }
    const update = useAuthStore.getState().updateInfo
    if (!update?.url) {
      toast.error('当前发布暂无本平台的安装包。')
      return
    }
    setDownloading(true)
    setProgress({ transferred: 0, total: 0, percent: 0, fileName: update.fileName || '更新包' })
    try {
      const result = (await api.downloadAppUpdate({
        url: update.url,
        fileName: update.fileName,
        version: update.version,
      })) as { filePath?: string } | undefined | null
      const filePath = safeText(result?.filePath)
      const opened = (await api.openAppUpdate({
        filePath,
        quitAfterOpen: true,
      })) as { backupDir?: string } | undefined | null
      const backupDir = safeText(opened?.backupDir)
      toast.success(
        backupDir
          ? `更新包已保存：${filePath}。已完成资料快照：${backupDir}。程序将自动退出以完成更新。`
          : `更新包已保存：${filePath}。安装程序已打开，程序将自动退出。`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载或安装更新失败')
    } finally {
      setDownloading(false)
    }
  }

  const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))
  const showProgress = downloading || (progress && (progress.transferred || progress.total))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">应用更新</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="selectable grid gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">当前版本</span>
            <span className="font-medium">{currentVersion}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">最新版本</span>
            <span className="font-medium">{latestVersion || '未发布'}</span>
          </div>
        </div>

        <p
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            hintTone === 'success'
              ? 'border-success/40 text-success'
              : 'border-border text-muted-foreground',
          )}
        >
          {hint}
        </p>

        {notes && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">更新说明</p>
            <p className="selectable whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        {showProgress && (
          <div className="grid gap-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-right text-xs text-muted-foreground">
              {safeText(progress?.fileName) || '更新包'} · {formatBytes(progress?.transferred)}
              {progress?.total ? ` / ${formatBytes(progress?.total)}` : ''} · {percent}%
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleCheck} disabled={downloading}>
            <RefreshCw />
            检查更新
          </Button>
          <Button size="sm" onClick={handleInstall} disabled={!hasPackage || downloading}>
            <Download />
            {downloading ? '下载中…' : hasNewVersion ? '下载并安装更新' : '重新下载安装包'}
          </Button>
          {releaseUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void api.openExternal(releaseUrl)}
              disabled={downloading}
            >
              前往 GitHub 发布页
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// 更新日志区 (随包内置, 4.2.0 → 现在)。时间线样式, 当前版本高亮。
function ChangelogSection() {
  const meta = useAppStore((s) => s.meta)
  const current = safeText(meta.version)
  // 默认只展开最新一条, 其余收起 (全展开太长); 可点按钮展开历史。
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? CHANGELOG : CHANGELOG.slice(0, 1)
  const hiddenCount = CHANGELOG.length - 1
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" />
          更新日志
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-1 border-l border-border/70">
          {shown.map((entry) => {
            const isCurrent = current && entry.version === current
            return (
              <li key={entry.version} className="ml-4 pb-5 last:pb-0">
                <span
                  className={cn(
                    'absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4 ring-background',
                    isCurrent ? 'bg-primary' : 'bg-muted-foreground/40',
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="selectable text-sm font-semibold text-foreground">
                    v{entry.version}
                  </span>
                  {isCurrent && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      当前版本
                    </span>
                  )}
                  <span className="selectable text-[11px] text-muted-foreground">{entry.date}</span>
                </div>
                <ul className="mt-1.5 grid gap-1">
                  {entry.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="selectable flex gap-1.5 text-xs leading-relaxed text-muted-foreground"
                    >
                      <span className="mt-[3px] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span className="min-w-0">{h}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? '收起' : `展开更早版本（${hiddenCount}）`}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

// 反馈建议: 登录用户提交一条文本反馈, 直连协作服务器 POST /api/feedback (Bearer)。
// 管理端在 Admin 控制台「反馈」面板查看。
function FeedbackSection() {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    const body = text.trim()
    if (!body) {
      toast.error('请先填写反馈内容')
      return
    }
    const serverUrl = safeText(useAppStore.getState().settings?.collab?.server_url)
    const token = useAuthStore.getState().token
    if (!serverUrl || !token) {
      toast.error('请先登录后再提交反馈')
      return
    }
    setSending(true)
    try {
      const resp = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: body.slice(0, 2000),
          version: safeText(useAppStore.getState().meta.version),
          platform: String(api.platform || ''),
        }),
      })
      if (!resp.ok) {
        const t = await resp.text().catch(() => '')
        throw new Error(t || `提交失败（${resp.status}）`)
      }
      toast.success('感谢反馈，已提交！')
      setText('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交反馈失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">反馈建议</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="使用中的问题或建议，写在这里提交给管理员～"
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length}/2000</span>
          <Button size="sm" onClick={submit} disabled={sending || !text.trim()}>
            {sending ? '提交中…' : '提交反馈'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function LoggedInView() {
  const collab = useAppStore((s) => s.settings?.collab)
  const patchSection = useAppStore((s) => s.patchSection)
  const sidebarSide = useAppStore((s) => s.sidebarSide)
  const setSidebarSide = useAppStore((s) => s.setSidebarSide)
  const showGemini = useAppStore((s) => s.showGemini)
  const setShowGemini = useAppStore((s) => s.setShowGemini)
  const showClaude = useAppStore((s) => s.showClaude)
  const setShowClaude = useAppStore((s) => s.setShowClaude)
  const profile = useAuthStore((s) => s.profile)
  const { logout } = useAuth()

  const [loggingOut, setLoggingOut] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const displayName = profile?.displayName || collab?.last_username || '未知账号'
  const username = profile?.username || collab?.last_username || ''
  const avatar = profile?.avatar || collab?.last_avatar || ''

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      toast.success('已退出登录')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '退出失败')
    } finally {
      setLoggingOut(false)
    }
  }

  // 打开个人资料编辑器 (独立窗口, 主进程托管)。
  // 移植自旧 renderer.js openProfileEditor(~5253): 透传 serverUrl/token/username。
  async function handleEditProfile() {
    const serverUrl = collab?.server_url ?? ''
    const token = useAuthStore.getState().token
    const user = username || useChatStore.getState().identity.username
    if (!token) {
      toast.error('请先登录账号，再打开个人资料。')
      return
    }
    try {
      await api.openProfileEditor({ serverUrl, token, username: user })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开个人资料失败')
    }
  }

  async function toggleNotify(key: string, defaultOn: boolean, next: boolean) {
    setSavingKey(key)
    try {
      await patchSection('collab', { [key]: next } as Partial<CollabSettings>)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存设置失败')
    } finally {
      setSavingKey(null)
    }
    void defaultOn
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      {/* 更新区 + 更新日志放最上面; 账户与其它设置放日志下面 (按需求重排)。 */}
      <UpdateSection />
      <ChangelogSection />
      <AboutSection />

      {/* 账户: 改为与其它设置一致的卡片样式, 便于查找。 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">账户</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-4">
            <Avatar size="lg">
              {avatar && <AvatarImage src={avatar} alt={displayName} />}
              <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="selectable truncate text-base font-semibold">{displayName}</p>
              {username && username !== displayName && (
                <p className="selectable truncate text-xs text-muted-foreground">{username}</p>
              )}
              <p className="truncate text-xs text-success">已连接协作服务</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleEditProfile}>
              <UserCog />
              编辑个人资料
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
              <LogOut />
              {loggingOut ? '退出中…' : '退出登录'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">界面设置</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          {/* flex-wrap: 窄窗或高 DPI 缩放下分段控件自动换到下一行, 不溢出卡片。 */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-1.5">
            <div className="min-w-0 flex-1">
              <Label className="cursor-default">侧栏位置</Label>
              <p className="truncate text-xs text-muted-foreground">导航栏显示在窗口左侧或右侧。</p>
            </div>
            {/* 左/右分段选择: 即时生效并持久化 (settings.ui.sidebarSide)。 */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-1">
              {(
                [
                  { side: 'left', label: '左侧', icon: PanelLeft },
                  { side: 'right', label: '右侧', icon: PanelRight },
                ] as const
              ).map(({ side, label, icon: Icon }) => {
                const on = sidebarSide === side
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setSidebarSide(side)}
                    aria-pressed={on}
                    className={cn(
                      'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <Separator className="my-1" />

          {/* 是否展示 Gemini: 关闭后导航栏不再显示 Gemini 入口 (settings.ui.showGemini)。 */}
          <div className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <Label htmlFor="ui-show-gemini" className="cursor-pointer">
                显示 Gemini
              </Label>
              <p className="text-xs text-muted-foreground">
                默认隐藏。Gemini 需要 Google 登录，而内嵌客户端无法完成 Google
                登录——我们尝试集成过，但实际用不了。如仍需要可在此开启。
              </p>
            </div>
            <Switch id="ui-show-gemini" checked={showGemini} onCheckedChange={setShowGemini} />
          </div>

          <Separator className="my-1" />

          {/* 是否展示 Claude: 关闭后导航栏不再显示 Claude 入口 (settings.ui.showClaude)。 */}
          <div className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <Label htmlFor="ui-show-claude" className="cursor-pointer">
                显示 Claude
              </Label>
              <p className="truncate text-xs text-muted-foreground">
                控制主页导航栏是否显示 Claude 切换按钮。
              </p>
            </div>
            <Switch id="ui-show-claude" checked={showClaude} onCheckedChange={setShowClaude} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">协作通知</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          {NOTIFY_FIELDS.map((item, idx) => {
            const raw = collab?.[item.key]
            const checked = item.defaultOn ? raw !== false : raw === true
            return (
              <div key={item.key}>
                {idx > 0 && <Separator className="my-1" />}
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <Label htmlFor={`notify-${item.key}`} className="cursor-pointer">
                      {item.label}
                    </Label>
                    <p className="truncate text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch
                    id={`notify-${item.key}`}
                    checked={checked}
                    disabled={savingKey === item.key}
                    onCheckedChange={(next) => toggleNotify(item.key, item.defaultOn, next)}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <FeedbackSection />
    </div>
  )
}
