import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSyncStatus, type SyncKind } from '@/lib/cloudSync'

// 云端同步状态小指示器 (放在个人日历 / 待办面板顶部)。
//  synced=已同步, syncing=同步中, local=仅本地(未登录/服务器不支持), error=同步出错, off=未启用。
export function SyncBadge({ kind, className }: { kind: SyncKind; className?: string }) {
  const state = useSyncStatus((s) => s[kind])

  const meta = {
    synced: { Icon: Cloud, text: '云端已同步', cls: 'text-emerald-500' },
    syncing: { Icon: RefreshCw, text: '同步中…', cls: 'text-primary' },
    local: { Icon: CloudOff, text: '仅本地', cls: 'text-muted-foreground' },
    error: { Icon: CloudOff, text: '同步出错', cls: 'text-destructive' },
    off: { Icon: Cloud, text: '未同步', cls: 'text-muted-foreground' },
  }[state]

  const Icon = meta.Icon
  return (
    <span
      title={
        state === 'local'
          ? '未登录或服务器暂不支持，数据仅保存在本机'
          : state === 'synced'
            ? '已与云端同步，可多端实时共享'
            : meta.text
      }
      className={cn('inline-flex items-center gap-1.5 text-sm', meta.cls, className)}
    >
      <Icon className={cn('size-4', state === 'syncing' && 'animate-spin')} />
      <span className="hidden sm:inline">{meta.text}</span>
    </span>
  )
}
