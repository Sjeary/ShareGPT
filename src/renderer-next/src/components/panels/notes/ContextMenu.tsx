import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onClick?: () => void
  danger?: boolean
  sep?: boolean // 在此项之前画分隔线
  disabled?: boolean
}

// 通用右键菜单: 跟随光标定位、自动避开视口边缘、点击外部/Esc/滚动关闭。
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8)
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ left, top })
  }, [x, y, items])

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onScroll = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className="fixed min-w-44 overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm shadow-xl animate-in fade-in zoom-in-95 duration-100"
      >
        {items.map((it, i) => (
          <div key={i}>
            {it.sep && <div className="my-1 h-px bg-border" />}
            <button
              type="button"
              disabled={it.disabled}
              onClick={() => {
                onClose()
                it.onClick?.()
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors disabled:opacity-40',
                it.danger
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {it.icon && <it.icon className="size-4 shrink-0 opacity-80" />}
              <span className="truncate">{it.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
