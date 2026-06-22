import { useEffect } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore } from '@/store/useTasksStore'
import {
  KIND_CONFIGS,
  getStoredRev,
  setStoredRev,
  stable,
  useSyncStatus,
  type SyncKind,
} from '@/lib/cloudSync'

const KINDS: SyncKind[] = ['calendar', 'tasks']
const PUSH_DEBOUNCE_MS = 800

// http(s)://host -> ws(s)://host/ws?token= (复刻协作聊天约定)。
function toWsUrl(httpUrl: string, token: string): string | null {
  const normalized = (httpUrl || '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) return null
  const base = normalized.startsWith('https://')
    ? `wss://${normalized.slice('https://'.length)}/ws`
    : `ws://${normalized.slice('http://'.length)}/ws`
  return `${base}?token=${encodeURIComponent(token)}`
}

// 个人数据云端同步主控 hook (在 Shell 挂载一次)。登录态下自动: 初次拉取合并 -> 本地变更推送
// -> 服务器实时推送其它端更新。乐观并发(rev)防止老版本覆盖新版本; 未登录/服务器不支持则静默本地。
export function useCloudSync(): void {
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)

  useEffect(() => {
    const setStatus = useSyncStatus.getState().setState

    if (!serverUrl || !token) {
      setStatus('calendar', 'local')
      setStatus('tasks', 'local')
      return
    }

    let cancelled = false
    const lastSynced: Record<SyncKind, string> = { calendar: '', tasks: '' }
    const supported: Record<SyncKind, boolean> = { calendar: false, tasks: false }
    const pushTimers: Record<SyncKind, number | null> = { calendar: null, tasks: null }
    const unsubs: Array<() => void> = []
    let ws: WebSocket | null = null

    const authFetch = (path: string, init?: RequestInit) =>
      fetch(`${serverUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })

    // 推送本地数据; 409(版本落后) -> 合并服务器最新后重试 (最多 2 次)。
    async function push(kind: SyncKind, data: unknown, baseRev: number, depth = 0): Promise<void> {
      const cfg = KIND_CONFIGS[kind]
      try {
        const res = await authFetch(`/api/user-store/${kind}`, {
          method: 'PUT',
          body: JSON.stringify({ baseRev, data }),
        })
        if (res.ok) {
          const j = (await res.json()) as { rev: number }
          setStoredRev(serverUrl, username, kind, j.rev)
          lastSynced[kind] = stable(data)
          if (!cancelled) setStatus(kind, 'synced')
          return
        }
        if (res.status === 409 && depth < 2) {
          const j = (await res.json()) as { rev: number; data: unknown }
          // 合并服务器最新 + 本地, 应用后带新 rev 重试。
          const merged = cfg.merge(cfg.getLocal() as never, j.data) as never
          cfg.apply(merged)
          lastSynced[kind] = stable(merged)
          setStoredRev(serverUrl, username, kind, j.rev)
          await push(kind, merged, j.rev, depth + 1)
          return
        }
        if (!cancelled) setStatus(kind, 'error')
      } catch {
        if (!cancelled) setStatus(kind, 'error')
      }
    }

    // 初次同步: 拉服务器 -> 合并 -> 若本地有增量则推回; 服务器空则推本地。
    async function initialSync(kind: SyncKind): Promise<void> {
      const cfg = KIND_CONFIGS[kind]
      setStatus(kind, 'syncing')
      try {
        const res = await authFetch(`/api/user-store/${kind}`, { method: 'GET' })
        if (!res.ok) {
          supported[kind] = false
          if (!cancelled) setStatus(kind, 'local')
          return
        }
        supported[kind] = true
        const remote = (await res.json()) as { rev: number; data: unknown }
        if (cancelled) return
        if (remote.rev > 0 && remote.data) {
          const merged = cfg.merge(cfg.getLocal() as never, remote.data) as never
          cfg.apply(merged)
          lastSynced[kind] = stable(merged)
          setStoredRev(serverUrl, username, kind, remote.rev)
          if (stable(merged) !== stable(remote.data)) {
            await push(kind, merged, remote.rev)
          } else if (!cancelled) {
            setStatus(kind, 'synced')
          }
        } else {
          // 服务器尚无数据: 把本地(含示例/已有)作为初版上传 (baseRev=0)。
          await push(kind, cfg.getLocal(), 0)
        }
      } catch {
        supported[kind] = false
        if (!cancelled) setStatus(kind, 'error')
      }
    }

    // 本地变更 -> 防抖推送 (与 lastSynced 比较, 避免回环/无谓推送)。
    function watchLocal(kind: SyncKind): void {
      const cfg = KIND_CONFIGS[kind]
      const handler = () => {
        if (cancelled || !supported[kind]) return
        if (stable(cfg.getLocal()) === lastSynced[kind]) return
        setStatus(kind, 'syncing')
        if (pushTimers[kind]) window.clearTimeout(pushTimers[kind] as number)
        pushTimers[kind] = window.setTimeout(() => {
          pushTimers[kind] = null
          if (cancelled || !supported[kind]) return
          const data = cfg.getLocal()
          if (stable(data) === lastSynced[kind]) {
            setStatus(kind, 'synced')
            return
          }
          void push(kind, data, getStoredRev(serverUrl, username, kind))
        }, PUSH_DEBOUNCE_MS)
      }
      unsubs.push(cfg.subscribe(handler))
    }

    // 实时: 监听服务器对「本用户其它端」更新的推送。
    function openRealtime(): void {
      const wsUrl = toWsUrl(serverUrl, token)
      if (!wsUrl) return
      try {
        ws = new WebSocket(wsUrl)
        ws.onmessage = (ev) => {
          if (cancelled) return
          let p: Record<string, unknown>
          try {
            p = JSON.parse(String(ev.data || '{}'))
          } catch {
            return
          }
          if (p.type !== 'user_store_updated') return
          const kind = p.kind as SyncKind
          if (kind !== 'calendar' && kind !== 'tasks') return
          supported[kind] = true
          const rev = typeof p.rev === 'number' ? p.rev : 0
          if (rev <= getStoredRev(serverUrl, username, kind)) return
          const cfg = KIND_CONFIGS[kind]
          const merged = cfg.merge(cfg.getLocal() as never, p.data) as never
          cfg.apply(merged)
          lastSynced[kind] = stable(merged)
          setStoredRev(serverUrl, username, kind, rev)
          // 合并后若本地仍有服务器没有的条目, 推回去保持一致。
          if (stable(merged) !== stable(p.data)) void push(kind, merged, rev)
          else setStatus(kind, 'synced')
        }
        ws.onerror = () => {
          /* 实时失败无妨, 推送/拉取仍工作 */
        }
      } catch {
        /* 构造失败忽略 */
      }
    }

    void (async () => {
      // 等两个本地 store 就绪 (init 幂等), 确保 getLocal 有数据后再同步。
      await Promise.all([
        useCalendarStore.getState().init(),
        useTasksStore.getState().init(),
      ]).catch(() => undefined)
      if (cancelled) return
      for (const kind of KINDS) {
        await initialSync(kind)
        if (cancelled) return
        watchLocal(kind)
      }
      if (!cancelled) openRealtime()
    })()

    return () => {
      cancelled = true
      for (const kind of KINDS) {
        if (pushTimers[kind]) window.clearTimeout(pushTimers[kind] as number)
      }
      for (const fn of unsubs) {
        try {
          fn()
        } catch {
          /* ignore */
        }
      }
      if (ws) {
        ws.onmessage = null
        ws.onerror = null
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
    }
  }, [serverUrl, token, username])
}
