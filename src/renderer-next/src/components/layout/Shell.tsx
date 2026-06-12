import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { useAppStore } from '@/store/useAppStore'
import { ServicePanel } from '@/components/panels/ServicePanel'
import { ChatPanel } from '@/components/panels/ChatPanel'
import { AccountPanel } from '@/components/panels/AccountPanel'
import { GptPanel } from '@/components/panels/GptPanel'
import { GeminiPanel } from '@/components/panels/GeminiPanel'
import { StatsPanel } from '@/components/panels/StatsPanel'
import { LogsPanel } from '@/components/panels/LogsPanel'
import { SetupGuide } from '@/components/SetupGuide'
import { Toaster } from '@/components/ui/sonner'

export function Shell() {
  const active = useAppStore((s) => s.active)

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {active === 'service' && <ServicePanel />}
        {active === 'account' && <AccountPanel />}
        {active === 'gpt' && <GptPanel />}
        {active === 'gemini' && <GeminiPanel />}
        {active === 'stats' && <StatsPanel />}
        {active === 'logs' && <LogsPanel />}
        {/* 聊天面板常驻挂载(非激活时 display:none), 使协作 WS 在登录后全局常连,
            通知/在线状态随处生效, 而非仅在聊天页打开时。 */}
        <div className={active === 'chat' ? 'contents' : 'hidden'}>
          <ChatPanel />
        </div>
      </div>
      <SetupGuide />
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  )
}
