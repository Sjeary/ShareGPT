import { useEffect } from 'react'
import { useAdminStore } from '@/store/useAdminStore'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { OverviewPanel } from '@/components/panels/OverviewPanel'
import { UsersPanel } from '@/components/panels/UsersPanel'
import { BootstrapPanel } from '@/components/panels/BootstrapPanel'
import { ReleasesPanel } from '@/components/panels/ReleasesPanel'
import { ExtrasPanel } from '@/components/panels/ExtrasPanel'
import { FeedbackPanel } from '@/components/panels/FeedbackPanel'
import { ProxyMissingPanel } from '@/components/panels/ProxyMissingPanel'
import { AirportPanel } from '@/components/panels/AirportPanel'

const REFRESH_INTERVAL = 15000

export function Shell() {
  const active = useAdminStore((s) => s.activeTab)
  const autoRefresh = useAdminStore((s) => s.autoRefresh)
  const loadUsers = useAdminStore((s) => s.loadUsers)

  // 自动刷新在线状态: 开关开启时定时静默拉取用户列表。
  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      void loadUsers({ silent: true })
    }, REFRESH_INTERVAL)
    return () => window.clearInterval(id)
  }, [autoRefresh, loadUsers])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {active === 'overview' && <OverviewPanel />}
          {active === 'users' && <UsersPanel />}
          {active === 'bootstrap' && <BootstrapPanel />}
          {active === 'airport' && <AirportPanel />}
          {active === 'releases' && <ReleasesPanel />}
          {active === 'feedback' && <FeedbackPanel />}
          {active === 'proxy-missing' && <ProxyMissingPanel />}
          {active === 'extras' && <ExtrasPanel />}
        </main>
      </div>
    </div>
  )
}
