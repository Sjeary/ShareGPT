import {
  Cable,
  MessageCircle,
  BarChart3,
  UserRound,
  ScrollText,
  CalendarDays,
  Users,
  ListTodo,
  BookText,
  Timer,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import { ChatGPTIcon, ClaudeIcon, GeminiIcon } from '@/components/icons/AiBrandIcons'

export type NavKey =
  | 'service'
  | 'chat'
  | 'calendar'
  | 'team'
  | 'todo'
  | 'notes'
  | 'focus'
  | 'gpt'
  | 'gemini'
  | 'claude'
  | 'stats'
  | 'account'
  | 'logs'
  | 'terminal'

export type NavGroup = 'ai' | 'collab' | 'system'

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  ai: 'AI 工作区',
  collab: '协作与效率',
  system: '系统与设置',
}

export interface NavItem {
  key: NavKey
  label: string
  icon: LucideIcon
  hint: string
  group: NavGroup
}

export const NAV: NavItem[] = [
  { key: 'gpt', label: 'ChatGPT', icon: ChatGPTIcon, hint: '内嵌 ChatGPT 网页', group: 'ai' },
  { key: 'claude', label: 'Claude', icon: ClaudeIcon, hint: '内嵌 Claude 网页', group: 'ai' },
  { key: 'gemini', label: 'Gemini', icon: GeminiIcon, hint: '内嵌 Gemini 网页', group: 'ai' },
  { key: 'chat', label: '协作聊天', icon: MessageCircle, hint: '团队消息与文件', group: 'collab' },
  {
    key: 'todo',
    label: '备忘录 / 待办',
    icon: ListTodo,
    hint: '清单、任务与便签',
    group: 'collab',
  },
  {
    key: 'calendar',
    label: '个人日历',
    icon: CalendarDays,
    hint: '日程、事件与提醒',
    group: 'collab',
  },
  { key: 'team', label: '组队日历', icon: Users, hint: '团队共享日程与协作', group: 'collab' },
  {
    key: 'notes',
    label: '笔记 / 知识库',
    icon: BookText,
    hint: '双链笔记、图谱与全文检索',
    group: 'collab',
  },
  { key: 'focus', label: '专注', icon: Timer, hint: '番茄钟、专注统计与团队排名', group: 'collab' },
  {
    key: 'service',
    label: '网络与代理',
    icon: Cable,
    hint: '管理 AI 网页代理出口',
    group: 'system',
  },
  { key: 'stats', label: '使用统计', icon: BarChart3, hint: '查询量与排行', group: 'system' },
  { key: 'terminal', label: '终端', icon: TerminalSquare, hint: '本机终端', group: 'system' },
  { key: 'logs', label: '运行日志', icon: ScrollText, hint: '服务输出日志', group: 'system' },
  {
    key: 'account',
    label: '账户与设置',
    icon: UserRound,
    hint: '账号、外观、隐私与更新',
    group: 'system',
  },
]
