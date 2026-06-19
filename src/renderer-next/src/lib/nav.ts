import {
  Cable,
  MessageCircle,
  Bot,
  Sparkles,
  Asterisk,
  BarChart3,
  UserRound,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

export type NavKey = 'service' | 'chat' | 'gpt' | 'gemini' | 'claude' | 'stats' | 'account' | 'logs'

export interface NavItem {
  key: NavKey
  label: string
  icon: LucideIcon
  hint: string
}

export const NAV: NavItem[] = [
  { key: 'service', label: '代理转发', icon: Cable, hint: '转发指定流量到接收端' },
  { key: 'chat', label: '协作聊天', icon: MessageCircle, hint: '团队消息与文件' },
  { key: 'gpt', label: 'ChatGPT', icon: Bot, hint: '内嵌 ChatGPT 网页' },
  { key: 'gemini', label: 'Gemini', icon: Sparkles, hint: '内嵌 Gemini 网页' },
  { key: 'claude', label: 'Claude', icon: Asterisk, hint: '内嵌 Claude 网页' },
  { key: 'stats', label: '使用统计', icon: BarChart3, hint: '查询量与排行' },
  { key: 'account', label: '账户', icon: UserRound, hint: '登录与协作服务' },
  { key: 'logs', label: '运行日志', icon: ScrollText, hint: '服务输出日志' },
]
