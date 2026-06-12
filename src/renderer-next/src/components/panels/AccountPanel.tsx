import { UserRound } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'

// [团队重建目标] 登录/账户面板:
// - 未登录: 服务地址 / 账号 / 密码 / 记住密码 / 登录 (对应 collab.* 设置)
// - 已登录: 当前账号/头像、退出、协作通知开关
// 用 shadcn (Card/Input/Label/Button/Switch), 接 useAppStore + window.api。
export function AccountPanel() {
  return (
    <PanelScaffold icon={UserRound} title="账户" hint="登录与协作服务">
      <div className="grid h-full place-items-center p-6">
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          账户/登录面板 · 团队重建中
        </div>
      </div>
    </PanelScaffold>
  )
}
