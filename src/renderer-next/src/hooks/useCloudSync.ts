import { useEffect } from 'react'
import { useChatStore } from '@/store/useChatStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useTasksStore } from '@/store/useTasksStore'
import { wsBus } from '@/lib/wsBus'
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
// 轮询兜底间隔: 实时主要走协作聊天的那条 WS(经 wsBus); 这里仅作断连/漏推时的最终一致兜底。
const POLL_INTERVAL_MS = 20000

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
    let pollTimer: number | null = null

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

    // 应用来自服务器的某 kind 更新 (rev 更新时才合并)。realtime 与 poll 共用。
    function applyRemote(kind: SyncKind, rev: number, data: unknown): void {
      if (cancelled) return
      if (rev <= getStoredRev(serverUrl, username, kind)) return
      supported[kind] = true
      const cfg = KIND_CONFIGS[kind]
      const merged = cfg.merge(cfg.getLocal() as never, data) as never
      cfg.apply(merged)
      lastSynced[kind] = stable(merged)
      setStoredRev(serverUrl, username, kind, rev)
      // 合并后若本地仍有服务器没有的条目, 推回去保持一致。
      if (stable(merged) !== stable(data)) void push(kind, merged, rev)
      else setStatus(kind, 'synced')
    }

    // 实时: 复用协作聊天的唯一 WS (经 wsBus), 不再自建连接, 避免「账号在别处登录」。
    function subscribeRealtime(): void {
      unsubs.push(
        wsBus.subscribe((p) => {
          if (cancelled || p.type !== 'user_store_updated') return
          const kind = p.kind as SyncKind
          if (kind !== 'calendar' && kind !== 'tasks') return
          applyRemote(kind, typeof p.rev === 'number' ? p.rev : 0, p.data)
        }),
      )
    }

    // 轮询兜底: WS 断连/漏推时, 定期 GET 比对 rev, 拉取较新数据。
    async function pollOnce(): Promise<void> {
      for (const kind of KINDS) {
        if (cancelled || !supported[kind]) continue
        try {
          const res = await authFetch(`/api/user-store/${kind}`, { method: 'GET' })
          if (!res.ok) continue
          const remote = (await res.json()) as { rev: number; data: unknown }
          if (remote.rev > getStoredRev(serverUrl, username, kind)) {
            applyRemote(kind, remote.rev, remote.data)
          }
        } catch {
          /* 忽略单次轮询失败 */
        }
      }
    }

    void (async () => {
      // 等两个本地 store 就绪 (init 幂等), 确保 getLocal 有数据后再同步。
      await Promise.all([
        useCalendarStore.getState().init(),
        useTasksStore.getState().init(),
      ]).catch(() => undefined)
      if (cancelled) return
      subscribeRealtime()
      for (const kind of KINDS) {
        await initialSync(kind)
        if (cancelled) return
        watchLocal(kind)
      }
      // 仅当服务器支持时才轮询。
      if (!cancelled && (supported.calendar || supported.tasks)) {
        pollTimer = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
      }
    })()

    return () => {
      cancelled = true
      for (const kind of KINDS) {
        if (pushTimers[kind]) window.clearTimeout(pushTimers[kind] as number)
      }
      if (pollTimer) window.clearInterval(pollTimer)
      for (const fn of unsubs) {
        try {
          fn()
        } catch {
          /* ignore */
        }
      }
    }
  }, [serverUrl, token, username])
}
