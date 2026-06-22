import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/useAppStore'
import type { CollabSettings, SenderSettings } from '@/types/settings'

function safe(v: unknown): string {
  return String(v ?? '').trim()
}

// 首次使用引导 (对齐旧 renderer.js shouldShowSetupGuide ~695 / buildSetupGuideItems ~701):
// sender 模式 + 未关闭 + (账号服务地址未填 或 发送端连接信息未补全) 时, 顶层覆盖引导卡。
export function SetupGuide() {
  const settings = useAppStore((s) => s.settings)
  const mode = useAppStore((s) => s.mode)
  const patchSection = useAppStore((s) => s.patchSection)
  const setActive = useAppStore((s) => s.setActive)
  // 新手导览进行中时不弹配置引导, 避免两个覆盖层叠在一起。
  const tourOpen = useAppStore((s) => s.tourOpen)
  const [hidden, setHidden] = useState(false)

  if (!settings || tourOpen) return null

  const collab = (settings.collab ?? {}) as Partial<CollabSettings>
  const sender = (settings.sender ?? {}) as Partial<SenderSettings>
  const dismissed = Boolean(settings.ui?.setup_guide_dismissed)
  const collabReady = Boolean(safe(collab.server_url))
  const senderReady = Boolean(
    safe(sender.proxy_server) && safe(sender.proxy_port) && safe(sender.proxy_uuid),
  )

  const shouldShow = !hidden && !dismissed && mode !== 'receiver' && (!collabReady || !senderReady)
  if (!shouldShow) return null

  const items: string[] = []
  if (!collabReady) items.push('先填写账号服务地址，后续才能登录、同步联系人和加载统计。')
  if (!senderReady) items.push('补全代理的服务器地址、连接端口和连接身份码，才能正常启动。')
  items.push('代理启动后，AI 页面都会复用当前 SOCKS5 代理。')

  const needsLogin = !collabReady

  function dismiss() {
    setHidden(true)
    void patchSection('ui', { setup_guide_dismissed: true })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-6 backdrop-blur-sm">
      <div className="relative w-[min(92%,30rem)] rounded-2xl border border-border bg-card p-6 shadow-xl">
        <button
          onClick={dismiss}
          aria-label="关闭引导"
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="mb-3 grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-5" />
        </div>
        <h2 className="text-lg font-semibold">
          {needsLogin ? '首次启动先完成基础配置' : '还差一步就可以开始使用'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">按下面几步快速完成设置：</p>
        <ul className="mt-4 space-y-2.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="text-muted-foreground">{it}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-2">
          <Button
            onClick={() => {
              setActive(needsLogin ? 'account' : 'service')
              dismiss()
            }}
          >
            {needsLogin ? '前往登录账户' : '前往网络 / 代理'}
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            知道了
          </Button>
        </div>
      </div>
    </div>
  )
}
