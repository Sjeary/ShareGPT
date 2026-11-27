import { useEffect } from 'react'
import {
  BarChart3,
  Braces,
  Cable,
  Languages,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Network,
  Rocket,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PanelScaffold } from '@/components/panels/PanelScaffold'
import { cn } from '@/lib/utils'
import { useIntegratedAdminStore } from '@/store/useIntegratedAdminStore'
import type { AdminTab } from '@/types/admin'
import { AdminOverviewTab } from './admin/AdminOverviewTab'
import { AdminInvitesTab, AdminUsersTab } from './admin/AdminUsersInvitesTabs'
import { AdminAiUsageTab, AdminRoutingTab, AdminTranslationTab } from './admin/AdminAiRoutingTabs'
import {
  AdminBootstrapTab,
  AdminExtrasTab,
  AdminFeedbackTab,
  AdminProxyMissingTab,
  AdminReleasesTab,
} from './admin/AdminSystemTabs'

const ADMIN_NAV: ReadonlyArray<{
  key: AdminTab
  label: string
  group: '团队运营' | '网络与服务' | '维护与反馈'
  icon: LucideIcon
}> = [
  { key: 'overview', label: '概览', group: '团队运营', icon: LayoutDashboard },
  { key: 'users', label: '成员与权限', group: '团队运营', icon: Users },
  { key: 'invites', label: '邀请链接', group: '团队运营', icon: Link2 },
  { key: 'ai-usage', label: 'AI 使用统计', group: '团队运营', icon: BarChart3 },
  { key: 'airport', label: 'AI 线路策略', group: '网络与服务', icon: Network },
  { key: 'translation', label: '翻译服务', group: '网络与服务', icon: Languages },
  { key: 'bootstrap', label: '团队统一代理', group: '网络与服务', icon: Cable },
  { key: 'feedback', label: '反馈建议', group: '维护与反馈', icon: MessageSquareText },
  { key: 'proxy-missing', label: '漏走代理域名', group: '维护与反馈', icon: ShieldAlert },
  { key: 'releases', label: '版本信息', group: '维护与反馈', icon: Rocket },
  { key: 'extras', label: '高级配置', group: '维护与反馈', icon: Braces },
]

export default function AdminPanel() {
  const session = useIntegratedAdminStore((s) => s.session)
  const activeTab = useIntegratedAdminStore((s) => s.activeTab)
  const setActiveTab = useIntegratedAdminStore((s) => s.setActiveTab)
  const loadTab = useIntegratedAdminStore((s) => s.loadTab)
  const loading = useIntegratedAdminStore((s) => s.loading)
  const anyLoading = Object.values(loading).some(Boolean)

  useEffect(() => {
    if (!session) return
    void loadTab(activeTab).catch((err) => {
      const msg = err instanceof Error ? err.message : '加载管理数据失败'
      if (msg) toast.error(msg)
    })
  }, [activeTab, loadTab, session])

  return (
    <PanelScaffold
      icon={ShieldCheck}
      title="管理后台"
      hint="仅管理员可见 · 与当前团队账号权限实时同步"
      toolbar={
        <Button
          variant="outline"
          size="sm"
          disabled={!session || anyLoading}
          onClick={() =>
            void loadTab(activeTab).catch((err) =>
              toast.error(err instanceof Error ? err.message : '刷新失败'),
            )
          }
        >
          <RotateCw className={cn('size-3.5', anyLoading && 'animate-spin')} />
          刷新当前页
        </Button>
      }
    >
      {!session ? (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
          需要以管理员身份登录团队服务器后方可使用管理后台。
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
          <nav
            aria-label="管理后台导航"
            className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col"
          >
            {ADMIN_NAV.map((item, idx) => {
              const Icon = item.icon
              const prevGroup = idx > 0 ? ADMIN_NAV[idx - 1]?.group : null
              const active = activeTab === item.key
              return (
                <div key={item.key} className="contents lg:block">
                  {item.group !== prevGroup && (
                    <div
                      className={cn(
                        'hidden px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/80 lg:block',
                        idx > 0 ? 'pt-3' : 'pt-0.5',
                      )}
                    >
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab(item.key)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors lg:w-full lg:text-sm',
                      active
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'bg-card/60 text-foreground hover:bg-muted lg:bg-transparent',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                </div>
              )
            })}
          </nav>

          <div className="min-w-0">
            {activeTab === 'overview' && <AdminOverviewTab onJump={setActiveTab} />}
            {activeTab === 'users' && <AdminUsersTab />}
            {activeTab === 'invites' && <AdminInvitesTab />}
            {activeTab === 'ai-usage' && <AdminAiUsageTab />}
            {activeTab === 'airport' && <AdminRoutingTab />}
            {activeTab === 'translation' && <AdminTranslationTab />}
            {activeTab === 'bootstrap' && <AdminBootstrapTab />}
            {activeTab === 'releases' && <AdminReleasesTab />}
            {activeTab === 'feedback' && <AdminFeedbackTab />}
            {activeTab === 'proxy-missing' && <AdminProxyMissingTab />}
            {activeTab === 'extras' && <AdminExtrasTab />}
          </div>
        </div>
      )}
    </PanelScaffold>
  )
}
