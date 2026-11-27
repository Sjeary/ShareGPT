import { useAppStore } from '@/store/useAppStore'
import { PersonalAccountView } from './PersonalAccountView'
import { WorkspaceEntryFlow } from './WorkspaceEntryFlow'

// 工作区入口与个人模式账户视图的统一分发器：
// - 未进入工作区时呈现全屏桌面入口舞台（WorkspaceEntryFlow）
// - 个人工作区内呈现与团队设置中心同源的「账户与设置」（PersonalAccountView）
export function LoginForm() {
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  return workspaceMode === 'personal' ? <PersonalAccountView /> : <WorkspaceEntryFlow />
}
