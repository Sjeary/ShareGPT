import { api } from '@/lib/api'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import type { NotesAiRequest } from '@/types/api'
import { isCurrentNotesAiPrincipal } from '@/lib/notes/notesAiLifecycle'

// 发起一次流式 AI 调用; 返回 cancel 函数。事件按 streamId 过滤。
export function runAi(
  req: NotesAiRequest,
  cb: {
    onDelta: (t: string) => void
    onDone: () => void
    onError: (m: string) => void
    onStatus?: (m: string) => void
    onCancelled?: () => void
  },
): () => void {
  let streamId = ''
  let cancelled = false
  let finished = false
  const session = useNotesAiStore.getState()
  const principalId = session.principalId
  const principalGeneration = session.principalGeneration
  const isCurrentPrincipal = () => {
    const current = useNotesAiStore.getState()
    return isCurrentNotesAiPrincipal(
      { principalId, principalGeneration },
      {
        principalId: current.principalId,
        principalGeneration: current.principalGeneration,
      },
    )
  }
  let unsubEvents: () => void = () => undefined
  let unsubPrincipal: () => void = () => undefined
  const cleanup = () => {
    unsubEvents()
    unsubPrincipal()
  }
  const cancelForPrincipalChange = () => {
    if (finished) return
    finished = true
    cancelled = true
    if (streamId) void api.notesAi.cancel(streamId)
    cleanup()
    cb.onCancelled?.()
  }
  unsubEvents = api.onNotesAiEvent((p) => {
    if (
      !streamId ||
      p.streamId !== streamId ||
      p.principalId !== principalId ||
      !isCurrentPrincipal()
    ) {
      return
    }
    if (p.type === 'delta') cb.onDelta(p.text || '')
    else if (p.type === 'status') cb.onStatus?.(p.message || '')
    else if (p.type === 'done') {
      finished = true
      cleanup()
      cb.onDone()
    } else if (p.type === 'error') {
      finished = true
      cleanup()
      cb.onError(p.message || '生成出错')
    }
  })
  unsubPrincipal = useNotesAiStore.subscribe(() => {
    if (!isCurrentPrincipal()) cancelForPrincipalChange()
  })
  void api.notesAi
    .complete({ ...req, principalId, principalGeneration })
    .then((r) => {
      streamId = r.streamId
      if (r.principalId !== principalId || !isCurrentPrincipal()) {
        cancelForPrincipalChange()
      } else if (cancelled && streamId) {
        void api.notesAi.cancel(streamId)
        cleanup()
      }
    })
    .catch(() => {
      if (finished) return
      finished = true
      cleanup()
      if (isCurrentPrincipal()) cb.onError('调用失败')
    })
  return () => {
    if (finished) return
    finished = true
    cancelled = true
    if (streamId) void api.notesAi.cancel(streamId)
    cleanup()
  }
}
