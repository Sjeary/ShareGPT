import { Cable } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'

// [团队重建目标] 连接服务面板:
// - sender 表单: proxy_server/proxy_port/proxy_uuid/socks_listen_port/fallback_mode/fallback_local_port/target_domains + 启动/停止
// - receiver 表单: frps_*/vmess_*/forward_proxy_port/tls/compression/encryption + 启停
// - 服务状态(useAppStore.status) 实时显示, 启停调 window.api.startSender/stopSender 等
// 用 shadcn (Tabs 切 sender/receiver, Card/Input/Label/Switch/Button)。
export function ServicePanel() {
  return (
    <PanelScaffold icon={Cable} title="连接服务" hint="发送 / 接收 代理服务">
      <div className="grid h-full place-items-center p-6">
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          连接服务面板 · 团队重建中
        </div>
      </div>
    </PanelScaffold>
  )
}
