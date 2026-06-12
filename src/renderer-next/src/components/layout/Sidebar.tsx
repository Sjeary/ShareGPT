import { cn } from '@/lib/utils'
import { NAV } from '@/lib/nav'
import { useAppStore } from '@/store/useAppStore'

export function Sidebar() {
  const active = useAppStore((s) => s.active)
  const setActive = useAppStore((s) => s.setActive)
  const meta = useAppStore((s) => s.meta)

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2">
      {NAV.map(({ key, label, icon: Icon, hint }) => {
        const on = key === active
        return (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
              on
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full transition',
                on
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-sidebar-accent text-muted-foreground group-hover:text-foreground',
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        )
      })}
      <div className="mt-auto rounded-lg bg-sidebar-accent/50 p-3 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">
          {(meta?.productName as string) || 'ShareGPT'}
        </div>
        <div>v{(meta?.version as string) || '4.2.x'} · 新界面</div>
      </div>
    </aside>
  )
}
