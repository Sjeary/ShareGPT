import { useState } from 'react'
import { Building2, Laptop, Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/useAppStore'
import { api } from '@/lib/api'

export function WorkspaceBar() {
  const workspaceMode = useAppStore((state) => state.workspaceMode)
  const setWorkspaceMode = useAppStore((state) => state.setWorkspaceMode)
  const [switching, setSwitching] = useState(false)

  async function openOrganizationLogin() {
    if (switching) return
    setSwitching(true)
    try {
      await api.stopSender()
      setWorkspaceMode('chooser')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '停止个人代理失败')
    } finally {
      setSwitching(false)
    }
  }

  if (workspaceMode !== 'personal') return null

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-muted/35 px-3 py-1.5 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground/80">
        <Laptop className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">个人工作区 · 配置、AI 登录状态和翻译凭据仅保存在本机</span>
      </span>
      <button
        type="button"
        onClick={() => void openOrganizationLogin()}
        disabled={switching}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground transition hover:opacity-90"
      >
        {switching ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
        登录组织工作区
        <Building2 className="size-3" />
      </button>
    </div>
  )
}
