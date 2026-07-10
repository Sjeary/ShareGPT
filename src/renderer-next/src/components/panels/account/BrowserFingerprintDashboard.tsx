import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ClipboardCopy,
  FileJson,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAiStore, type AiKind } from '@/store/useAiStore'
import { useAppStore } from '@/store/useAppStore'
import type { BrowserFingerprintSnapshot } from '@/types/api'
import type { BrowserPrivacySettings } from '@/types/settings'

const PROVIDERS: Array<{ kind: AiKind; label: string }> = [
  { kind: 'gpt', label: 'ChatGPT' },
  { kind: 'claude', label: 'Claude' },
  { kind: 'gemini', label: 'Gemini' },
]

interface CompareRow {
  label: string
  left: string
  right: string
  status: 'same' | 'different' | 'missing'
}

function isFingerprintSnapshot(input: unknown): input is BrowserFingerprintSnapshot {
  if (!input || typeof input !== 'object') return false
  const snapshot = input as Partial<BrowserFingerprintSnapshot>
  const page = snapshot.page
  return Boolean(
    snapshot.schemaVersion === 1 &&
    PROVIDERS.some((provider) => provider.kind === snapshot.kind) &&
    typeof snapshot.capturedAt === 'string' &&
    page &&
    typeof page === 'object' &&
    page.locale &&
    Array.isArray(page.locale.languages) &&
    page.navigator &&
    typeof page.navigator.userAgent === 'string' &&
    page.screen &&
    page.graphics &&
    typeof page.graphics.canvasHash === 'string' &&
    page.audio &&
    page.fonts &&
    Array.isArray(page.fonts.available) &&
    page.media &&
    page.webRtc &&
    Array.isArray(page.webRtc.candidateTypes) &&
    snapshot.profile &&
    typeof snapshot.profile === 'object',
  )
}

function value(value: unknown, fallback = '不可用'): string {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '无'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }
  return String(value)
}

function shortHash(hash: unknown): string {
  const text = value(hash, '')
  return text ? `${text.slice(0, 12)}…` : '不可用'
}

function screenLabel(snapshot: BrowserFingerprintSnapshot): string {
  const screen = snapshot.page.screen
  return `${value(screen.width)} × ${value(screen.height)} @ ${value(screen.devicePixelRatio)}x`
}

function mediaLabel(snapshot: BrowserFingerprintSnapshot): string {
  const media = snapshot.page.media
  return `麦克风 ${media.audioInputs} / 扬声器 ${media.audioOutputs} / 摄像头 ${media.videoInputs}${media.labelsExposed ? '（标签可见）' : ''}`
}

function networkRiskLabel(snapshot: BrowserFingerprintSnapshot): string {
  if (snapshot.network?.error) return `检测失败：${snapshot.network.error}`
  const security = snapshot.network?.security
  if (!security) return '检测服务未返回风险标记'
  const flags = [
    security.proxy && 'Proxy',
    security.vpn && 'VPN',
    security.tor && 'Tor',
    security.hosting && 'Hosting',
  ].filter(Boolean)
  return flags.length ? flags.join(' / ') : '未标记 Proxy、VPN、Tor 或 Hosting'
}

function highEntropy(snapshot: BrowserFingerprintSnapshot): Record<string, unknown> {
  return snapshot.page.navigator.userAgentData?.highEntropy || {}
}

