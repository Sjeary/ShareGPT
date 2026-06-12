import { Titlebar } from '@/components/layout/Titlebar'
import { LoginForm } from '@/components/panels/account/LoginForm'

// 应用级登录页: 未登录时全屏展示, 登录成功(authed)后由 App 切到主界面 Shell。
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
