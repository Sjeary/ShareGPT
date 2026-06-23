import {
  Cable,
  MessageCircle,
  Bot,
  Sparkles,
  Asterisk,
  BarChart3,
  UserRound,
  ScrollText,
  CalendarDays,
  Users,
  ListTodo,
  BookText,
  type LucideIcon,
} from 'lucide-react'

export type NavKey =
  | 'service'
  | 'chat'
  | 'calendar'
  | 'team'
  | 'todo'
  | 'notes'
  | 'gpt'
  | 'gemini'
  | 'claude'
  | 'stats'
  | 'account'
  | 'logs'

export interface NavItem {
  key: NavKey
  label: string
  icon: LucideIcon
  hint: string
}

export const NAV: NavItem[] = [
  { key: 'service', label: '网络 / 代理', icon: Cable, hint: '把指定流量转发到代理出口' },
  { key: 'chat', label: '协作聊天', icon: MessageCircle, hint: '团队消息与文件' },
  { key: 'calendar', label: '个人日历', icon: CalendarDays, hint: '日程、事件与提醒' },
  { key: 'team', label: '组队日历', icon: Users, hint: '团队共享日程与协作' },
  { key: 'todo', label: '备忘录 / 待办', icon: ListTodo, hint: '清单、任务与便签' },
  { key: 'notes', label: '笔记 / 知识库', icon: BookText, hint: '双链笔记、图谱与全文检索' },
  { key: 'gpt', label: 'ChatGPT', icon: Bot, hint: '内嵌 ChatGPT 网页' },
  { key: 'gemini', label: 'Gemini', icon: Sparkles, hint: '内嵌 Gemini 网页' },
  { key: 'claude', label: 'Claude', icon: Asterisk, hint: '内嵌 Claude 网页' },
  { key: 'stats', label: '使用统计', icon: BarChart3, hint: '查询量与排行' },
  { key: 'account', label: '账户', icon: UserRound, hint: '登录与协作服务' },
  { key: 'logs', label: '运行日志', icon: ScrollText, hint: '服务输出日志' },
]