function compareSnapshots(
  left: BrowserFingerprintSnapshot,
  right: BrowserFingerprintSnapshot,
): CompareRow[] {
  const leftEntropy = highEntropy(left)
  const rightEntropy = highEntropy(right)
  const pairs: Array<[string, unknown, unknown]> = [
    ['出口 IP', left.network?.ip, right.network?.ip],
    ['ASN', left.network?.asn, right.network?.asn],
    ['国家', left.network?.countryCode, right.network?.countryCode],
    ['时区', left.page.locale.timezone, right.page.locale.timezone],
    ['语言', left.page.locale.languages, right.page.locale.languages],
    ['UA', left.page.navigator.userAgent, right.page.navigator.userAgent],
    [
      '操作系统平台',
      left.page.navigator.userAgentData?.platform || left.page.navigator.platform,
      right.page.navigator.userAgentData?.platform || right.page.navigator.platform,
    ],
    [
      '架构/位数',
      `${value(leftEntropy.architecture)} / ${value(leftEntropy.bitness)}`,
      `${value(rightEntropy.architecture)} / ${value(rightEntropy.bitness)}`,
    ],
    [
      'CPU 逻辑核心',
      left.page.navigator.hardwareConcurrency,
      right.page.navigator.hardwareConcurrency,
    ],
    ['内存档位', left.page.navigator.deviceMemory, right.page.navigator.deviceMemory],
    ['屏幕/DPR', screenLabel(left), screenLabel(right)],
    ['触控点', left.page.navigator.maxTouchPoints, right.page.navigator.maxTouchPoints],
    ['WebGL Vendor', left.page.graphics.webglVendor, right.page.graphics.webglVendor],
    ['WebGL Renderer', left.page.graphics.webglRenderer, right.page.graphics.webglRenderer],
    ['Canvas', shortHash(left.page.graphics.canvasHash), shortHash(right.page.graphics.canvasHash)],
    ['Audio', shortHash(left.page.audio.hash), shortHash(right.page.audio.hash)],
    ['字体集合', shortHash(left.page.fonts.hash), shortHash(right.page.fonts.hash)],
    ['媒体设备摘要', mediaLabel(left), mediaLabel(right)],
    ['浏览器摘要', shortHash(left.page.browserHash), shortHash(right.page.browserHash)],
  ]
  return pairs.map(([label, leftValue, rightValue]) => {
    const leftText = value(leftValue)
    const rightText = value(rightValue)
    const missing = [leftText, rightText].some((text) => text === '无' || text.includes('不可用'))
    return {
      label,
      left: leftText,
      right: rightText,
      status: missing ? 'missing' : leftText === rightText ? 'same' : 'different',
    }
  })
}

function formatTime(valueToFormat: string): string {
  const date = new Date(valueToFormat)
  return Number.isNaN(date.getTime()) ? valueToFormat : date.toLocaleString()
}

function hostLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform || '设备'
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-2 last:border-0 sm:grid-cols-[132px_minmax(0,1fr)]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-xs text-foreground">{children}</span>
    </div>
  )
}

