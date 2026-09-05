import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerX: number; scrollLeft: number } | null>(null)
  const [scrollbar, setScrollbar] = useState({ visible: false, left: 0, width: 100 })

  const updateScrollbar = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scrollRange = viewport.scrollWidth - viewport.clientWidth
    const proportionalWidth = (viewport.clientWidth / viewport.scrollWidth) * 100 || 100
    const minimumWidth = viewport.clientWidth > 0 ? (24 / viewport.clientWidth) * 100 : 100
    const width = Math.min(100, Math.max(minimumWidth, proportionalWidth))
    const left = scrollRange > 0 ? (viewport.scrollLeft / scrollRange) * (100 - width) : 0
    setScrollbar({ visible: scrollRange > 1, left, width })
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(updateScrollbar)
    observer.observe(viewport)
    for (const child of viewport.children) observer.observe(child)
    updateScrollbar()
    return () => observer.disconnect()
  }, [tabs, updateScrollbar])

  return (
    <div className="ai-tab-scrollbar group relative min-w-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={updateScrollbar}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
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
      <div
        aria-hidden="true"
        className={cn('ai-tab-scrollbar-track', scrollbar.visible && 'is-visible')}
      >
        <div
          className="ai-tab-scrollbar-thumb"
          style={{ left: `${scrollbar.left}%`, width: `${scrollbar.width}%` }}
          onPointerDown={(event) => {
            const viewport = viewportRef.current
            if (!viewport) return
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { pointerX: event.clientX, scrollLeft: viewport.scrollLeft }
          }}
          onPointerMove={(event) => {
            const viewport = viewportRef.current
            const drag = dragRef.current
            if (!viewport || !drag || !event.currentTarget.hasPointerCapture(event.pointerId))
              return
            const scrollRange = viewport.scrollWidth - viewport.clientWidth
            const thumbWidth = (scrollbar.width / 100) * viewport.clientWidth
            const trackRange = viewport.clientWidth - thumbWidth
            if (trackRange > 0) {
              viewport.scrollLeft =
                drag.scrollLeft + ((event.clientX - drag.pointerX) / trackRange) * scrollRange
            }
          }}
          onPointerUp={(event) => {
            dragRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
        />
      </div>
    </div>
  )
}
