import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useChatStore, type ChatMessage, type ChatReadingPosition } from '@/store/useChatStore'

function messageNode(root: HTMLElement, id: string) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (node) => node.dataset.messageId === id,
  )
}

const UNREAD_TOP_CONTEXT_PX = 56

function positionUnread(root: HTMLElement, id: string): boolean {
  const node = messageNode(root, id)
  if (!node) return false
  root.scrollTop +=
    node.getBoundingClientRect().top - root.getBoundingClientRect().top - UNREAD_TOP_CONTEXT_PX
  return true
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

function restore(root: HTMLElement, position?: ChatReadingPosition, followLatest = true) {
  if (!position || (position.atBottom && followLatest)) {
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
  const resolvedUnreadId = firstUnreadId
  const requestedUnreadRef = useRef(firstUnreadId)
  const resolvedUnreadRef = useRef(resolvedUnreadId)
  useLayoutEffect(() => {
    requestedUnreadRef.current = firstUnreadId
    resolvedUnreadRef.current = resolvedUnreadId
  }, [firstUnreadId, resolvedUnreadId])
  const activeViewRef = useRef('')
  const pendingUnreadRef = useRef<{ key: string; id: string } | null>(null)
  // Pixel offsets are retained in the store without re-rendering every message on every scroll event.
  const atBottom = useChatStore((state) => state.readingPositions[viewKey]?.atBottom ?? true)
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
    if (!root || !active) {
      if (!active && activeViewRef.current === viewKey) activeViewRef.current = ''
      return
    }
    const enteringView = activeViewRef.current !== viewKey
    activeViewRef.current = viewKey
    const unreadTarget = resolvedUnreadRef.current || requestedUnreadRef.current
    const savedPosition = useChatStore.getState().readingPositions[viewKey]
    // 已经在本会话见过这批未读时恢复原阅读锚点；只有离开期间新出现的未读才定位首条。
    if (enteringView && unreadTarget && savedPosition?.unreadMarkerId !== unreadTarget) {
      pendingUnreadRef.current = {
        key: viewKey,
        id: unreadTarget,
      }
    }
    useChatStore.setState({ readingActiveView: viewKey })
    const save = () => {
      if (!root.clientHeight) return
      const old = useChatStore.getState().readingPositions[viewKey]
      if (old?.anchorId && !root.querySelector('[data-message-id]')) return
      useChatStore.getState().saveReadingPosition(viewKey, capture(root, resolvedUnreadRef.current))
    }
    const reconcile = () => {
      if (!root.clientHeight) return
      const pending = pendingUnreadRef.current
      if (pending?.key === viewKey) {
        const target = resolvedUnreadRef.current || pending.id
        if (target && positionUnread(root, target)) {
          pendingUnreadRef.current = null
          save()
          return
        }
        if (requestedUnreadRef.current) return
        pendingUnreadRef.current = null
      }
      restore(root, useChatStore.getState().readingPositions[viewKey], !requestedUnreadRef.current)
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
    const pending = pendingUnreadRef.current
    if (pending?.key === viewKey) {
      const target = resolvedUnreadId || pending.id
      if (target && positionUnread(root, target)) {
        pendingUnreadRef.current = null
      } else if (firstUnreadId) {
        return
      } else {
        pendingUnreadRef.current = null
        restore(root, old, focused && !firstUnreadId)
      }
    } else {
      // 后台/失焦期间即使原来贴底，也以最后已读消息为锚，不替用户吞掉新消息。
      restore(root, old, focused && !firstUnreadId)
    }
    store.saveReadingPosition(viewKey, capture(root, resolvedUnreadId))
  }, [viewKey, messages, active, firstUnreadId, resolvedUnreadId, focused])

  function toLatest() {
    const root = scrollRef.current
    if (!root) return
    root.scrollTop = root.scrollHeight
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, resolvedUnreadRef.current))
    setReturnTarget(null)
  }

  function jumpToMessage(id: string) {
    const root = scrollRef.current
    const node = root && messageNode(root, id)
    if (!root || !node) return false
    if (returnTarget?.key !== viewKey)
      setReturnTarget({ key: viewKey, position: capture(root, resolvedUnreadId) })
    node.scrollIntoView({ block: 'center', behavior: 'instant' })
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, resolvedUnreadId))
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
    useChatStore.getState().saveReadingPosition(viewKey, capture(root, resolvedUnreadRef.current))
    setReturnTarget(null)
  }

  return {
    scrollRef,
    contentRef,
    atBottom,
    focused,
    toLatest,
    jumpToMessage,
    returnToReading,
    canReturn: returnTarget?.key === viewKey,
  }
}
