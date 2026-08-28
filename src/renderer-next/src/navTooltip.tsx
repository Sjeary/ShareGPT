import { StrictMode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import './index.css'

interface NavTooltipPayload {
  label: string
  side: 'left' | 'right'
  theme: 'light' | 'dark'
}

declare global {
  interface Window {
    setNavTooltip: (payload: NavTooltipPayload) => void
  }
}

type NavTooltipSnapshot = NavTooltipPayload & { revision: number }

let snapshot: NavTooltipSnapshot | null = null
let revision = 0
const subscribers = new Set<() => void>()

window.setNavTooltip = (payload) => {
  document.documentElement.classList.toggle('dark', payload.theme !== 'light')
  snapshot = { ...payload, revision: ++revision }
  for (const subscriber of subscribers) subscriber()
}

export function NavTooltipOverlay() {
  const state = useSyncExternalStore(
    (subscriber) => {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    () => snapshot,
  )

  if (!state) return null

  const onRight = state.side === 'right'
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip key={state.revision} open>
        <TooltipTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed top-1/2 size-px -translate-y-1/2"
            style={onRight ? { left: 0 } : { right: 0 }}
          />
        </TooltipTrigger>
        <TooltipContent
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavTooltipOverlay />
  </StrictMode>,
)
