import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useChatStore } from '@/store/useChatStore'
import { useVaultStore } from '@/store/useVaultStore'
import { wsBus } from '@/lib/wsBus'
import { mergeVault, type MergeReport, type VaultFiles } from '@/lib/notes/merge'

// 知识库云端同步 (单会话顺序模型, 无实时强依赖):
//  - 保存后防抖推送整库 blob (kind=notes) 到 user-store; rev 乐观并发。
//  - 打开/登录时拉取, 与本地三方合并(防止旧版本覆盖新版本), 有差异弹「同步对比」。
//  - 未登录 / 服务器不支持 -> 静默纯本地。

export type NotesSyncState = 'off' | 'local' | 'syncing' | 'synced' | 'error'

interface NotesSyncStore {
  state: NotesSyncState
  lastReport: MergeReport | null
  compareOpen: boolean
  setState: (s: NotesSyncState) => void
  showReport: (r: MergeReport) => void
  setCompareOpen: (v: boolean) => void
}
export const useNotesSyncStore = create<NotesSyncStore>((set) => ({
  state: 'off',
  lastReport: null,
  compareOpen: false,
  setState: (state) => set({ state }),
  showReport: (lastReport) => set({ lastReport, compareOpen: true }),
  setCompareOpen: (compareOpen) => set({ compareOpen }),
}))

const PUSH_DEBOUNCE_MS = 900
const POLL_MS = 25000

function baseKey(server: string, user: string) {
  return `notesync:base:${server}:${user}`
}
function revKey(server: string, user: string) {
  return `notesync:rev:${server}:${user}`
}
function loadBase(server: string, user: string): VaultFiles {
  try {
    return JSON.parse(localStorage.getItem(baseKey(server, user)) || '{}') as VaultFiles
  } catch {
    return {}
  }
}
function saveBase(server: string, user: string, files: VaultFiles) {
  try {
    localStorage.setItem(baseKey(server, user), JSON.stringify(files))
  } catch {
    /* 配额超限则放弃持久化 base (下次按全量对比, 仍安全) */
  }
}
function loadRev(server: string, user: string): number {
  const v = Number(localStorage.getItem(revKey(server, user)))
  return Number.isInteger(v) && v >= 0 ? v : 0
}
function saveRev(server: string, user: string, rev: number) {
  try {
    localStorage.setItem(revKey(server, user), String(rev))
  } catch {
    /* ignore */
  }
}
function stable(files: VaultFiles): string {
  return JSON.stringify(
    Object.keys(files)
      .sort()
      .map((k) => [k, files[k]]),
  )
}

