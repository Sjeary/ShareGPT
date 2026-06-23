import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, RotateCcw, Settings2, SkipForward, Timer, Flame } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'
import { cn } from '@/lib/utils'
import { useFocusStore, focusStats, type Phase } from '@/store/useFocusStore'
import { useClockTick } from '@/hooks/useFocusTimer'
import { useTasksStore } from '@/store/useTasksStore'
import { FocusLeaderboard } from './focus/FocusLeaderboard'
import type { NoiseKind } from '@/lib/noise'

const PHASES: { key: Phase; label: string }[] = [
  { key: 'focus', label: '专注' },
  { key: 'short', label: '短休' },
  { key: 'long', label: '长休' },
]
const SOUNDS: { key: NoiseKind; label: string }[] = [
  { key: 'none', label: '无' },
  { key: 'white', label: '白噪音' },
  { key: 'brown', label: '棕噪音' },
  { key: 'rain', label: '雨声' },
]

function fmt(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function FocusPanel() {
  const init = useFocusStore((s) => s.init)
  const phase = useFocusStore((s) => s.phase)
  const running = useFocusStore((s) => s.running)
  const settings = useFocusStore((s) => s.settings)
  const sessions = useFocusStore((s) => s.sessions)
  const currentTaskId = useFocusStore((s) => s.currentTaskId)
  const cycle = useFocusStore((s) => s.cycle)

  const tasks = useTasksStore((s) => s.tasks)
  const initTasks = useTasksStore((s) => s.init)

  const [showSettings, setShowSettings] = useState(false)
  useClockTick(running)

  useEffect(() => {
    void init()
    void initTasks()
  }, [init, initTasks])

  const displayMs = useFocusStore.getState().displayMs()
  const durMs = useFocusStore.getState().durationMs(phase)
  const progress = durMs > 0 ? 1 - displayMs / durMs : 0
  const stats = useMemo(() => focusStats(sessions), [sessions])
  const maxWeek = Math.max(1, ...stats.week.map((w) => w.minutes))

  const R = 130
  const C = 2 * Math.PI * R
  const phaseColor = phase === 'focus' ? 'var(--primary)' : phase === 'short' ? '#3b82f6' : '#14b8a6'

  const openTasks = tasks.filter((t) => !t.completed)
  const curTask = tasks.find((t) => t.id === currentTaskId)
  const taskPomos = currentTaskId ? sessions.filter((s) => s.taskId === currentTaskId).length : 0

  return (
    <PanelScaffold
      icon={Timer}
      title="专注"
      hint="番茄钟 · 专注统计 · 团队排名"
      toolbar={
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          title="设置"
        >
          <Settings2 className="size-4" />
        </button>
      }
    >
      <div className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[1.1fr_1fr]">
        {/* 计时器 */}
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card/40 p-6">
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {PHASES.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => useFocusStore.getState().setPhase(p.key)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-all',
                  phase === p.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="relative grid place-items-center">
            <svg width="300" height="300" className="-rotate-90">
              <circle cx="150" cy="150" r={R} fill="none" stroke="var(--border)" strokeWidth="10" />
              <circle
                cx="150"
                cy="150"
                r={R}
                fill="none"
                stroke={phaseColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))}
                style={{ transition: 'stroke-dashoffset 0.5s linear' }}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="font-mono text-5xl font-semibold tabular-nums">{fmt(displayMs)}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {phase === 'focus' ? `第 ${cycle + 1} 个番茄` : '休息中'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (running ? useFocusStore.getState().pause() : useFocusStore.getState().start())}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.02] active:scale-95"
            >
              {running ? <Pause className="size-5" /> : <Play className="size-5" />}
              {running ? '暂停' : '开始'}
            </button>
            <button type="button" onClick={() => useFocusStore.getState().reset()} title="重置" className="inline-flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent">
              <RotateCcw className="size-4" />
            </button>
            <button type="button" onClick={() => useFocusStore.getState().skip()} title="跳过" className="inline-flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent">
              <SkipForward className="size-4" />
            </button>
          </div>

          {/* 任务绑定 */}
          <div className="flex w-full items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">专注于</span>
            <select
              value={currentTaskId ?? ''}
              onChange={(e) => useFocusStore.getState().setTaskId(e.target.value || null)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 outline-none focus:border-primary/60"
            >
              <option value="">（不绑定任务）</option>
              {openTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          {curTask && <p className="text-xs text-muted-foreground">「{curTask.title}」已专注 {taskPomos} 个番茄</p>}

          {showSettings && (
            <div className="grid w-full grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {(['focusMin', 'shortMin', 'longMin'] as const).map((k) => (
                <label key={k} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{k === 'focusMin' ? '专注' : k === 'shortMin' ? '短休' : '长休'}(分)</span>
                  <input
                    type="number"
                    min={1}
                    value={settings[k]}
                    onChange={(e) => useFocusStore.getState().setSettings({ [k]: Math.max(1, Number(e.target.value) || 1) })}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 outline-none focus:border-primary/60"
                  />
                </label>
              ))}
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={settings.autoStart} onChange={(e) => useFocusStore.getState().setSettings({ autoStart: e.target.checked })} />
                <span className="text-xs">自动开始下一段</span>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">氛围音</span>
                <select
                  value={settings.sound}
                  onChange={(e) => useFocusStore.getState().setSettings({ sound: e.target.value as NoiseKind })}
                  className="h-8 w-full rounded-md border border-border bg-background px-1 outline-none focus:border-primary/60"
                >
                  {SOUNDS.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* 统计 + 排名 */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="今日专注" value={`${stats.todayMinutes}`} unit="分钟" />
            <Stat label="今日番茄" value={`${stats.todayCount}`} unit="个" />
            <Stat label="连续天数" value={`${stats.streak}`} unit="天" icon={<Flame className="size-4 text-orange-500" />} />
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-4">
            <p className="mb-3 text-sm font-medium">最近 7 天</p>
            <div className="flex h-28 items-end justify-between gap-2">
              {stats.week.map((w) => (
                <div key={w.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary/70 transition-all"
                    style={{ height: `${(w.minutes / maxWeek) * 88}px`, minHeight: w.minutes > 0 ? 4 : 0 }}
                    title={`${w.minutes} 分钟`}
                  />
                  <span className="text-[10px] text-muted-foreground">{w.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>

          <FocusLeaderboard />
        </div>
      </div>
    </PanelScaffold>
  )
}

function Stat({ label, value, unit, icon }: { label: string; value: string; unit: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3 text-center">
      <div className="flex items-center justify-center gap-1 text-2xl font-semibold tabular-nums">
        {icon}
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}（{unit}）</div>
    </div>
  )
}
