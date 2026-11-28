import type { AiKind } from '../../../store/useAiStore.ts'
import type { SenderSettings } from '../../../types/settings.ts'

export type AiOverlayReason =
  | 'no-environment'
  | 'no-route'
  | 'proxy-stopped'
  | 'route-inactive'
  | 'no-tab'
  | 'initializing'

export interface AiOverlayState {
  reason: AiOverlayReason
  title: string
  text: string
}

export interface NoAiRoutesGuidance {
  title: string
  reason: string
  nextStep: string
  canOpenAdmin: boolean
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function hasConfiguredUnifiedProxy(sender: Partial<SenderSettings>): boolean {
  const port = Number(sender.proxy_port)
  return Boolean(
    text(sender.proxy_server) &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    text(sender.proxy_uuid),
  )
}

function hasAnyConfiguredCandidateRoute(sender: Partial<SenderSettings>): boolean {
  if (hasConfiguredUnifiedProxy(sender)) return true
  if (sender.airport_outbound && typeof sender.airport_outbound === 'object') return true
  const managed = Array.isArray(sender.managed_proxy_routes) ? sender.managed_proxy_routes : []
  return managed.some((route) => route && route.enabled !== false && Boolean(text(route.id)))
}

export function describeNoAiRoutesGuidance(
  sender: Partial<SenderSettings> | undefined,
  isAdmin: boolean,
): NoAiRoutesGuidance {
  const safeSender = sender ?? {}
  const hasAuthorizationList = Array.isArray(safeSender.authorized_proxy_route_ids)
  const hasCandidate = hasAnyConfiguredCandidateRoute(safeSender)

  if (
    hasAuthorizationList &&
    (safeSender.authorized_proxy_route_ids?.length === 0 || hasCandidate)
  ) {
    return {
      title: '当前没有已授权的可用内置线路',
      reason:
        '高级 AI 独立环境必须绑定已授权的内置代理线路（不允许直连），当前账号暂未获得可用线路授权。',
      nextStep: isAdmin
        ? '请前往「管理后台 → AI 线路策略 / 团队统一代理」确认线路配置，并在「成员与权限」中为当前账号勾选授权线路，也可在「网络与代理」检查配置。'
        : '请联系团队管理员在「成员与权限」中为你授权代理线路，或前往「网络与代理」查看当前状态。',
      canOpenAdmin: isAdmin,
    }
  }

  return {
    title: '尚未配置可用的内置代理线路',
    reason:
      '高级 AI 独立环境必须绑定内置代理线路（不允许直连），当前尚未配置统一代理或独立内置节点。',
    nextStep: isAdmin
      ? '请先在「管理后台 → 团队统一代理 / AI 线路策略」或「网络与代理」完成代理线路配置，再回来新建环境。'
      : '请联系团队管理员配置并下发内置代理线路，或前往「网络与代理」查看当前状态。',
    canOpenAdmin: isAdmin,
  }
}

export function resolveAiOverlay(
  kind: AiKind,
  args: {
    networkReady: boolean
    senderRunning: boolean
    advancedMode: boolean
    hasEnvironment: boolean
    hasRoute: boolean
    availableRoutesCount: number
    routeLabel: string
    hasTab: boolean
    initialized: boolean
    proxyHost: string
    proxyPort: string
  },
): AiOverlayState | null {
  const {
    networkReady,
    senderRunning,
    advancedMode,
    hasEnvironment,
    hasRoute,
    availableRoutesCount,
    routeLabel,
    hasTab,
    initialized,
    proxyHost,
    proxyPort,
  } = args
  const label = kind === 'gpt' ? 'ChatGPT' : kind === 'claude' ? 'Claude' : 'Gemini'

  if (!hasEnvironment) {
    return {
      reason: 'no-environment',
      title: `新建 ${label} 环境`,
      text:
        availableRoutesCount > 0
          ? `为 ${label} 创建一个独立登录环境并绑定内置代理线路，即可开始使用。`
          : `高级 AI 需要为 ${label} 创建独立登录环境并绑定已授权的内置代理线路；当前尚无可用线路，可先打开环境面板查看配置步骤。`,
    }
  }

  if (!hasRoute) {
    return {
      reason: 'no-route',
      title: '没有可用的内置线路',
      text:
        availableRoutesCount > 0
          ? '当前环境原绑定的线路已停用或未获授权，不允许直连。请打开环境管理切换到已授权的内置线路。'
          : '当前没有已授权的可用内置代理线路，不允许直连。请先完成代理线路配置或联系管理员授权后再试。',
    }
  }

  if (!networkReady) {
    if (senderRunning) {
      return {
        reason: 'route-inactive',
        title: '当前线路尚未就绪',
        text: `${routeLabel} 尚未在当前运行的内置代理中生效，请重新应用代理线路或前往「网络与代理」检查。`,
      }
    }
    return {
      reason: 'proxy-stopped',
      title: '当前线路尚未就绪',
      text: advancedMode
        ? `${routeLabel} 由 ShareGPT 内置 sing-box 提供，请先在「网络与代理」中开启代理。`
        : `${routeLabel} 使用 ${proxyHost}:${proxyPort}。请先启动对应的本机代理。`,
    }
  }

  if (!hasTab) {
    return {
      reason: 'no-tab',
      title: '当前没有打开的网页标签',
      text: `请点击上方的 + 按钮，新建一个 ${label} 标签页。`,
    }
  }

  if (!initialized) {
    if (kind === 'gemini') {
      return {
        reason: 'initializing',
        title: '准备打开 Gemini',
        text: '正在初始化内置页面并连接本地代理。Google 登录可能会跳转到账号验证页面。',
      }
    }
    return {
      reason: 'initializing',
      title: `准备打开 ${label}`,
      text: '正在初始化内置页面并连接本地代理。第一次进入可能稍慢。',
    }
  }

  return null
}
