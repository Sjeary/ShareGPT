import { Titlebar } from '@/components/layout/Titlebar'
import { LoginForm } from '@/components/panels/account/LoginForm'

// 工作区入口：可进入 local-device 个人工作区，或登录服务器确认的组织工作区。
export function LoginScreen() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="min-h-0 flex-1">
        <LoginForm />
      </div>
    </div>
  )
}
