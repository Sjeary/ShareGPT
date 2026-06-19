import { api } from '@/lib/api'
import { toast } from 'sonner'

// 协作聊天通知助手 (移植自旧 renderer.js):
//  - showToast            ~2099  (弹窗提示) -> sonner toast
//  - playNotificationTone ~2126  (提示音, WebAudio 合成短促 triangle 音)
//  - showSystemNotification ~2152 (系统通知, 走主进程 api.showSystemNotification)
// 这些函数本身不读开关; 是否触发由调用方 (useChat) 依据 settings.collab.notify_* 决定。

export interface SystemNotificationRoute {
  scope?: string
  targetUsername?: string
  roomScope?: string
  messageId?: string
}

// 弹窗 toast (旧 showToast: 标题加粗 + 正文)。
export function showNotificationToast(title: string, message: string): void {
  const heading = (title || '').trim() || '提醒'
  const body = (message || '').trim()
  toast(heading, body ? { description: body } : undefined)
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
  route: SystemNotificationRoute = {},
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
