import { Eye, LogIn } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

// 预览态顶部提示条: 未登录点了"先逛逛"进入主界面时显示, 提醒当前为只读预览,
// 点"去登录"清掉预览态(setPreviewMode(false)) -> App 门退回登录页。已登录时不渲染。
export function PreviewBar() {
  const previewMode = useAppStore((s) => s.previewMode)
  const authed = useAppStore((s) => s.authed)
  const setPreviewMode = useAppStore((s) => s.setPreviewMode)

  if (!previewMode || authed) return null

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-b border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
      <span className="flex items-center gap-1.5 text-foreground/80">
        <Eye className="size-3.5 text-primary" />
        预览模式 · 登录后才能使用协作聊天、统计与代理同步
      </span>
      <button
        type="button"
        onClick={() => setPreviewMode(false)}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground transition hover:opacity-90"
      >
        <LogIn className="size-3" />
        去登录
      </button>
    </div>
  )
}
