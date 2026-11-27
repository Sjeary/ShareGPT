import { showErrorToast } from '@/lib/errorToast'
import { useMemo, useState } from 'react'
import { Play, Square, Loader2, TriangleAlert, Radar, ArrowRight, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore } from '@/store/useChatStore'
import { useAuthStore } from '@/store/useAuthStore'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SenderSettings } from '@/types/settings'
import { canStartWorkspaceProxy } from '@/lib/workspaceCapabilities'
import { canEditManagedProxy } from '@/lib/managedProxyPolicy'
import { Field } from './Field'
import { FALLBACK_MODES, isSenderRunning, safeText } from './helpers'
import { resolveSenderForm, startWorkspaceSender } from './startSenderAction'

type DetectedProxy = { host: string; port: number; protocol: 'socks5' | 'http'; label: string }

export function SenderForm() {
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.status)
  const mode = useAppStore((s) => s.mode)
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const patchSection = useAppStore((s) => s.patchSection)
  const setActive = useAppStore((s) => s.setActive)
  const connection = useChatStore((s) => s.connection)
  const isAdmin = useAuthStore((s) => Boolean(s.profile?.isAdmin))
  const canEditTeamConfig = useAuthStore((s) => canEditManagedProxy(s.profile))
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  const [detectedProxies, setDetectedProxies] = useState<DetectedProxy[]>([])
  const [showReadonlyDetails, setShowReadonlyDetails] = useState(false)

  const running = isSenderRunning(status)
  const online = connection === 'online'
  const canStart = canStartWorkspaceProxy(workspaceMode, online)
  const personalWorkspace = workspaceMode === 'personal'

  const {
    form,
    personalProtocol,
    personalHost,
    personalPort,
    resolvedTargetDomains,
    unifiedAvailable,
    airportAvailable,
  } = useMemo(() => resolveSenderForm(settings?.sender, mode), [settings?.sender, mode])

  const directMode = form.fallback_mode === 'direct'
  // 团队配置仅管理员可编辑；个人工作区不受团队角色限制。
  const locked = running || busy || (!personalWorkspace && !canEditTeamConfig)
  const selectionLocked = running || busy

  function update(patch: Partial<SenderSettings>) {
    if (locked) return
    void patchSection('sender', patch)
  }

  function selectProxy(proxyMode: 'unified' | 'airport') {
    if (personalWorkspace || selectionLocked) return
    if (proxyMode === 'airport' ? !airportAvailable : !unifiedAvailable) return
    void patchSection('sender', { proxy_mode: proxyMode })
  }

  async function handleDetectLocalProxy() {
    if (probing || locked) return
    setProbing(true)
    try {
      const found = (await api.detectLocalProxy?.()) ?? []
      setDetectedProxies(found)
      if (!found.length) {
        toast.info('未检测到常见本机代理端口（如 7897 / 7890 / 10808），请先打开代理软件或手动填写')
        return
      }
      const first = found[0]
      await patchSection('sender', {
        proxy_mode: 'personal',
        personal_proxy_protocol: first.protocol,
        personal_proxy_host: first.host,
        personal_proxy_port: String(first.port),
      })
      toast.success(`已检测到 ${first.label}，并自动填入`)
    } catch (e) {
      showErrorToast(e, '检测本机代理')
    } finally {
      setProbing(false)
    }
  }

  async function handleStart() {
    setBusy(true)
    try {
      await startWorkspaceSender({ workspaceMode, online })
      toast.success('代理已开启')
    } catch (e) {
      showErrorToast(e, '开启代理')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      await api.stopSender()
      toast.success('已发送停止指令')
    } catch (e) {
      showErrorToast(e, '停止代理')
    } finally {
      setBusy(false)
    }
  }

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2.5 pt-1">
      {running ? (
        <>
          <Button variant="destructive" disabled={busy} onClick={handleStop}>
            {busy ? <Loader2 className="animate-spin" /> : <Square />}
            停止代理
          </Button>
          <Button variant="outline" onClick={() => setActive('gpt')}>
            前往 ChatGPT
            <ArrowRight />
          </Button>
        </>
      ) : (
        <Button disabled={busy || !canStart} onClick={handleStart}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          开启代理
        </Button>
      )}
    </div>
  )

  const teamTechnicalFields = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="s_proxy_server"
          label="服务器地址"
          value={form.proxy_server}
          placeholder="例如 203.0.113.10 或 demo.example.com"
          disabled={locked}
          onChange={(v) => update({ proxy_server: v })}
        />
        <Field
          id="s_proxy_port"
          label="连接端口"
          value={form.proxy_port}
          placeholder="例如 443"
          disabled={locked}
          onChange={(v) => update({ proxy_port: v })}
        />
        <Field
          id="s_proxy_uuid"
          label="连接身份码"
          value={form.proxy_uuid}
          placeholder="请输入连接身份码"
          disabled={locked}
          onChange={(v) => update({ proxy_uuid: v })}
        />
        <Field
          id="s_socks_listen_port"
          label="本地代理端口"
          value={form.socks_listen_port}
          placeholder="例如 1080"
          disabled={locked}
          onChange={(v) => update({ socks_listen_port: v })}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s_fallback_mode" className="text-xs text-muted-foreground">
            其他网站访问方式
          </Label>
          <select
            id="s_fallback_mode"
            value={form.fallback_mode || 'system_proxy'}
            disabled={locked}
            onChange={(e) => update({ fallback_mode: e.target.value })}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
          >
            {FALLBACK_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="s_fallback_local_port"
          label="本机已有代理端口"
          value={form.fallback_local_port}
          placeholder="例如 7890"
          disabled={locked || directMode}
          onChange={(v) => update({ fallback_local_port: v })}
          className={directMode ? 'opacity-50' : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="s_target_domains" className="text-xs text-muted-foreground">
          固定走连接的网站
        </Label>
        <textarea
          id="s_target_domains"
          rows={4}
          readOnly
          value={resolvedTargetDomains}
          placeholder="开启后由系统自动维护"
          className="resize-none rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground shadow-xs outline-none"
        />
      </div>
    </>
  )

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {personalWorkspace
          ? '连接你已有的代理。ShareGPT 只会将内嵌 AI 所需的网站交给它，其余流量保持直连。'
          : canEditTeamConfig
            ? '你可以调整当前账号的代理设置；修改后需要重新开启代理。'
            : '连接信息已由管理员自动同步，无需手动填写。选择可用线路并点击下方「开启代理」即可直接使用 AI。'}
      </p>

      {/* 组织工作区可在账号线路和管理员下发节点之间选择；个人工作区没有这层切换。 */}
      {!personalWorkspace && (
        <div className="grid gap-1.5">
          <Label className="cursor-default">代理方式</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={selectionLocked || !unifiedAvailable}
              aria-pressed={form.proxy_mode !== 'airport'}
              onClick={() => selectProxy('unified')}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60',
                form.proxy_mode !== 'airport'
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-accent/40',
              )}
            >
              <div className="text-sm font-medium">统一梯子（默认）</div>
              <div className="truncate text-xs text-muted-foreground">
                {unifiedAvailable
                  ? `经统一服务器 ${safeText(form.proxy_server)} 出网`
                  : '配置未就绪或暂未获授权'}
              </div>
            </button>
            <button
              type="button"
              disabled={selectionLocked || !airportAvailable}
              aria-pressed={form.proxy_mode === 'airport'}
              onClick={() => selectProxy('airport')}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50',
                form.proxy_mode === 'airport'
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-accent/40',
              )}
            >
              <div className="text-sm font-medium">机场节点</div>
              <div className="truncate text-xs text-muted-foreground">
                {airportAvailable
                  ? `当前：${safeText(form.airport_name) || '已下发节点'}`
                  : '管理员暂未下发可用节点'}
              </div>
            </button>
          </div>
        </div>
      )}

      {!running && !canStart ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-muted-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <span>请先登录账号并保持在线，再开启代理。</span>
        </div>
      ) : null}

      {personalWorkspace ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">不确定代理端口？</p>
              <p className="text-xs text-muted-foreground">
                可自动扫描本机 127.0.0.1 上运行中的 Clash / Mihomo / v2rayN 等代理端口。
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked || probing}
              onClick={() => void handleDetectLocalProxy()}
            >
              {probing ? <Loader2 className="animate-spin" /> : <Radar />}
              {probing ? '检测中…' : '自动检测本机代理'}
            </Button>
          </div>

          {detectedProxies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">检测到可用端口：</span>
              {detectedProxies.map((item) => (
                <button
                  key={`${item.protocol}:${item.port}`}
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    update({
                      proxy_mode: 'personal',
                      personal_proxy_protocol: item.protocol,
                      personal_proxy_host: item.host,
                      personal_proxy_port: String(item.port),
                    })
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    personalPort === String(item.port) && personalProtocol === item.protocol
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">代理协议</Label>
            <div className="grid grid-cols-2 rounded-md bg-muted p-1">
              {(['socks5', 'http'] as const).map((protocol) => (
                <button
                  key={protocol}
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    update({ proxy_mode: 'personal', personal_proxy_protocol: protocol })
                  }
                  className={cn(
                    'h-8 rounded-sm text-sm font-medium transition-colors disabled:opacity-50',
                    personalProtocol === protocol
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {protocol === 'socks5' ? 'SOCKS5' : 'HTTP'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field
              id="s_personal_proxy_host"
              label="代理地址"
              value={personalHost}
              placeholder="127.0.0.1"
              disabled={locked}
              onChange={(v) => update({ proxy_mode: 'personal', personal_proxy_host: v })}
              hint="填写代理软件实际监听的地址；本机代理通常使用 127.0.0.1。"
            />
            <Field
              id="s_personal_proxy_port"
              label="代理端口"
              value={personalPort}
              placeholder="例如 7890"
              disabled={locked}
              onChange={(v) => update({ proxy_mode: 'personal', personal_proxy_port: v })}
            />
          </div>
          {actionButtons}
        </div>
      ) : canEditTeamConfig ? (
        <>
          {teamTechnicalFields}
          {isAdmin && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
              <div className="min-w-0">
                <Label
                  htmlFor="s_route_all"
                  className="cursor-pointer text-amber-600 dark:text-amber-400"
                >
                  全部流量走代理（测试 · 仅管理员）
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  开启后除内网外的所有流量都走梯子（不再只走上面的清单），用于排查内嵌页到底访问了哪些域名；配合各页面的「代理检测」查看实际流量。修改后需重启代理生效。
                </p>
              </div>
              <Switch
                id="s_route_all"
                checked={Boolean(form.route_all)}
                disabled={busy}
                onCheckedChange={(v) => update({ route_all: v })}
              />
            </div>
          )}
          {actionButtons}
        </>
      ) : (
        <>
          {actionButtons}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowReadonlyDetails((open) => !open)}
              aria-expanded={showReadonlyDetails}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>查看管理员下发的技术参数（只读）</span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 transition-transform',
                  showReadonlyDetails && 'rotate-180',
                )}
              />
            </button>
            {showReadonlyDetails && (
              <div className="flex flex-col gap-4 border-t border-border p-4">
                {teamTechnicalFields}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
