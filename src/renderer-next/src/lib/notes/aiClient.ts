import { api } from '@/lib/api'
import type { NotesAiRequest } from '@/types/api'

// 发起一次流式 AI 调用; 返回 cancel 函数。事件按 streamId 过滤。
export function runAi(
  req: NotesAiRequest,
  cb: { onDelta: (t: string) => void; onDone: () => void; onError: (m: string) => void },
): () => void {
  let streamId = ''
  let cancelled = false
  const unsub = api.onNotesAiEvent((p) => {
    if (!streamId || p.streamId !== streamId) return
    if (p.type === 'delta') cb.onDelta(p.text || '')
    else if (p.type === 'done') {
      unsub()
      cb.onDone()
    } else if (p.type === 'error') {
      unsub()
      cb.onError(p.message || '生成出错')
    }
  })
  void api.notesAi
    .complete(req)
    .then((r) => {
      streamId = r.streamId
      if (cancelled && streamId) void api.notesAi.cancel(streamId)
    })
    .catch(() => {
      unsub()
      cb.onError('调用失败')
    })
  return () => {
    cancelled = true
    if (streamId) void api.notesAi.cancel(streamId)
    unsub()
  }
}
