import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Titlebar } from '@/components/layout/Titlebar'
import { Shell } from '@/components/layout/Shell'
import { LoginScreen } from '@/components/LoginScreen'

// 应用级登录门: 先等设置加载(确保登录页能预填), 未登录展示登录页, 登录成功(authed)后进入 Shell。
export default function App() {
  const authed = useAppStore((s) => s.authed)
  const settings = useAppStore((s) => s.settings)
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!settings) {
    return (
      <div className="flex h-full flex-col bg-background text-foreground">
        <Titlebar />
        <div className="grid min-h-0 flex-1 place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return authed ? <Shell /> : <LoginScreen />
}
