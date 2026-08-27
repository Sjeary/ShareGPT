import type { AiKind } from '@/store/useAiStore'

// 主进程 onAiEvent 下发的事件载荷 (对齐 appFactory.js getAiStatePayload / emitAiEvent)。
// 字段都是可选, 渲染层按 type 取用; 不强约束以容忍主进程演进。
export interface AiEventPayload {
  kind?: AiKind | string
  type?: string
  tabId?: string
  title?: string
  url?: string
  loading?: boolean
  initialized?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  navigationGeneration?: number
  environmentId?: string
  environmentGeneration?: number
  principalId?: string
  principalGeneration?: number
  documentNonce?: string
  documentUrl?: string
  allowExternalBrowsing?: boolean
  // tabs-changed
  tabs?: AiTabPayload[]
  activeTabId?: string
  activeState?: AiEventPayload
  // did-fail-load
  errorDescription?: string
  errorCode?: string | number
  // console-message
  message?: string
  // translate-selection
  text?: string
  // confirm-non-target-send
  requestId?: string
  targetLanguage?: string
  // external-open-failed
  [k: string]: unknown
}

export interface AiTabPayload {
  id?: string
  tabId?: string
  title?: string
  url?: string
  loading?: boolean
  initialized?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  navigationGeneration?: number
  allowExternalBrowsing?: boolean
}

// ai:ensure / ai:sync-host 返回的单视图状态。
export interface AiStatePayload {
  kind?: string
  tabId?: string
  title?: string
  url?: string
  loading?: boolean
  initialized?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  navigationGeneration?: number
  allowExternalBrowsing?: boolean
}

export interface SyncHostBounds {
  x: number
  y: number
  width: number
  height: number
}
