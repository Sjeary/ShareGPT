import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { DEFAULT_TARGET_DOMAINS } from '@/components/panels/service/helpers'
import { Titlebar } from '@/components/layout/Titlebar'
import { Shell } from '@/components/layout/Shell'
import { LoginScreen } from '@/components/LoginScreen'

// 应用级登录门: 先等设置加载(确保登录页能预填), 未登录展示登录页, 登录成功(authed)后进入 Shell。
export default function App() {
  const authed = useAppStore((s) => s.authed)
  const settings = useAppStore((s) => s.settings)
  const meta = useAppStore((s) => s.meta)
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // 版本更新后: 把已并入最新内置清单 DEFAULT_TARGET_DOMAINS 的"自动域名"剔除,
  // 保证代理域名以最新内置清单为准, 而非一直保留旧的自动累积项。(按版本只跑一次)
  useEffect(() => {
    if (!settings || !meta) return
    const version = String((meta as Record<string, unknown>).version ?? '')
    if (!version || settings.ui?.last_version === version) return
    const patch = useAppStore.getState().patchSection
    const auto = settings.sender?.auto_domains ?? []
    const defaults = DEFAULT_TARGET_DOMAINS.split(',').map((s) => s.trim()).filter(Boolean)
    const covered = (d: string) => defaults.some((s) => d === s || d.endsWith('.' + s))
    const pruned = auto.filter((d) => !covered(d))
    void patch('ui', { last_version: version })
    if (pruned.length !== auto.length) void patch('sender', { auto_domains: pruned })
  }, [settings, meta])

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
