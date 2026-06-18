import { Titlebar } from './Titlebar'
import { DevReleasePanel } from '@/components/panels/DevReleasePanel'

// 开发者视角: 只做全局版本发布, 没有群管理(用户/Sender 配置属群管理员)。
export function DevShell() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <DevReleasePanel />
      </div>
    </div>
  )
}
