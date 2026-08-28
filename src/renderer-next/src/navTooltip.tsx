import { StrictMode, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { commitNavTooltipFrame } from '@/lib/navTooltipFrameProtocol'
import './index.css'

interface NavTooltipRenderModel {
  revision: number
  label: string
  side: 'left' | 'right'
  theme: 'light' | 'dark'
}

interface NavTooltipCommit {
  revision: number
}

interface NavTooltipOverlayApi {
  onRenderModel: (handler: (payload: NavTooltipRenderModel) => void) => () => void
  onCommit: (handler: (payload: NavTooltipCommit) => void) => () => void
  reportBootstrapReady: () => void
  reportLayoutReady: (payload: {
    revision: number
    sizeCss: { width: number; height: number }
  }) => void
  reportFrameReady: (payload: { revision: number }) => void
}

declare global {
  interface Window {
    navTooltipOverlay: NavTooltipOverlayApi
  }
}

let snapshot: NavTooltipRenderModel | null = null
let commitSnapshot: NavTooltipCommit | null = null
const subscribers = new Set<() => void>()
const commitSubscribers = new Set<(payload: NavTooltipCommit) => void>()

window.navTooltipOverlay.onRenderModel((payload) => {
  if (!Number.isInteger(payload?.revision) || payload.revision < 1) return
  document.documentElement.classList.toggle('dark', payload.theme !== 'light')
  document.body.style.opacity = '0'
  document.body.dataset.navTooltipPhase = 'rendering'
  snapshot = payload
  for (const subscriber of subscribers) subscriber()
})

window.navTooltipOverlay.onCommit((payload) => {
  if (!Number.isInteger(payload?.revision) || payload.revision < 1) return
  commitSnapshot = payload
  for (const subscriber of commitSubscribers) subscriber(payload)
})

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

export function NavTooltipOverlay() {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const state = useSyncExternalStore(
    (subscriber) => {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    () => snapshot,
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await document.fonts.ready
      // Hidden WebContentsViews may suspend rAF, so bootstrap waits only for
      // resources. Pixel readiness is acknowledged by the on-screen commit.
      if (!cancelled) window.navTooltipOverlay.reportBootstrapReady()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    if (!state) return
    const revision = state.revision
    let cancelled = false
    void (async () => {
      await document.fonts.ready
      if (cancelled || snapshot?.revision !== revision) return
      const content = contentRef.current
      if (!content) return
      window.navTooltipOverlay.reportLayoutReady({
        revision,
        sizeCss: { width: content.offsetWidth, height: content.offsetHeight },
      })
    })()
    return () => {
      cancelled = true
    }
  }, [state])

  useEffect(() => {
    if (!state) return
    const revision = state.revision
    let cancelled = false
    const onCommit = (payload: NavTooltipCommit) => {
      if (payload.revision !== revision) return
      void (async () => {
        document.body.dataset.navTooltipPhase = 'transparent'
        const ready = await commitNavTooltipFrame({
          nextFrame,
          isCurrent: () => !cancelled && snapshot?.revision === revision,
          reveal() {
            document.body.style.opacity = '1'
            document.body.dataset.navTooltipPhase = 'revealed'
          },
        })
        if (ready) {
          document.body.dataset.navTooltipPhase = 'visible'
          window.navTooltipOverlay.reportFrameReady({ revision })
        }
      })()
    }
    commitSubscribers.add(onCommit)
    if (commitSnapshot) onCommit(commitSnapshot)
    return () => {
      cancelled = true
      commitSubscribers.delete(onCommit)
    }
  }, [state])

  if (!state) return null

  const onRight = state.side === 'right'
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed top-1/2 size-px -translate-y-1/2"
            style={onRight ? { left: 0 } : { right: 0 }}
          />
        </TooltipTrigger>
        <TooltipContent
          ref={contentRef}
          side={state.side}
          sideOffset={4}
          avoidCollisions={false}
          className="font-medium"
        >
          {state.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
document.body.style.opacity = '0'
document.body.dataset.navTooltipPhase = 'hidden'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavTooltipOverlay />
  </StrictMode>,
)
