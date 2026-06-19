import { useEffect, useState } from 'react'
import {
  Rocket,
  Save,
  Loader2,
  UploadCloud,
  FileUp,
  MonitorDown,
  Apple,
  LogOut,
  Globe,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi } from '@/lib/api'
import { useAdminStore } from '@/store/useAdminStore'
import type { ReleaseFilePick, ReleaseUploadProgress } from '@/types/adminApi'
import { PanelScaffold } from './PanelScaffold'

type PlatformKey = 'windows' | 'macos'

function formatBytes(size: number): string {
  const v = Math.max(0, Number(size) || 0)
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
}

export function DevReleasePanel() {
  const serverUrl = useAdminStore((s) => s.serverUrl)
  const devToken = useAdminStore((s) => s.devToken)
  const release = useAdminStore((s) => s.release)
  const loadDevRelease = useAdminStore((s) => s.loadDevRelease)
  const saveDevReleaseInfo = useAdminStore((s) => s.saveDevReleaseInfo)
  const devLogout = useAdminStore((s) => s.devLogout)

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
    void loadDevRelease()
  }, [loadDevRelease])

  useEffect(() => {
    setVersion(String(release?.version || ''))
    setNotes(String(release?.notes || ''))
  }, [release?.version, release?.notes])

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
      await saveDevReleaseInfo({ version, notes })
      toast.success('发布信息已保存（所有群生效）。')
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
        token: devToken,
        filePath: draft.filePath,
        platformKey,
        version,
        notes,
        uploadPath: '/api/dev/releases/upload',
      })
      await loadDevRelease()
      toast.success(`${platformKey === 'windows' ? 'Windows' : 'macOS'} 已发布到所有群。`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading((cur) => ({ ...cur, [platformKey]: false }))
      setProgress((cur) => ({ ...cur, [platformKey]: null }))
    }
  }

  return (
    <PanelScaffold
      icon={Rocket}
      title="全局版本发布"
      hint="开发者维度 · 一次推送，所有群（8088 / 8089 …）统一生效"
      toolbar={
        <Button variant="outline" size="sm" onClick={() => void devLogout()}>
          <LogOut className="size-4" />
          退出开发者
        </Button>
      }
    >
      <div className="grid max-w-4xl gap-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="size-4 text-amber-500" />
              当前全局版本
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">版本 {release?.version || '未发布'}</Badge>
              {release?.publishedAt && (
                <span className="text-xs text-muted-foreground">发布于 {release.publishedAt}</span>
              )}
              <Badge variant={release?.windows?.fileName ? 'default' : 'outline'}>
                Windows {release?.windows?.fileName ? '已配置' : '未配置'}
              </Badge>
              <Badge variant={release?.macos?.fileName ? 'default' : 'outline'}>
                macOS {release?.macos?.fileName ? '已配置' : '未配置'}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">版本号</Label>
                <Input
                  value={version}
                  placeholder="例如 4.2.1"
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" disabled={savingInfo} onClick={() => void saveInfo()}>
                  {savingInfo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  保存发布信息
                </Button>
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
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <DevReleaseCard
            title="Windows 安装包"
            icon={MonitorDown}
            currentName={release?.windows?.fileName || ''}
            draft={drafts.windows}
            progress={progress.windows}
            uploading={uploading.windows}
            onPick={() => void pick('windows')}
            onUpload={() => void upload('windows')}
          />
          <DevReleaseCard
            title="macOS 安装包"
            icon={Apple}
            currentName={release?.macos?.fileName || ''}
            draft={drafts.macos}
            progress={progress.macos}
            uploading={uploading.macos}
            onPick={() => void pick('macos')}
            onUpload={() => void upload('macos')}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          发布写入服务器的共享发布库，所有群的客户端在检查更新时都会拿到同一版本；
          下载地址由服务器按客户端实际访问的地址生成，端口始终可达。
        </p>
      </div>
    </PanelScaffold>
  )
}

function DevReleaseCard({
  title,
  icon: Icon,
  currentName,
  draft,
  progress,
  uploading,
  onPick,
  onUpload,
}: {
  title: string
  icon: typeof Rocket
  currentName: string
  draft: ReleaseFilePick | null
  progress: ReleaseUploadProgress | null
  uploading: boolean
  onPick: () => void
  onUpload: () => void
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
            {draft
              ? formatBytes(draft.size)
              : currentName
                ? `当前：${currentName}`
                : '选择本地安装包后发布'}
          </div>
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
            发布到所有群
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