function CompareTable({
  left,
  right,
  title,
  description,
  leftLabel,
  rightLabel,
}: {
  left: BrowserFingerprintSnapshot
  right: BrowserFingerprintSnapshot
  title: string
  description: string
  leftLabel: string
  rightLabel: string
}) {
  const rows = useMemo(() => compareSnapshots(left, right), [left, right])
  const sameCount = rows.filter((row) => row.status === 'same').length
  const differentCount = rows.filter((row) => row.status === 'different').length
  const missingCount = rows.filter((row) => row.status === 'missing').length
  const comparableCount = rows.length - missingCount
  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          一致 {sameCount}/{comparableCount} 个可比较项
        </p>
        <Badge variant={differentCount === 0 && missingCount === 0 ? 'default' : 'outline'}>
          {differentCount === 0 && missingCount === 0
            ? '完全一致'
            : `${differentCount} 项不同${missingCount ? ` · ${missingCount} 项缺失` : ''}`}
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <div className="grid min-w-[760px] grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_48px] gap-2 bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          <span>字段</span>
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
          <span>状态</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid min-w-[760px] grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_48px] gap-2 border-t border-border px-3 py-2 text-[11px]"
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="break-all">{row.left}</span>
            <span className="break-all">{row.right}</span>
            <span
              className={cn(
                row.status === 'same' && 'text-emerald-500',
                row.status === 'different' && 'text-amber-500',
                row.status === 'missing' && 'text-muted-foreground',
              )}
            >
              {row.status === 'same' ? '一致' : row.status === 'different' ? '不同' : '缺失'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BrowserFingerprintDashboard({ privacy }: { privacy: BrowserPrivacySettings }) {
  const [kind, setKind] = useState<AiKind>('gpt')
  const [capturing, setCapturing] = useState(false)
  const [peerSnapshot, setPeerSnapshot] = useState<BrowserFingerprintSnapshot | null>(null)
  const [peerJson, setPeerJson] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const activeTabId = useAiStore((state) => state.activeTabIdByKind[kind])
  const currentCandidate = privacy.audit.current[kind]
  const beforeCandidate = privacy.audit.beforeClear[kind]
  const current = isFingerprintSnapshot(currentCandidate) ? currentCandidate : null
  const before = isFingerprintSnapshot(beforeCandidate) ? beforeCandidate : null

  const consistencyWarnings = useMemo(() => {
    if (!current) return []
    const warnings: string[] = []
    if (current.network?.timezone && current.network.timezone !== current.page.locale.timezone) {
      warnings.push(
        `出口时区 ${current.network.timezone} 与网页时区 ${current.page.locale.timezone} 不一致`,
      )
    }
    if (current.network?.error) warnings.push(`出口信息检测失败：${current.network.error}`)
    const networkFlags = current.network?.security
      ? [
          current.network.security.proxy && 'Proxy',
          current.network.security.vpn && 'VPN',
          current.network.security.tor && 'Tor',
          current.network.security.hosting && 'Hosting',
        ].filter(Boolean)
      : []
    if (networkFlags.length) warnings.push(`出口检测服务标记：${networkFlags.join(' / ')}`)
    if (
      current.network?.countryCode === 'US' &&
      !current.page.locale.language.toLowerCase().startsWith('en')
    ) {
      warnings.push(`出口在美国，但网页首选语言为 ${current.page.locale.language || '不可用'}`)
    }
    if (!current.sessionProxied) warnings.push('当前网页会话没有确认使用 SOCKS 代理')
    if (current.webRtcPolicy !== 'disable_non_proxied_udp') warnings.push('WebRTC 防泄漏策略未生效')
    if (current.page.webRtc.localIpExposed) warnings.push('WebRTC 候选中出现了本地 IP')
    if (current.page.navigator.webdriver) warnings.push('网页可见 navigator.webdriver=true')
    if (current.profile.enabled) {
      const target = privacy.fingerprint
      const mismatches = [
        current.page.navigator.hardwareConcurrency !== target.hardwareConcurrency && 'CPU',
        current.page.navigator.deviceMemory !== target.deviceMemory && '内存',
        current.page.screen.width !== target.screenWidth && '屏幕宽度',
        current.page.screen.height !== target.screenHeight && '屏幕高度',
        current.page.screen.devicePixelRatio !== target.devicePixelRatio && 'DPR',
        current.page.navigator.maxTouchPoints !== target.maxTouchPoints && '触控',
      ].filter(Boolean)
      if (mismatches.length) warnings.push(`标准化目标未生效：${mismatches.join('、')}`)
      if (current.profile.preset === 'us-windows') {
        const platform =
          current.page.navigator.userAgentData?.platform || current.page.navigator.platform
        const entropy = highEntropy(current)
        const windowsMismatches = [
          !/^win/i.test(platform) && '平台',
          entropy.architecture !== 'x86' && '架构',
          entropy.bitness !== '64' && '位数',
          current.page.media.audioInputs +
            current.page.media.audioOutputs +
            current.page.media.videoInputs !==
            0 && '媒体设备',
        ].filter(Boolean)
        if (windowsMismatches.length) {
          warnings.push(`美国 Windows 预设未完全生效：${windowsMismatches.join('、')}`)
        }
      }
    }
    return warnings
  }, [current, privacy.fingerprint])

  async function capture(): Promise<void> {
    if (capturing) return
    setCapturing(true)
    try {
      await api.captureBrowserFingerprint(kind, activeTabId || undefined)
      await useAppStore.getState().reloadSettings()
      toast.success(`${PROVIDERS.find((item) => item.kind === kind)?.label} 可见信息已刷新`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '网页可见信息采集失败')
    } finally {
      setCapturing(false)
    }
  }

  async function copySnapshot(): Promise<void> {
    if (!current) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(current, null, 2))
      toast.success('当前快照已复制，可粘贴到另一台设备对比')
    } catch {
      toast.error('复制快照失败')
    }
  }

  function importPeer(): void {
    try {
      if (peerJson.length > 200_000) throw new Error('快照超过 200 KB 限制')
      const parsed = JSON.parse(peerJson) as unknown
      if (!isFingerprintSnapshot(parsed)) {
        throw new Error('快照格式不正确')
      }
      setPeerSnapshot(parsed)
      setImportOpen(false)
      toast.success(`已导入 ${hostLabel(parsed.hostPlatform)} 的快照`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '快照解析失败')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4" />
            网页可见信息表盘
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {PROVIDERS.map((provider) => (
              <Button
                key={provider.kind}
                size="sm"
                variant={kind === provider.kind ? 'default' : 'outline'}
                onClick={() => {
                  setKind(provider.kind)
                  setPeerSnapshot(null)
                  setPeerJson('')
                }}
              >
                {provider.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">
              {current ? `上次采集：${formatTime(current.capturedAt)}` : '尚未采集'}
            </p>
            <p className="text-xs text-muted-foreground">
              数据直接从当前内嵌网页读取；未保存设备 ID、Canvas 原图或音频样本。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void capture()} disabled={capturing}>
              {capturing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {capturing ? '采集中…' : '刷新当前页面'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => void copySnapshot()}
            >
              <ClipboardCopy /> 导出快照
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen((open) => !open)}>
              <FileJson /> 导入对端
            </Button>
          </div>
        </div>

        {importOpen && (
          <div className="grid gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">粘贴另一台 Mac / Windows 导出的快照</p>
            <textarea
              value={peerJson}
              onChange={(event) => setPeerJson(event.target.value)}
              className="min-h-32 rounded-md border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="粘贴 JSON 快照"
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={!peerJson.trim()} onClick={importPeer}>
                开始对比
              </Button>
            </div>
          </div>
        )}

        {!current ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            请先从侧栏打开 {PROVIDERS.find((item) => item.kind === kind)?.label}{' '}
            网页，然后点击“刷新当前页面”。
          </div>
        ) : (
          <>
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                consistencyWarnings.length
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              )}
            >
              {consistencyWarnings.length ? (
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  {consistencyWarnings.length ? '发现环境矛盾' : '未发现明显环境矛盾'}
                </p>
                {consistencyWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-sm font-medium">网络与环境</p>
                <InfoRow label="出口 IP">{value(current.network?.ip)}</InfoRow>
                <InfoRow label="ASN / 运营商">
                  {value(
                    [current.network?.asn, current.network?.organization || current.network?.isp]
                      .filter(Boolean)
                      .join(' · '),
                  )}
                </InfoRow>
                <InfoRow label="国家 / 地区">
                  {value(
                    [current.network?.countryCode, current.network?.region, current.network?.city]
                      .filter(Boolean)
                      .join(' · '),
                  )}
                </InfoRow>
                <InfoRow label="网页时区">{value(current.page.locale.timezone)}</InfoRow>
                <InfoRow label="语言">{value(current.page.locale.languages)}</InfoRow>
                <InfoRow label="WebRTC">
                  {current.webRtcPolicy} · 候选{' '}
                  {current.page.webRtc.candidateTypes.length
                    ? current.page.webRtc.candidateTypes.join(', ')
                    : '无'}{' '}
                  · 本地 IP {current.page.webRtc.localIpExposed ? '已暴露' : '未发现'}
                </InfoRow>
                <InfoRow label="会话代理">{value(current.sessionProxy)}</InfoRow>
                <InfoRow label="出口风险标记">{networkRiskLabel(current)}</InfoRow>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-sm font-medium">浏览器与硬件</p>
                <InfoRow label="UA">{current.page.navigator.userAgent}</InfoRow>
                <InfoRow label="Client Hints">
                  {value(current.page.navigator.userAgentData?.highEntropy)}
                </InfoRow>
                <InfoRow label="平台">
                  {value(
                    current.page.navigator.userAgentData?.platform ||
                      current.page.navigator.platform,
                  )}
                </InfoRow>
                <InfoRow label="CPU / 内存">
                  {value(current.page.navigator.hardwareConcurrency)} 核 ·{' '}
                  {value(current.page.navigator.deviceMemory)} GB
                </InfoRow>
                <InfoRow label="屏幕 / DPR">{screenLabel(current)}</InfoRow>
                <InfoRow label="触控点">{value(current.page.navigator.maxTouchPoints)}</InfoRow>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-sm font-medium">图形、音频与字体</p>
                <InfoRow label="WebGL Vendor">{value(current.page.graphics.webglVendor)}</InfoRow>
                <InfoRow label="GPU Renderer">{value(current.page.graphics.webglRenderer)}</InfoRow>
                <InfoRow label="Canvas">{shortHash(current.page.graphics.canvasHash)}</InfoRow>
                <InfoRow label="Audio">{shortHash(current.page.audio.hash)}</InfoRow>
                <InfoRow label="字体摘要">
                  {current.page.fonts.count} 种 · {shortHash(current.page.fonts.hash)}
                </InfoRow>
                <InfoRow label="检测到的字体">{value(current.page.fonts.available)}</InfoRow>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-sm font-medium">媒体与资料环境</p>
                <InfoRow label="媒体设备">{mediaLabel(current)}</InfoRow>
                <InfoRow label="标准化">
                  {current.profile.enabled ? `已启用 · ${current.profile.preset}` : '未启用'}
                </InfoRow>
                <InfoRow label="本机资料 ID">{current.profile.localIdHash}</InfoRow>
                <InfoRow label="资料重建">
                  {current.profile.rebuiltAt ? formatTime(current.profile.rebuiltAt) : '从未重建'}
                </InfoRow>
                <InfoRow label="浏览器摘要">{shortHash(current.page.browserHash)}</InfoRow>
                <InfoRow label="完整快照摘要">{shortHash(current.digest)}</InfoRow>
              </div>
            </div>

            {before && (
              <CompareTable
                left={before}
                right={current}
                title="清除前后指纹对比"
                description="清除或重建资料环境前会自动保留一份摘要，用于确认哪些网页可见信息发生了变化。"
                leftLabel="清除前"
                rightLabel="当前/清除后"
              />
            )}
            {!before && (
              <div className="rounded-md border border-dashed border-border p-3">
                <p className="text-sm font-medium">清除前后指纹对比</p>
                <p className="text-xs text-muted-foreground">
                  尚无“清除前”快照。下次执行清除或重建资料环境时会自动保留，重新打开网页并刷新表盘后即可对比。
                </p>
              </div>
            )}
            {peerSnapshot && (
              <CompareTable
                left={current}
                right={peerSnapshot}
                title="Mac 与 Windows 同配置一致性"
                description="比较两台设备在同一同步配置下仍然存在的系统、硬件和图形差异。"
                leftLabel={hostLabel(current.hostPlatform)}
                rightLabel={hostLabel(peerSnapshot.hostPlatform)}
              />
            )}
            {!peerSnapshot && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
                <div>
                  <p className="text-sm font-medium">Mac 与 Windows 同配置一致性</p>
                  <p className="text-xs text-muted-foreground">
                    在另一台设备刷新同一服务的表盘并“导出快照”，回到这里“导入对端”即可逐项比较 19
                    个字段。
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  <FileJson /> 导入对端快照
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
