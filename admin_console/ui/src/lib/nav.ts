import {
  LayoutDashboard,
  Users,
  Cable,
  Rocket,
  Braces,
  MessageSquareText,
  ShieldAlert,
  Network,
  Languages,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'
import type { AdminTab } from '@/types/admin'

export interface NavItem {
  key: AdminTab
  label: string
  icon: LucideIcon
  hint: string
}

export const NAV: NavItem[] = [
  { key: 'overview', label: '概览', icon: LayoutDashboard, hint: '全局状态一览' },
  { key: 'ai-usage', label: 'AI 使用统计', icon: BarChart3, hint: '成功发送次数与成员排行' },
  { key: 'airport', label: 'AI 线路策略', icon: Network, hint: '线路目录、默认出口与预检' },
  { key: 'translation', label: '翻译服务', icon: Languages, hint: '托管 API、授权与用量' },
  { key: 'users', label: '成员与权限', icon: Users, hint: '账号、功能与线路授权' },
  { key: 'bootstrap', label: '团队统一代理', icon: Cable, hint: '连接参数与代理域名' },
  { key: 'releases', label: '版本发布', icon: Rocket, hint: '上传安装包与说明' },
  { key: 'feedback', label: '反馈建议', icon: MessageSquareText, hint: '用户提交的反馈' },
  { key: 'proxy-missing', label: '漏走代理域名', icon: ShieldAlert, hint: '客户端上报的待补域名' },
  { key: 'extras', label: '高级配置', icon: Braces, hint: '备用扩展 JSON' },
]
