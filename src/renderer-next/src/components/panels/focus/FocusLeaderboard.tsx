import { useCallback, useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/useChatStore'

interface Row {
  username: string
  displayName: string
  minutes: number
  count: number
}
type Range = 'today' | 'week'

// 团队专注排名: 服务端按群聚合每人专注时长/番茄数。服务端未部署该接口时优雅降级。
export function FocusLeaderboard() {
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  const username = useChatStore((s) => s.identity.username)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [range, setRange] = useState<Range>('today')
  const [state, setState] = useState<'idle' | 'loading' | 'unsupported' | 'offline'>('idle')

  const load = useCallback(async () => {
    if (!serverUrl || !token) {
      setState('offline')
      setRows(null)
      return
    }
    setState('loading')
    try {
      const res = await fetch(`${serverUrl}/api/focus/leaderboard?range=${range}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setState('unsupported')
        return
      }
      const j = (await res.json()) as { leaderboard?: Row[] }
      setRows(j.leaderboard ?? [])
      setState('idle')
    } catch {
      setState('unsupported')
    }
  }, [serverUrl, token, range])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Trophy className="size-4 text-amber-500" /> 团队专注榜
        </p>
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5 text-xs">
          {(['today', 'week'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn('rounded px-2 py-0.5 transition-colors', range === r ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >
              {r === 'today' ? '今日' : '本周'}
            </button>
          ))}
        </div>
      </div>
      {state === 'offline' ? (
        <p className="py-3 text-center text-xs text-muted-foreground">登录协作群后查看团队排名</p>
      ) : state === 'unsupported' ? (
        <p className="py-3 text-center text-xs text-muted-foreground">该群服务端尚未启用专注排名</p>
      ) : state === 'loading' ? (
        <p className="py-3 text-center text-xs text-muted-foreground">加载中…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">还没有专注记录</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div
              key={r.username}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                r.username === username && 'bg-primary/10',
              )}
            >
              <span className={cn('w-5 text-center font-semibold', i === 0 ? 'text-amber-500' : i === 1 ? 'text-zinc-400' : i === 2 ? 'text-orange-600' : 'text-muted-foreground')}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.displayName || r.username}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.minutes} 分 · {r.count} 🍅</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
