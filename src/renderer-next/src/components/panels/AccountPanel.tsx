import { UserRound } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'
import { LoginForm } from './account/LoginForm'
import { LoggedInView } from './account/LoggedInView'
import { useAppStore } from '@/store/useAppStore'

// 账户/登录面板:
// - 未登录: 服务地址 / 账号 / 密码 / 记住密码 / 登录 (对应 collab.* 设置)
// - 已登录: 当前账号/头像、退出、协作通知开关
// 登录逻辑见 useAuth (直连协作服务器 POST /api/login), 会话态在 useAuthStore。
export function AccountPanel() {
  const authed = useAppStore((s) => s.authed)

  return (
    <PanelScaffold icon={UserRound} title="账户" hint="登录与协作服务">
      {authed ? <LoggedInView /> : <LoginForm />}
    </PanelScaffold>
  )
}
