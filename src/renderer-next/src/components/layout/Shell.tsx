import { useEffect } from 'react'
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
import { Toaster } from '@/components/ui/sonner'

export function Shell() {
  const active = useAppStore((s) => s.active)
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {active === 'service' && <ServicePanel />}
        {active === 'chat' && <ChatPanel />}
        {active === 'account' && <AccountPanel />}
        {active === 'gpt' && <GptPanel />}
        {active === 'gemini' && <GeminiPanel />}
        {active === 'stats' && <StatsPanel />}
        {active === 'logs' && <LogsPanel />}
      </div>
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  )
}
