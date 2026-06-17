import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GptTab } from '@/store/useAiStore'

// Telegram 式标签条: 标签 + 关闭按钮 + 新建按钮 (对齐旧 renderGptTabs)。
export function GptTabBar({
  tabs,
  activeTabId,
  disabled,
  onSwitch,
  onClose,
  onCreate,
}: {
  tabs: GptTab[]
  activeTabId: string
  disabled: boolean
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onCreate: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors',
              active
                ? 'border-border bg-card text-foreground'
                : 'border-transparent bg-transparent text-muted-foreground hover:bg-card/60',
            )}
          >
            <button
              type="button"
              title={tab.title}
              onClick={() => onSwitch(tab.id)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {tab.title}
              {tab.webviewLoading && <span className="ml-1 opacity-60">…</span>}
            </button>
            <button
              type="button"
              aria-label={`关闭 ${tab.title}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onClose(tab.id)
              }}
              className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label="新建标签页"
        title="新建标签页"
        disabled={disabled}
        onClick={onCreate}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
