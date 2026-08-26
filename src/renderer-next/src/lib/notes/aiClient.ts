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
  },
): () => void {
  let streamId = ''
  let cancelled = false
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
  const unsub = api.onNotesAiEvent((p) => {
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
      unsub()
      cb.onDone()
    } else if (p.type === 'error') {
      unsub()
      cb.onError(p.message || '生成出错')
    }
  })
  void api.notesAi
    .complete({ ...req, principalId, principalGeneration })
    .then((r) => {
      streamId = r.streamId
      if (r.principalId !== principalId || !isCurrentPrincipal()) cancelled = true
      if (cancelled && streamId) {
        void api.notesAi.cancel(streamId)
        unsub()
      }
    })
    .catch(() => {
      unsub()
      if (isCurrentPrincipal()) cb.onError('调用失败')
    })
  return () => {
    cancelled = true
    if (streamId) void api.notesAi.cancel(streamId)
    unsub()
  }
}
