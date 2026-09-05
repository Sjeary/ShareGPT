import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useChatStore, type ChatMessage, type ChatReadingPosition } from '@/store/useChatStore'

function messageNode(root: HTMLElement, id: string) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (node) => node.dataset.messageId === id,
  )
}

function capture(root: HTMLElement, unreadMarkerId = ''): ChatReadingPosition {
  const top = root.getBoundingClientRect().top
  const anchor = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (node) => node.getBoundingClientRect().bottom > top,
  )
  return {
    anchorId: anchor?.dataset.messageId ?? '',
    offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
    scrollTop: root.scrollTop,
    atBottom: root.scrollHeight - root.scrollTop - root.clientHeight < 24,
    unreadMarkerId,
  }
}

function restore(root: HTMLElement, position?: ChatReadingPosition) {
  if (!position || position.atBottom) {
    root.scrollTop = root.scrollHeight
    return
  }
  const anchor = messageNode(root, position.anchorId)
  root.scrollTop = anchor
    ? root.scrollTop +
      anchor.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      position.offset
    : position.scrollTop
}

// One owner reconciles navigation, incoming messages and delayed layout changes against a message anchor.
export function useChatReading(
  viewKey: string,
  messages: ChatMessage[],
  active: boolean,
  firstUnreadId: string,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Pixel offsets are retained in the store without re-rendering every message on every scroll event.
  const atBottom = useChatStore((state) => state.readingPositions[viewKey]?.atBottom ?? true)
  const unreadMarkerId = useChatStore(
    (state) => state.readingPositions[viewKey]?.unreadMarkerId ?? '',
  )
  const [returnTarget, setReturnTarget] = useState<{
    key: string
    position: ChatReadingPosition
  } | null>(null)
  const [focused, setFocused] = useState(
    () => document.hasFocus() && document.visibilityState !== 'hidden',
  )
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const highlighted = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const update = () => setFocused(document.hasFocus() && document.visibilityState !== 'hidden')
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root || !active) return
    useChatStore.setState({ readingActiveView: viewKey })
    const save = () => {
      if (!root.clientHeight) return
      const old = useChatStore.getState().readingPositions[viewKey]
      if (old?.anchorId && !root.querySelector('[data-message-id]')) return
      useChatStore.getState().saveReadingPosition(viewKey, capture(root, old?.unreadMarkerId))
    }
    const reconcile = () => {
      if (!root.clientHeight) return
      restore(root, useChatStore.getState().readingPositions[viewKey])
      save()
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reconcile)
    })
    observer.observe(root)
    if (contentRef.current) observer.observe(contentRef.current)
    root.addEventListener('scroll', save, { passive: true })
    reconcile()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(highlightTimer.current)
      highlighted.current?.classList.remove('chat-jump-target')
      highlighted.current = null
      root.removeEventListener('scroll', save)
      if (useChatStore.getState().readingActiveView === viewKey)
        useChatStore.setState({ readingActiveView: '' })
    }
  }, [viewKey, active])

  useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root?.clientHeight || !active) return
    const store = useChatStore.getState()
    if (store.readingActiveView !== viewKey) useChatStore.setState({ readingActiveView: viewKey })
    const old = store.readingPositions[viewKey]
    if (old?.anchorId && messages.length === 0) return
    restore(root, old)
    store.saveReadingPosition(viewKey, capture(root, firstUnreadId || old?.unreadMarkerId))
  }, [viewKey, messages, active, firstUnreadId])

  function toLatest() {
    const root = scrollRef.current
    if (!root) return
    root.scrollTop = root.scrollHeight
    const old = useChatStore.getState().readingPositions[viewKey]
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, old?.unreadMarkerId))
    setReturnTarget(null)
  }

  function jumpToMessage(id: string) {
    const root = scrollRef.current
    const node = root && messageNode(root, id)
    if (!root || !node) return false
    if (returnTarget?.key !== viewKey)
      setReturnTarget({ key: viewKey, position: capture(root, unreadMarkerId) })
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, unreadMarkerId))
    highlighted.current?.classList.remove('chat-jump-target')
    highlighted.current = node
    node.classList.add('chat-jump-target')
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => node.classList.remove('chat-jump-target'), 1600)
    return true
  }

  function returnToReading() {
    const root = scrollRef.current
    if (!root || returnTarget?.key !== viewKey) return
    restore(root, returnTarget.position)
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, unreadMarkerId))
    setReturnTarget(null)
  }

  return {
    scrollRef,
    contentRef,
    atBottom,
    unreadMarkerId,
    focused,
    toLatest,
    jumpToMessage,
    returnToReading,
    canReturn: returnTarget?.key === viewKey,
  }
}
