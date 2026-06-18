import { Rocket, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminStore } from '@/store/useAdminStore'
import { PanelScaffold } from './PanelScaffold'

// 版本发布已上收为「开发者」的全局职责(共享发布库),群管理员这里仅只读查看。
// 要发布新版本,请用开发者密钥登录「开发者发布」。
export function ReleasesPanel() {
  const bootstrap = useAdminStore((s) => s.bootstrap)
  const update = bootstrap?.update || {}

  return (
    <PanelScaffold
      icon={Rocket}
      title="版本发布"
      hint="版本发布已统一由开发者管理（一次推送，所有群生效）"
    >
      <div className="grid max-w-3xl gap-4 p-6">
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium">版本发布是开发者职责</p>
              <p className="mt-1 text-muted-foreground">
                app 安装包对所有群是同一个，因此「上传新版本」已上收为开发者的全局操作：
                退出登录后，在登录页切到 <span className="font-medium text-foreground">「开发者发布」</span>，
                用开发者密钥登录即可一次推送、所有群生效。群管理员在此仅查看。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前对客户端生效的版本</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">版本号</span>
              <Badge variant="outline">{update.version || '未发布'}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">发布时间</span>
              <span className="font-medium">{update.publishedAt || '—'}</span>
            </div>
            {update.notes && (
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {update.notes}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              注：实际下发给客户端的版本以开发者的全局发布为准。
            </p>
          </CardContent>
        </Card>
      </div>
    </PanelScaffold>
  )
}