export function useNotesSync(): void {
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)

  useEffect(() => {
    const setState = useNotesSyncStore.getState().setState
    if (!serverUrl || !token) {
      setState('local')
      return
    }
    let cancelled = false
    let supported = false
    let lastSynced = ''
    let pushTimer: number | null = null
    let pollTimer: number | null = null
    const unsubs: Array<() => void> = []

    const authFetch = (path: string, init?: RequestInit) =>
      fetch(`${serverUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })

    const ours = (): VaultFiles => ({ ...useVaultStore.getState().rawByPath })

    // 串行化同步操作, 避免 poll / ws / 409 重试 触发的合并相互交叠。
    let syncChain: Promise<void> = Promise.resolve()
    const enqueue = (fn: () => Promise<void>): Promise<void> => {
      syncChain = syncChain.then(fn).catch(() => undefined)
      return syncChain
    }

    // 把合并结果落盘 (写改动/删多余) 后刷新本地。
    async function applyMerged(merged: VaultFiles): Promise<void> {
      const cur = ours()
      for (const [p, content] of Object.entries(merged)) {
        if (cur[p] !== content) await api.vault.write(p, content)
      }
      for (const p of Object.keys(cur)) {
        if (merged[p] === undefined) await api.vault.remove(p)
      }
      await useVaultStore.getState().reload()
    }

    async function push(baseRev: number, depth = 0): Promise<void> {
      const data = ours()
      try {
        const res = await authFetch('/api/user-store/notes', {
          method: 'PUT',
          body: JSON.stringify({ baseRev, data: { files: data } }),
        })
        if (res.ok) {
          const j = (await res.json()) as { rev: number }
          saveRev(serverUrl, username, j.rev)
          saveBase(serverUrl, username, data)
          lastSynced = stable(data)
          if (!cancelled) setState('synced')
          return
        }
        if (res.status === 409 && depth < 2) {
          await pullAndMerge(true)
          await push(loadRev(serverUrl, username), depth + 1)
          return
        }
        if (!cancelled) setState('error')
      } catch {
        if (!cancelled) setState('error')
      }
    }

    async function pullAndMerge(silent = false): Promise<void> {
      try {
        const res = await authFetch('/api/user-store/notes', { method: 'GET' })
        if (!res.ok) {
          supported = false
          if (!cancelled) setState('local')
          return
        }
        supported = true
        const remote = (await res.json()) as {
          rev: number
          data: { files?: VaultFiles } | null
        }
        if (cancelled) return
        const theirs = remote.data?.files ?? {}
        const storedRev = loadRev(serverUrl, username)
        const base = loadBase(serverUrl, username)
        const local = ours()

        if (remote.rev > storedRev) {
          const report = mergeVault(base, local, theirs)
          if (report.changed) {
            await applyMerged(report.merged)
          }
          saveBase(serverUrl, username, report.merged)
          saveRev(serverUrl, username, remote.rev)
          lastSynced = stable(report.merged)
          // 回推合并结果, 拿到新 rev (保持服务器与本地一致)。
          await push(remote.rev)
          const incoming = report.fromCloud.length + report.conflicts.length + report.deleted.length
          if (!silent && incoming > 0) useNotesSyncStore.getState().showReport(report)
        } else {
          // 云端无新内容: 本地若有改动则推送。
          if (stable(local) !== lastSynced) await push(storedRev)
          else if (!cancelled) setState('synced')
        }
      } catch {
        if (!cancelled) setState('error')
      }
    }

    function watchLocal(): void {
      const handler = () => {
        if (cancelled || !supported) return
        const data = ours()
        if (stable(data) === lastSynced) return
        if (!cancelled) setState('syncing')
        if (pushTimer) window.clearTimeout(pushTimer)
        pushTimer = window.setTimeout(() => {
          pushTimer = null
          if (cancelled || !supported) return
          if (stable(ours()) === lastSynced) {
            setState('synced')
            return
          }
          void enqueue(() => push(loadRev(serverUrl, username)))
        }, PUSH_DEBOUNCE_MS)
      }
      unsubs.push(useVaultStore.subscribe(handler))
    }

    function subscribeRealtime(): void {
      unsubs.push(
        wsBus.subscribe((p) => {
          if (cancelled || p.type !== 'user_store_updated' || p.kind !== 'notes') return
          if (typeof p.rev === 'number' && p.rev > loadRev(serverUrl, username)) {
            void enqueue(() => pullAndMerge())
          }
        }),
      )
    }

    void (async () => {
      // 等 vault 就绪
      for (let i = 0; i < 100 && !useVaultStore.getState().loaded; i++) {
        await new Promise((r) => setTimeout(r, 100))
        if (cancelled) return
      }
      if (cancelled) return
      setState('syncing')
      await enqueue(() => pullAndMerge(false))
      if (cancelled) return
      watchLocal()
      subscribeRealtime()
      if (!cancelled && supported) {
        pollTimer = window.setInterval(() => {
          if (!cancelled) void enqueue(() => pullAndMerge())
        }, POLL_MS)
      }
    })()

    return () => {
      cancelled = true
      if (pushTimer) window.clearTimeout(pushTimer)
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
