import { useState } from 'react'
import { Globe2, Loader2, MapPinOff, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useChatStore } from '@/store/useChatStore'
import { useAiStore, type AiKind } from '@/store/useAiStore'
import type {
  BrowserEnvironmentMode,
  BrowserEnvironmentSettings,
  BrowserGeolocationMode,
  BrowserPrivacySettings,
} from '@/types/settings'

const PROVIDERS: Array<{ kind: AiKind; label: string; description: string }> = [
  { kind: 'gpt', label: 'ChatGPT', description: '只清除 ChatGPT 网页分区' },
  { kind: 'gemini', label: 'Gemini', description: '只清除 Gemini 网页分区' },
  { kind: 'claude', label: 'Claude', description: '只清除 Claude 网页分区' },
]

const US_TIMEZONES = [
  ['America/New_York', '美国东部'],
  ['America/Chicago', '美国中部'],
  ['America/Denver', '美国山地'],
  ['America/Los_Angeles', '美国太平洋'],
  ['America/Anchorage', '阿拉斯加'],
  ['Pacific/Honolulu', '夏威夷'],
] as const

function formatWhen(value: string): string {
  if (!value) return '从未清除'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '已清除' : date.toLocaleString()
}

function trimServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function BrowserPrivacySection() {
  const privacy = useAppStore((state) => state.settings?.browserPrivacy)
  const patchSection = useAppStore((state) => state.patchSection)
  const token = useAuthStore((state) => state.token)
  const identity = useChatStore((state) => state.identity)
  const [clearTarget, setClearTarget] = useState<AiKind | null>(null)
  const [password, setPassword] = useState('')
  const [clearing, setClearing] = useState(false)
  const [syncingExit, setSyncingExit] = useState(false)

  if (!privacy) return null

  const environment = privacy.environment

  async function savePrivacy(next: BrowserPrivacySettings, apply = true): Promise<void> {
    await patchSection('browserPrivacy', next)
    if (apply) {
      const result = await api.applyBrowserPrivacy()
      if (!result.ok) throw new Error('部分已打开的网页环境应用失败，请关闭网页标签后重试')
    }
  }

  async function patchEnvironment(
    patch: Partial<BrowserEnvironmentSettings>,
    apply = true,
  ): Promise<void> {
    const current = useAppStore.getState().settings?.browserPrivacy
    if (!current) return
    await savePrivacy(
      {
        ...current,
        updatedAt: new Date().toISOString(),
        environment: { ...current.environment, ...patch },
      },
      apply,
    )
  }

  async function changeMode(mode: BrowserEnvironmentMode): Promise<void> {
    try {
      const timezone =
        mode === 'us' && !US_TIMEZONES.some(([value]) => value === environment.timezone)
          ? 'America/Los_Angeles'
          : environment.timezone
      await patchEnvironment({
        mode,
        timezone,
        locale: 'en-US',
        acceptLanguages: 'en-US,en',
        geolocationMode: mode === 'proxy' ? environment.geolocationMode : 'disabled',
        ...(mode === 'proxy'
          ? {
              sourceIp: '',
              countryCode: '',
              country: '',
              region: '',
              city: '',
              latitude: null,
              longitude: null,
              accuracy: null,
              sourceUpdatedAt: '',
            }
          : {}),
      })
      toast.success(mode === 'system' ? '网页环境已改为跟随系统' : '网页环境配置已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存网页环境失败')
    }
  }

  async function changeGeolocation(mode: BrowserGeolocationMode): Promise<void> {
    try {
      if (mode === 'proxy' && (environment.latitude === null || environment.longitude === null)) {
        toast.error('请先从当前代理出口同步位置')
        return
      }
      await patchEnvironment({ geolocationMode: mode })
      toast.success(mode === 'proxy' ? '网页将返回出口 IP 的粗略位置' : '网页地理位置已关闭')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存地理位置设置失败')
    }
  }

  async function syncFromExit(): Promise<void> {
    if (syncingExit) return
    setSyncingExit(true)
    try {
      const detected = await api.detectProxyEnvironment()
      await patchEnvironment({
        mode: 'proxy',
        locale: 'en-US',
        acceptLanguages: 'en-US,en',
        timezone: detected.timezone,
        latitude: detected.latitude,
        longitude: detected.longitude,
        accuracy: detected.accuracy,
        sourceIp: detected.ip,
        countryCode: detected.countryCode,
        country: detected.country,
        region: detected.region,
        city: detected.city,
        sourceUpdatedAt: detected.checkedAt,
      })
      if (detected.countryCode === 'US') {
        toast.success(`已同步美国出口：${detected.region || detected.city || detected.timezone}`)
      } else {
        toast.info(`出口位于 ${detected.country || detected.countryCode}，环境已按真实出口同步`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步代理出口环境失败')
    } finally {
      setSyncingExit(false)
    }
  }

  async function verifyPassword(): Promise<void> {
    if (!clearTarget || !password || clearing) return
    const serverUrl = trimServerUrl(identity.serverUrl)
    const activeToken = token || identity.token
    if (!serverUrl || !activeToken) {
      toast.error('协作账号登录已失效，请重新登录后再清除')
      return
    }

    setClearing(true)
    try {
      const target = clearTarget
      await api.clearAiBrowserData(target, {
        password,
        serverUrl,
        token: activeToken,
      })
      useAiStore.getState().setFeedback(target, '')
      await useAppStore.getState().reloadSettings()
      const label = PROVIDERS.find((item) => item.kind === target)?.label || target
      toast.success(`${label} 的 Cookie、登录状态和本地网页记录已清除`)
      setClearTarget(null)
      setPassword('')
    } catch (error) {
      setPassword('')
      toast.error(error instanceof Error ? error.message : '清除网页登录数据失败')
    } finally {
      setClearing(false)
    }
  }

  const locationLabel = [environment.city, environment.region, environment.country]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            网页隐私与环境
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <div>
              <p className="text-sm font-medium">网页登录数据</p>
              <p className="text-xs text-muted-foreground">
                分别清除对应网页的 Cookie、缓存、LocalStorage、IndexedDB 和 Service Worker；不会删除
                ShareGPT 的聊天、笔记或日历。
              </p>
            </div>
            {PROVIDERS.map((provider) => (
              <div
                key={provider.kind}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.description} · {formatWhen(privacy.lastClearedAt[provider.kind])}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setPassword('')
                    setClearTarget(provider.kind)
                  }}
                >
                  <Trash2 />
                  清除
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          <div className="grid gap-3">
            <div>
              <p className="text-sm font-medium">浏览器环境</p>
              <p className="text-xs text-muted-foreground">
                WebRTC 禁止非代理 UDP；美国/代理模式使用 en-US，跟随系统时不覆盖语言。网页不会得到
                真实地理位置，除非选择使用出口 IP 的城市级位置。
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="browser-environment-mode">环境来源</Label>
              <select
                id="browser-environment-mode"
                value={environment.mode}
                onChange={(event) => void changeMode(event.target.value as BrowserEnvironmentMode)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="system">跟随本机系统</option>
                <option value="us">美国环境预设</option>
                <option value="proxy">跟随代理出口</option>
              </select>
            </div>

            {environment.mode === 'us' && (
              <div className="grid gap-1.5">
                <Label htmlFor="browser-us-timezone">美国时区</Label>
                <select
                  id="browser-us-timezone"
                  value={environment.timezone}
                  onChange={(event) => void patchEnvironment({ timezone: event.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {US_TIMEZONES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label} · {value}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {environment.mode === 'proxy' && (
              <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">当前出口环境</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {environment.sourceUpdatedAt
                        ? `${locationLabel || '未知地区'} · ${environment.timezone}${environment.sourceIp ? ` · ${environment.sourceIp}` : ''}`
                        : '尚未同步；未同步前不会启用环境覆盖。'}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={syncFromExit} disabled={syncingExit}>
                    {syncingExit ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {syncingExit ? '检测中…' : '从当前出口同步'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="browser-auto-sync">代理启动后自动同步</Label>
                    <p className="text-xs text-muted-foreground">
                      节点配置变化时重新校准时区和位置。
                    </p>
                  </div>
                  <Switch
                    id="browser-auto-sync"
                    checked={environment.autoSyncFromProxy}
                    onCheckedChange={(checked) =>
                      void patchEnvironment({ autoSyncFromProxy: checked }, false)
                    }
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="browser-geolocation">网页地理位置</Label>
                  <select
                    id="browser-geolocation"
                    value={environment.geolocationMode}
                    onChange={(event) =>
                      void changeGeolocation(event.target.value as BrowserGeolocationMode)
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="disabled">不提供地理位置</option>
                    <option value="proxy">使用出口 IP 的粗略位置</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="browser-privacy-sync">跨设备同步环境配置</Label>
                <p className="text-xs text-muted-foreground">
                  只同步语言、美国预设时区和位置策略；每台设备单独检测当前代理节点。不上传
                  Cookie、密码、网页登录态、出口 IP、位置检测结果或清理记录。
                </p>
              </div>
              <Switch
                id="browser-privacy-sync"
                checked={privacy.syncEnabled}
                onCheckedChange={(checked) =>
                  void savePrivacy({ ...privacy, syncEnabled: checked }, false)
                }
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {environment.geolocationMode === 'disabled' ? (
                <MapPinOff className="mt-0.5 size-4 shrink-0" />
              ) : (
                <Globe2 className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                这些设置用于减少真实地址泄漏和环境矛盾，不能删除服务商服务器记录，也不保证网站无法识别代理。
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (clearing) return
          if (!open) {
            setClearTarget(null)
            setPassword('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              清除 {PROVIDERS.find((item) => item.kind === clearTarget)?.label || ''} 网页数据
            </DialogTitle>
            <DialogDescription>
              该服务的网页标签会关闭，Cookie、登录状态和本地网页记录将永久删除。请输入当前协作账号密码确认。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="browser-clear-password">当前协作账号密码</Label>
            <Input
              id="browser-clear-password"
              type="password"
              autoComplete="off"
              value={password}
              disabled={clearing}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verifyPassword()
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={clearing}
              onClick={() => {
                setClearTarget(null)
                setPassword('')
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!password || clearing}
              onClick={() => void verifyPassword()}
            >
              {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {clearing ? '验证并清除中…' : '验证密码并清除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
