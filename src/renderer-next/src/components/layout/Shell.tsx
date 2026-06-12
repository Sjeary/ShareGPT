import { useEffect } from 'react'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import {
  privateConversationKey,
  useChatStore,
} from '@/store/useChatStore'
import { useLogStream } from '@/components/panels/logs/useLogStream'
import { ServicePanel } from '@/components/panels/ServicePanel'
import { ChatPanel } from '@/components/panels/ChatPanel'
import { AccountPanel } from '@/components/panels/AccountPanel'
import { GptPanel } from '@/components/panels/GptPanel'
import { GeminiPanel } from '@/components/panels/GeminiPanel'
import { StatsPanel } from '@/components/panels/StatsPanel'
import { LogsPanel } from '@/components/panels/LogsPanel'
import { SetupGuide } from '@/components/SetupGuide'
import { Toaster } from '@/components/ui/sonner'

// 通知点击负载 (对齐旧 renderer.js openConversationFromNotification ~1906)。
interface NotificationRoute {
  type?: string
  scope?: string
  targetUsername?: string
  from?: string
  messageId?: string
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// 滚动并高亮到指定消息 (旧 focusMessageById ~4871 等价)。
// 消息行的 data-message-id / 高亮样式由 chat 域提供; 此处仅做应用级触发,
// 在 chat 域尚未挂该属性前为安全空操作, 不跨域改文件。
function focusMessageById(messageId: string): void {
  const id = safeText(messageId)
  if (!id) return
  const row = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(id)}"]`,
  )
  if (!row) return
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  row.classList.add('chat-item-targeted')
  window.setTimeout(() => row.classList.remove('chat-item-targeted'), 1600)
}

export function Shell() {
  const active = useAppStore((s) => s.active)
  const dark = useAppStore((s) => s.dark)
  const setActive = useAppStore((s) => s.setActive)
  const aiImmersive = useAppStore((s) => s.aiImmersive)

  // [MEDIUM] 全局日志订阅: 应用级单次挂载 (登录后 Shell 常驻),
  // 启动即采集, 早期/后台日志不因 LogsPanel 未挂载而丢失。订阅实现见 logs 域 useLogStream。
  useLogStream()

  // [MEDIUM] 系统通知点击 -> 路由到对应会话。
  // type==='notification-click' 时切到协作聊天, 选中私聊/房间, 约 120ms 后滚动并高亮目标消息。
  useEffect(() => {
    const unsubscribe = api.onAppEvent((payload: unknown) => {
      const route = (payload ?? {}) as NotificationRoute
      if (safeText(route.type) !== 'notification-click') return

      const scope = safeText(route.scope) === 'private' ? 'private' : 'subnet'
      const targetUsername = safeText(route.targetUsername || route.from)
      const messageId = safeText(route.messageId)

      setActive('chat')
      // 私聊: 选中对应联系人会话; 房间(子网广播): activeKey='' 即默认房间。
      const { setActiveKey } = useChatStore.getState()
      if (scope === 'private' && targetUsername) {
        setActiveKey(privateConversationKey(targetUsername))
      } else {
        setActiveKey('')
      }

      if (messageId) {
        window.setTimeout(() => focusMessageById(messageId), 120)
      }
    })
    return unsubscribe
  }, [setActive])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        {!aiImmersive && <Sidebar />}
        {active === 'service' && <ServicePanel />}
        {active === 'account' && <AccountPanel />}
        {active === 'gpt' && <GptPanel />}
        {active === 'gemini' && <GeminiPanel />}
        {active === 'stats' && <StatsPanel />}
        {active === 'logs' && <LogsPanel />}
        {/* 聊天面板常驻挂载(非激活时 display:none), 使协作 WS 在登录后全局常连,
            通知/在线状态随处生效, 而非仅在聊天页打开时。 */}
        <div className={active === 'chat' ? 'contents' : 'hidden'}>
          <ChatPanel />
        </div>
      </div>
      <SetupGuide />
      <Toaster position="bottom-right" theme={dark ? 'dark' : 'light'} richColors />
    </div>
  )
}
