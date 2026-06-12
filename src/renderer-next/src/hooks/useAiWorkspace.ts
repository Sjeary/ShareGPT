import { useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import type { AiKind } from '@/store/useAiStore'

// 宿主定位 hook (对齐旧 renderer.js syncSingleAiHost / initAiHostObservers / scheduleAiHostsLayoutSync)。
//
// 渲染层只渲染一个占满内容区的"宿主 div", 把它的 getBoundingClientRect 通过
// api.syncAiViewHost({ kind, bounds, visible }) 同步给主进程, 由主进程把原生
// WebContentsView setBounds 到该矩形上。`visible` 为 false 时主进程隐藏/detach view。
//
// 使用方式:
//   const hostRef = useAiHostSync('gpt', visible)
//   <div ref={hostRef} className="..." />
// 其中 visible 表示"业务上是否应展示" (例如面板已激活且发送服务已运行)。
export function useAiHostSync(kind: AiKind, visible: boolean) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const queuedRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // 旧 syncSingleAiHost: 计算宿主矩形并上报。visible 由调用方传入 (业务可见性)。
  const syncNow = useCallback(() => {
    const host = hostRef.current
    if (!host || !api.syncAiViewHost) return

    if (!visible) {
      void api.syncAiViewHost({ kind, visible: false }).catch(() => undefined)
      return
    }

    const rect = host.getBoundingClientRect()
    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }

    void api
      .syncAiViewHost({
        kind,
        // 与旧逻辑一致: 宽高需 > 1 才认为真正可见 (避免布局未完成时的 1px 占位)。
        visible: rect.width > 1 && rect.height > 1,
        bounds,
      })
      .catch(() => undefined)
  }, [kind, visible])

  // 旧 scheduleAiHostsLayoutSync: rAF 合并多次触发, 避免布局抖动。
  const schedule = useCallback(() => {
    if (queuedRef.current) return
    queuedRef.current = true
    rafRef.current = window.requestAnimationFrame(() => {
      queuedRef.current = false
      rafRef.current = null
      syncNow()
    })
  }, [syncNow])

  // 监听宿主尺寸 (ResizeObserver) 与窗口尺寸 (resize) 变化, 持续同步定位。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    schedule()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => schedule())
      observer.observe(host)
    }

    const onResize = () => schedule()
    window.addEventListener('resize', onResize)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      queuedRef.current = false
    }
    // schedule 随 visible 变化而改变 identity, 故 visible 启停/面板切走时本 effect
    // 会重新执行并立即重新同步定位, 无需额外的 visible effect。
  }, [schedule])

  // 卸载时强制通知主进程隐藏 view, 避免原生 view 悬浮在其它面板之上。
  useEffect(
    () => () => {
      if (api.syncAiViewHost) {
        void api.syncAiViewHost({ kind, visible: false }).catch(() => undefined)
      }
    },
    [kind],
  )

  return { hostRef, syncNow, schedule }
}
