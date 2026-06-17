import { useEffect, useState } from 'react'
import {
  Rocket,
  Save,
  Loader2,
  UploadCloud,
  FileUp,
  Copy,
  MonitorDown,
  Apple,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi, normalizeServerUrl } from '@/lib/api'
import { useAdminStore } from '@/store/useAdminStore'
import type { Bootstrap } from '@/types/admin'
import type { ReleaseFilePick, ReleaseUploadProgress } from '@/types/adminApi'
import { PanelScaffold } from './PanelScaffold'

type PlatformKey = 'windows' | 'macos'

function formatBytes(size: number): string {
  const v = Math.max(0, Number(size) || 0)
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
}

export function ReleasesPanel() {
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const serverUrl = useAdminStore((s) => s.serverUrl)
  const token = useAdminStore((s) => s.token)
  const saveBootstrap = useAdminStore((s) => s.saveBootstrap)
  const loadBootstrap = useAdminStore((s) => s.loadBootstrap)

  const update = bootstrap?.update || {}

  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)

  const [drafts, setDrafts] = useState<Record<PlatformKey, ReleaseFilePick | null>>({
    windows: null,
    macos: null,
  })
  const [progress, setProgress] = useState<Record<PlatformKey, ReleaseUploadProgress | null>>({
    windows: null,
    macos: null,
  })
  const [uploading, setUploading] = useState<Record<PlatformKey, boolean>>({
    windows: false,
    macos: false,
  })

  useEffect(() => {
    setVersion(String(update.version || ''))
    setNotes(String(update.notes || ''))
  }, [update.version, update.notes])

  useEffect(() => {
    const off = adminApi.onReleaseUploadProgress((p) => {
      const key = p.platformKey
      if (key !== 'windows' && key !== 'macos') return
      setProgress((cur) => ({ ...cur, [key]: p }))
    })
    return off
  }, [])

  async function saveInfo() {
    setSavingInfo(true)
    try {
      const next: Bootstrap = {
        sender: bootstrap?.sender || {},
        update: { ...(bootstrap?.update || {}), version, notes },
        extra: bootstrap?.extra || {},
      }
      await saveBootstrap(next)
      toast.success('发布信息已保存。')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingInfo(false)
    }
  }

  async function pick(platformKey: PlatformKey) {
    const file = await adminApi.selectReleaseFile()
    if (!file) return
    setDrafts((cur) => ({ ...cur, [platformKey]: file }))
  }

  async function upload(platformKey: PlatformKey) {
    const draft = drafts[platformKey]
    if (!draft?.filePath) {
      toast.error('请先选择安装包文件')
      return
    }
    setUploading((cur) => ({ ...cur, [platformKey]: true }))
    setProgress((cur) => ({
      ...cur,
      [platformKey]: {
        platformKey,
        fileName: draft.fileName,
        transferred: 0,
        total: draft.size,
        percent: 0,
      },
    }))
    try {
      await adminApi.uploadRelease({
        serverUrl,
        token,
        filePath: draft.filePath,
        platformKey,
        version,
        notes,
      })
      await loadBootstrap({ silent: true })
      toast.success(`${platformKey === 'windows' ? 'Windows' : 'macOS'} 安装包已上传。`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading((cur) => ({ ...cur, [platformKey]: false }))
      setProgress((cur) => ({ ...cur, [platformKey]: null }))
    }
  }

  function copyUrl(rawUrl: string) {
    const base = normalizeServerUrl(serverUrl)
    const full = /^https?:/i.test(rawUrl) ? rawUrl : `${base}${rawUrl}`
    void navigator.clipboard
      .writeText(full)
      .then(() => toast.success('下载地址已复制'))
      .catch(() => toast.error('复制失败'))
  }

  return (
    <PanelScaffold
      icon={Rocket}
      title="版本发布"
      hint="上传安装包后，客户端会从服务器检查更新并下载"
    >
      <div className="grid max-w-4xl gap-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">发布信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">版本号</Label>
                <Input
                  value={version}
                  placeholder="例如 4.2.1"
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">发布时间</Label>
                <Input value={String(update.publishedAt || '')} disabled placeholder="上传后自动生成" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">更新说明</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={savingInfo} onClick={() => void saveInfo()}>
                {savingInfo ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                保存发布信息
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReleaseCard
            title="Windows 安装包"
            icon={MonitorDown}
            currentUrl={update.windows?.url || ''}
            draft={drafts.windows}
            progress={progress.windows}
            uploading={uploading.windows}
            onPick={() => void pick('windows')}
            onUpload={() => void upload('windows')}
            onCopy={copyUrl}
          />
          <ReleaseCard
            title="macOS 安装包"
            icon={Apple}
            currentUrl={update.macos?.url || ''}
            draft={drafts.macos}
            progress={progress.macos}
            uploading={uploading.macos}
            onPick={() => void pick('macos')}
            onUpload={() => void upload('macos')}
            onCopy={copyUrl}
          />
        </div>
      </div>
    </PanelScaffold>
  )
}

function ReleaseCard({
  title,
  icon: Icon,
  currentUrl,
  draft,
  progress,
  uploading,
  onPick,
  onUpload,
  onCopy,
}: {
  title: string
  icon: typeof Rocket
  currentUrl: string
  draft: ReleaseFilePick | null
  progress: ReleaseUploadProgress | null
  uploading: boolean
  onPick: () => void
  onUpload: () => void
  onCopy: (url: string) => void
}) {
  const percent = progress
    ? progress.total
      ? Math.min(100, Math.round((progress.transferred / progress.total) * 100))
      : Math.min(100, Math.round(progress.percent || 0))
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="truncate font-medium">{draft?.fileName || '未选择文件'}</div>
          <div className="text-xs text-muted-foreground">
            {draft ? formatBytes(draft.size) : '选择本地安装包后上传'}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">当前地址</span>
          <span className="min-w-0 flex-1 truncate" title={currentUrl}>
            {currentUrl || '未配置'}
          </span>
          {currentUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              title="复制下载地址"
              onClick={() => onCopy(currentUrl)}
            >
              <Copy className="size-4" />
            </Button>
          )}
        </div>

        {progress && (
          <div className="grid gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate text-muted-foreground">
                {progress.fileName} · {formatBytes(progress.transferred)} /{' '}
                {progress.total ? formatBytes(progress.total) : '未知'}
              </span>
              <span className="tabular-nums font-medium">{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={uploading} onClick={onPick}>
            <FileUp className="size-4" />
            选择文件
          </Button>
          <Button className="flex-1" disabled={uploading || !draft} onClick={onUpload}>
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UploadCloud className="size-4" />
            )}
            上传
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
