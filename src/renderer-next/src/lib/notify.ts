import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useChatStore } from '@/store/useChatStore'
import {
  resolveChatNotificationDestination,
  type ChatNotificationRoute,
} from '@/lib/chatNotificationRoute'
import { toast } from 'sonner'

// 协作聊天通知助手 (移植自旧 renderer.js):
//  - showToast            ~2099  (弹窗提示) -> sonner toast
//  - playNotificationTone ~2126  (提示音, WebAudio 合成短促 triangle 音)
//  - showSystemNotification ~2152 (系统通知, 走主进程 api.showSystemNotification)
// 这些函数本身不读开关; 是否触发由调用方 (useChat) 依据 settings.collab.notify_* 决定。

export function openChatNotificationRoute(route: ChatNotificationRoute = {}): void {
  const destination = resolveChatNotificationDestination(route)

  useAppStore.getState().setActive('chat')
  useChatStore.getState().setActiveKey(destination.activeKey)

  if (!destination.messageId) return
  window.setTimeout(() => {
    const escape = window.CSS?.escape ?? ((value: string) => value)
    const row = document.querySelector<HTMLElement>(
      `[data-message-id="${escape(destination.messageId)}"]`,
    )
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('chat-jump-target')
    window.setTimeout(() => row.classList.remove('chat-jump-target'), 1600)
  }, 120)
}

// 弹窗 toast (旧 showToast: 标题加粗 + 正文)。
// 仅「消息通知」放右上角并可手动关闭; 其它操作/状态提示仍走默认右下角 (见 Toaster)。
export function showNotificationToast(
  title: string,
  message: string,
  route?: ChatNotificationRoute,
): void {
  const heading = (title || '').trim() || '提醒'
  const body = (message || '').trim()
  toast(heading, {
    description: body || undefined,
    position: 'top-right',
    closeButton: true,
    action: route
      ? {
          label: '查看',
          onClick: () => openChatNotificationRoute(route),
        }
      : undefined,
  })
}

// 提示音 (旧 playNotificationTone): WebAudio 合成一声短促提示音。
export function playNotificationTone(): void {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const context = new Ctor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
    oscillator.onended = () => {
      void context.close().catch(() => undefined)
    }
  } catch {
    /* ignore: 浏览器策略可能阻止 AudioContext */
  }
}

// 系统通知 (旧 showSystemNotification): 交给主进程展示原生通知。
export async function showSystemNotification(
  title: string,
  message: string,
  route: ChatNotificationRoute = {},
): Promise<void> {
  try {
    const sender = (title || '').trim() || '新消息'
    const content = (message || '').trim()
    await api.showSystemNotification({
      title: 'ShareGPT',
      body: content ? `${sender}：${content}` : sender,
      route: route && typeof route === 'object' ? route : {},
    })
  } catch {
    /* 系统通知失败可忽略 */
  }
}
