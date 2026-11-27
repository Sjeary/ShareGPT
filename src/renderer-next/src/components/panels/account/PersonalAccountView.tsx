import { useState } from 'react'
import { ArrowRight, Building2, Laptop, LogIn, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AboutSection, ChangelogSection, UpdateSection } from './AppInfoSections'
import { BrowserPrivacySection } from './BrowserPrivacySection'
import { ImportActions } from './ImportActions'
import { InterfaceSettings } from './InterfaceSettings'
import { TeamAuthCard, useTeamLoginFormState, type OrgAuthTab } from './TeamAuthCard'

type PersonalSettingsCategory = 'all' | 'account' | 'interface' | 'privacy' | 'data' | 'updates'

const PERSONAL_CATEGORIES: ReadonlyArray<{ id: PersonalSettingsCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'account', label: '工作区' },
  { id: 'interface', label: '界面' },
  { id: 'privacy', label: '隐私与环境' },
  { id: 'data', label: '本机资料' },
  { id: 'updates', label: '更新与关于' },
]

// 个人工作区内的「账户与设置」视图，与已登录设置中心（LoggedInView）保持完全一致的排版与动效节奏。
export function PersonalAccountView() {
  const [category, setCategory] = useState<PersonalSettingsCategory>('all')
  const [showOrganizationLogin, setShowOrganizationLogin] = useState(false)
  const [orgAuthTab, setOrgAuthTab] = useState<OrgAuthTab>('login')
  const form = useTeamLoginFormState()

  const show = (target: Exclude<PersonalSettingsCategory, 'all'>) =>
    category === 'all' || category === target

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <div
        role="tablist"
        aria-label="设置分类"
        className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-xl border border-border/90 bg-background/92 p-1.5 shadow-2xs backdrop-blur-md"
      >
        {PERSONAL_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            onClick={() => setCategory(item.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
              category === item.id
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div key={category} className="motion-tab-panel flex flex-col gap-4">
        {show('account') && (
          <>
            <div className="flex w-full items-start gap-3.5 rounded-xl border border-border/80 bg-card/70 px-4 py-3.5 shadow-2xs">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <Laptop className="size-4" />
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
              <div className="motion-tab-panel space-y-2">
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

        {show('interface') && <InterfaceSettings />}

        {show('updates') && (
          <>
            <UpdateSection />
            <ChangelogSection />
            <AboutSection />
          </>
        )}

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

        {show('privacy') && <BrowserPrivacySection />}
      </div>
    </div>
  )
}
