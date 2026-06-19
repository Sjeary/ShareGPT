import { NAV, type NavKey } from '@/lib/nav'
import { PanelScaffold } from './PanelScaffold'

// 占位面板: 用于尚未重建的功能(gpt/gemini/stats/logs)。团队迁移后逐个替换。
export function ComingSoonPanel({ navKey }: { navKey: NavKey }) {
  const item = NAV.find((n) => n.key === navKey)!
  const Icon = item.icon
  return (
    <PanelScaffold icon={Icon} title={item.label} hint={item.hint}>
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
            <Icon className="size-6" />
          </div>
          <h2 className="text-lg font-semibold">{item.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            此面板将于后续迭代按 Telegram 式重建。
          </p>
        </div>
      </div>
    </PanelScaffold>
  )
}
