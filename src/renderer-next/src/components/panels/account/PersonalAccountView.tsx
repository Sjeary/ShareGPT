import { useState } from 'react'
import {
  ArrowRight,
  Building2,
  HardDrive,
  Laptop,
  LayoutGrid,
  LogIn,
  Palette,
  Shield,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AboutSection, ChangelogSection, UpdateSection } from './AppInfoSections'
import { BrowserPrivacySection } from './BrowserPrivacySection'
import { ImportActions } from './ImportActions'
import { InterfaceSettings } from './InterfaceSettings'
import { ShortcutsCard } from './LoggedInView'
import { TeamAuthCard, type OrgAuthTab } from './TeamAuthCard'
import { useTeamLoginFormState } from './useTeamLoginFormState'

type PersonalSettingsCategory = 'all' | 'account' | 'interface' | 'privacy' | 'data' | 'updates'

const PERSONAL_CATEGORIES: ReadonlyArray<{
  id: PersonalSettingsCategory
  label: string
  desc: string
  icon: LucideIcon
}> = [
  { id: 'all', label: '全部设置', desc: '一览所有配置项', icon: LayoutGrid },
  { id: 'account', label: '工作区', desc: '个人模式与团队登录', icon: Laptop },
  { id: 'interface', label: '界面与快捷键', desc: '主题、模块与操作', icon: Palette },
  { id: 'privacy', label: '隐私与环境', desc: '浏览器分区与清理', icon: Shield },
  { id: 'data', label: '本机资料', desc: '备份导出与导入', icon: HardDrive },
  { id: 'updates', label: '更新与关于', desc: '版本日志与说明', icon: Sparkles },
]

export function PersonalAccountView() {
  const [category, setCategory] = useState<PersonalSettingsCategory>('all')
  const [showOrganizationLogin, setShowOrganizationLogin] = useState(false)
  const [orgAuthTab, setOrgAuthTab] = useState<OrgAuthTab>('login')
  const form = useTeamLoginFormState()

  const show = (target: Exclude<PersonalSettingsCategory, 'all'>) =>
    category === 'all' || category === target

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start">
      <nav
        role="tablist"
        aria-label="设置分类"
        className="flex flex-wrap gap-1.5 lg:sticky lg:top-6 lg:flex-col lg:gap-1"
      >
        {PERSONAL_CATEGORIES.map((item) => {
          const Icon = item.icon
          const selected = category === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setCategory(item.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-card/60 text-foreground hover:bg-muted lg:bg-transparent',
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  selected ? 'text-primary-foreground' : 'text-muted-foreground',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium lg:text-sm">{item.label}</span>
                <span
                  className={cn(
                    'hidden truncate text-[11px] lg:block',
                    selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {item.desc}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {show('account') && (
          <>
            <div className="flex w-full items-start gap-3.5 rounded-xl border border-border/85 bg-card px-4 py-3.5 shadow-2xs">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Laptop className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">当前：个人工作区</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  个人代理、翻译配置和 AI
                  网页会话使用独立本机分区。登录组织后会切换到该账号自己的配置与网页会话。
                </p>
              </div>
            </div>

            {showOrganizationLogin ? (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => setShowOrganizationLogin(false)}
                  >
                    <X className="size-3.5" />
                    收起团队登录
                  </Button>
                </div>
                <TeamAuthCard
                  mode="personal"
                  activeTab={orgAuthTab}
                  onTabChange={setOrgAuthTab}
                  serverUrl={form.serverUrl}
                  username={form.username}
                  password={form.password}
                  rememberPassword={form.rememberPassword}
                  submitting={form.submitting}
                  error={form.error}
                  errorField={form.errorField}
                  errorShakeKey={form.errorShakeKey}
                  onServerUrlChange={form.setServerUrl}
                  onUsernameChange={form.setUsername}
                  onPasswordChange={form.setPassword}
                  onRememberPasswordChange={form.setRememberPassword}
                  onSubmit={(e) => void form.submitLogin(e)}
                  onRegisteredNeedManualLogin={({ serverUrl: nextUrl, username: nextUser }) => {
                    form.setServerUrl(nextUrl)
                    form.setUsername(nextUser)
                    form.setPassword('')
                    setOrgAuthTab('login')
                  }}
                  serverRef={form.serverRef}
                  usernameRef={form.usernameRef}
                  passwordRef={form.passwordRef}
                />
              </div>
            ) : (
              <Card className="w-full">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="size-4 text-primary" />
                    组织协作（可选）
                  </CardTitle>
                  <CardDescription>
                    需要协作聊天、在线成员、管理员线路或组织用量时，再登录组织工作区。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowOrganizationLogin(true)}
                  >
                    <LogIn />
                    登录组织工作区
                    <ArrowRight className="ml-auto" />
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {show('interface') && (
          <>
            <InterfaceSettings />
            <ShortcutsCard />
          </>
        )}

        {show('privacy') && <BrowserPrivacySection />}

        {show('data') && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-base">本机资料</CardTitle>
            </CardHeader>
            <CardContent>
              <ImportActions />
            </CardContent>
          </Card>
        )}

        {show('updates') && (
          <>
            <UpdateSection />
            <ChangelogSection />
            <AboutSection />
          </>
        )}
      </div>
    </div>
  )
}
