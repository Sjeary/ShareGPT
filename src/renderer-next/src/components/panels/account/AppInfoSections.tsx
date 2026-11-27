import { showErrorToast } from '@/lib/errorToast'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { Download, RefreshCw, History, Star, Github } from 'lucide-react'
import { compareVersions, checkGithubUpdate } from './bootstrap'
import { CHANGELOG } from './changelog'

const REPO_URL = 'https://github.com/Sjeary/ShareGPT'

function safeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

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

export function AboutSection() {
  return (
    <Card className="w-full">
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

export function UpdateSection() {
  const meta = useAppStore((s) => s.meta)
  const updateInfo = useAuthStore((s) => s.updateInfo)

  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
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
      showErrorToast(err, '检查更新')
    } finally {
      setDownloading(false)
    }
  }

  async function handleInstall() {
    if (supported) {
      setDownloading(true)
      setProgress({ transferred: 0, total: 0, percent: 0, fileName: '更新包' })
      try {
        const res = (await api.installAppUpdate({
          version: latestVersion,
          fileName: safeText(updateInfo?.fileName),
        })) as { updated?: boolean } | null
        if (res?.updated) {
          toast.success('新版本已下载，正在原地安装并自动重启…')
        } else {
          toast.info('当前已经是最新版本')
        }
      } catch (err) {
        showErrorToast(err, '自动更新')
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
      showErrorToast(err, '下载或安装更新')
    } finally {
      setDownloading(false)
    }
  }

  const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))
  const showProgress = downloading || (progress && (progress.transferred || progress.total))

  return (
    <Card className="w-full">
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

export function ChangelogSection() {
  const meta = useAppStore((s) => s.meta)
  const current = safeText(meta.version)
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? CHANGELOG : CHANGELOG.slice(0, 1)
  const hiddenCount = CHANGELOG.length - 1
  return (
    <Card className="w-full">
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
                    {entry.version === 'Unreleased' ? '开发中的改进' : `v${entry.version}`}
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
