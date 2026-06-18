import {
  LayoutDashboard,
  Users,
  Cable,
  Rocket,
  Braces,
  MessageSquareText,
  ShieldAlert,
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
  { key: 'users', label: '用户管理', icon: Users, hint: '查看 / 新增 / 编辑用户' },
  { key: 'bootstrap', label: 'Sender 配置', icon: Cable, hint: '首登下发默认配置' },
  { key: 'releases', label: '版本发布', icon: Rocket, hint: '上传安装包与说明' },
  { key: 'feedback', label: '反馈建议', icon: MessageSquareText, hint: '用户提交的反馈' },
  { key: 'proxy-missing', label: '漏走代理域名', icon: ShieldAlert, hint: '客户端上报的待补域名' },
  { key: 'extras', label: '备用配置', icon: Braces, hint: 'client_bootstrap.extra' },
]
