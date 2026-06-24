import { useEffect } from 'react'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { PreviewBar } from './PreviewBar'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { privateConversationKey, useChatStore } from '@/store/useChatStore'
import { useLogStream } from '@/components/panels/logs/useLogStream'
import { useCloudSync } from '@/hooks/useCloudSync'
import { ServicePanel } from '@/components/panels/ServicePanel'
import { ChatPanel } from '@/components/panels/ChatPanel'
import { AccountPanel } from '@/components/panels/AccountPanel'
import { GptPanel } from '@/components/panels/GptPanel'
import { GeminiPanel } from '@/components/panels/GeminiPanel'
import { ClaudePanel } from '@/components/panels/ClaudePanel'
import { StatsPanel } from '@/components/panels/StatsPanel'
import { LogsPanel } from '@/components/panels/LogsPanel'
import { CalendarPanel } from '@/components/panels/CalendarPanel'
import { TeamCalendarPanel } from '@/components/panels/TeamCalendarPanel'
import { TodoPanel } from '@/components/panels/TodoPanel'
import { NotesPanel } from '@/components/panels/NotesPanel'
import { FocusPanel } from '@/components/panels/FocusPanel'
import { useFocusTimer, useFocusSync } from '@/hooks/useFocusTimer'
import { SetupGuide } from '@/components/SetupGuide'
import { Onboarding } from '@/components/Onboarding'
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
  const row = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
  if (!row) return
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  row.classList.add('chat-item-targeted')
  window.setTimeout(() => row.classList.remove('chat-item-targeted'), 1600)
}

export function Shell() {
  const active = useAppStore((s) => s.active)
  const dark = useAppStore((s) => s.dark)
  const setActive = useAppStore((s) => s.setActive)
  const sidebarHidden = useAppStore((s) => s.sidebarHidden)
  const sidebarSide = useAppStore((s) => s.sidebarSide)
  // 隐藏侧栏仅在 GPT/Gemini 面板生效 (clean view); 其它面板始终显示, 避免把导航藏没。
  const hideSidebar =
    sidebarHidden && (active === 'gpt' || active === 'gemini' || active === 'claude')

  // [MEDIUM] 全局日志订阅: 应用级单次挂载 (登录后 Shell 常驻),
  // 启动即采集, 早期/后台日志不因 LogsPanel 未挂载而丢失。订阅实现见 logs 域 useLogStream。
  useLogStream()

  // 个人日历 / 待办备忘 云端同步 (多端实时 + 版本号防覆盖); 未登录或服务器不支持则静默本地。
  useCloudSync()

  // 番茄钟全局计时 (应用级单次挂载, 关面板也继续走, 阶段完成全局通知)。
  useFocusTimer()
  // 专注段完成上报协作服务器 (团队排名); 未登录/不支持则静默。
  useFocusSync()

  // 首次进入主界面自动开新手导览 (此前没完成/跳过过)。仅在 Shell 挂载时判一次,
  // 标题栏「?」可随时手动重开 (见 Titlebar / Onboarding)。
  const setTourOpen = useAppStore((s) => s.setTourOpen)
  useEffect(() => {
    const done = useAppStore.getState().settings?.ui?.onboarding_done
    if (!done) setTourOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <PreviewBar />
      <div
        className={
          'flex min-h-0 flex-1 ' + (sidebarSide === 'right' ? 'flex-row-reverse' : 'flex-row')
        }
      >
        <Sidebar hidden={hideSidebar} />
        {active === 'service' && <ServicePanel />}
        {active === 'calendar' && <CalendarPanel />}
        {active === 'team' && <TeamCalendarPanel />}
        {active === 'todo' && <TodoPanel />}
        {active === 'notes' && <NotesPanel />}
        {active === 'focus' && <FocusPanel />}
        {active === 'account' && <AccountPanel />}
        {active === 'gpt' && <GptPanel />}
        {active === 'gemini' && <GeminiPanel />}
        {active === 'claude' && <ClaudePanel />}
        {active === 'stats' && <StatsPanel />}
        {active === 'logs' && <LogsPanel />}
        {/* 聊天面板常驻挂载(非激活时 display:none), 使协作 WS 在登录后全局常连,
            通知/在线状态随处生效, 而非仅在聊天页打开时。 */}
        <div className={active === 'chat' ? 'contents' : 'hidden'}>
          <ChatPanel />
        </div>
      </div>
      <SetupGuide />
      <Onboarding />
      <Toaster position="bottom-right" theme={dark ? 'dark' : 'light'} richColors />
    </div>
  )
}
