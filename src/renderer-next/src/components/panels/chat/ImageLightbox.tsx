import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// 聊天图片灯箱 (移植自旧 renderer.js openChatImageLightbox ~4975 + 缩放/拖拽/滚轮/Esc 逻辑)。
// 滚轮缩放 0.4~4, 拖拽平移 (仅放大时), Esc / 点击遮罩关闭。

const ZOOM_MIN = 0.4
const ZOOM_MAX = 4
const ZOOM_STEP = 0.2

export interface LightboxTarget {
  dataUrl: string
  alt: string
}

// 内层视图: 每次换图随 key 重挂载, 缩放/平移状态自然归零 (避免 effect 内 setState)。
function LightboxView({ target }: { target: LightboxTarget }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const applyZoom = useCallback((delta: number) => {
    setZoom((prev) => {
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, Number((prev + delta).toFixed(2))),
      )
      if (next <= 1) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  const draggable = zoom > 1

  return (
    <div
      className={cn(
        'flex max-h-full max-w-full items-center justify-center overflow-hidden',
        draggable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-auto',
      )}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => {
        e.preventDefault()
        applyZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
      }}
      onPointerDown={(e) => {
        if (zoom <= 1) return
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: pan.x,
          originY: pan.y,
        }
        setDragging(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = dragRef.current
        if (!d || d.pointerId !== e.pointerId) return
        setPan({
          x: d.originX + (e.clientX - d.startX),
          y: d.originY + (e.clientY - d.startY),
        })
      }}
      onPointerUp={(e) => {
        const d = dragRef.current
        if (d && d.pointerId === e.pointerId) {
          try {
            ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
          } catch {
            /* ignore */
          }
        }
        dragRef.current = null
        setDragging(false)
      }}
    >
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
        {Math.round(zoom * 100)}%
      </div>
      <img
        src={target.dataUrl}
        alt={target.alt || '聊天图片'}
        draggable={false}
        className="max-h-[88vh] max-w-[88vw] select-none object-contain"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        }}
      />
    </div>
  )
}

export function ImageLightbox({
  target,
  onClose,
}: {
  target: LightboxTarget | null
  onClose: () => void
}) {
  // Esc 关闭。
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [target, onClose])

  if (!target) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-5" />
      </button>

      <LightboxView key={target.dataUrl} target={target} />
    </div>,
    document.body,
  )
}
