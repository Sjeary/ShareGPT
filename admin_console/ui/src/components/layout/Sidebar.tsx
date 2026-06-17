import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV } from '@/lib/nav'
import { useAdminStore } from '@/store/useAdminStore'

export function Sidebar() {
  const active = useAdminStore((s) => s.activeTab)
  const setActive = useAdminStore((s) => s.setActiveTab)
  const logout = useAdminStore((s) => s.logout)

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2">
      {NAV.map(({ key, label, icon: Icon, hint }) => {
        const on = key === active
        return (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={cn(
              'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              on
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
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

      <button
        onClick={() => void logout()}
        className={cn(
          'mt-auto flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sidebar-foreground transition-colors hover:bg-destructive/10 hover:text-destructive',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-muted-foreground">
          <LogOut className="size-[18px]" />
        </span>
        <span className="text-sm font-medium">退出登录</span>
      </button>
    </aside>
  )
}
