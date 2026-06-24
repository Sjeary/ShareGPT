import { create } from 'zustand'
import { api } from '@/lib/api'
import { startNoise, stopNoise, type NoiseKind } from '@/lib/noise'

// 番茄钟 / 专注 store。全局单计时器: 用绝对时间戳(endAt)计算剩余, 后台不被 throttle 影响。
export type Phase = 'focus' | 'short' | 'long'

export interface FocusSettings {
  focusMin: number
  shortMin: number
  longMin: number
  longEvery: number // 每 N 个专注后长休
  autoStart: boolean
  sound: NoiseKind
}
export interface FocusSession {
  id: string
  startedAt: string // ISO
  date: string // YYYY-MM-DD
  minutes: number
  taskId: string | null
}

const DEFAULTS: FocusSettings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStart: false,
  sound: 'none',
}

function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface FocusState {
  settings: FocusSettings
  phase: Phase
  running: boolean
  endAt: number | null
  remainingMs: number
  cycle: number // 已完成专注数(用于长休判定)
  currentTaskId: string | null
  sessions: FocusSession[]
  loaded: boolean

  init: () => Promise<void>
  start: () => void
  pause: () => void
  reset: () => void
  skip: () => void
  tick: () => void
  setPhase: (p: Phase) => void
  setTaskId: (id: string | null) => void
  setSettings: (patch: Partial<FocusSettings>) => void
  // 选择器
  durationMs: (p?: Phase) => number
  displayMs: () => number
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useFocusStore = create<FocusState>((set, get) => {
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const s = get()
      void api.saveFocus({
        version: 1,
        sessions: s.sessions.slice(-2000),
        settings: { ...s.settings, currentTaskId: s.currentTaskId },
      })
    }, 400)
  }

  const durationMs = (p?: Phase): number => {
    const { settings } = get()
    const phase = p ?? get().phase
    const m =
      phase === 'focus'
        ? settings.focusMin
        : phase === 'short'
          ? settings.shortMin
          : settings.longMin
    return Math.max(1, m) * 60_000
  }

  const applySound = (on: boolean) => {
    const s = get()
    if (on && s.phase === 'focus' && s.settings.sound !== 'none') startNoise(s.settings.sound)
    else stopNoise()
  }

  const complete = () => {
    const s = get()
    stopNoise()
    if (s.phase === 'focus') {
      const session: FocusSession = {
        id: crypto.randomUUID(),
        startedAt: new Date(Date.now() - durationMs('focus')).toISOString(),
        date: todayStr(),
        minutes: s.settings.focusMin,
        taskId: s.currentTaskId,
      }
      const cycle = s.cycle + 1
      const next: Phase = cycle % s.settings.longEvery === 0 ? 'long' : 'short'
      set({ sessions: [...s.sessions, session], cycle, phase: next })
      void api.showSystemNotification({
        title: '专注完成 🍅',
        body: `已专注 ${s.settings.focusMin} 分钟，休息一下`,
      })
    } else {
      set({ phase: 'focus' })
      void api.showSystemNotification({ title: '休息结束', body: '开始下一个专注吧' })
    }
    const auto = get().settings.autoStart
    const dur = durationMs(get().phase)
    if (auto) {
      set({ running: true, endAt: Date.now() + dur, remainingMs: dur })
      applySound(true)
    } else {
      set({ running: false, endAt: null, remainingMs: dur })
    }
    persist()
  }

  return {
    settings: DEFAULTS,
    phase: 'focus',
    running: false,
    endAt: null,
    remainingMs: DEFAULTS.focusMin * 60_000,
    cycle: 0,
    currentTaskId: null,
    sessions: [],
    loaded: false,

    init: async () => {
      if (get().loaded) return
      try {
        const f = await api.loadFocus()
        const st = (f?.settings ?? {}) as Partial<FocusSettings> & { currentTaskId?: string | null }
        const settings = { ...DEFAULTS, ...st }
        const sessions = Array.isArray(f?.sessions) ? (f.sessions as FocusSession[]) : []
        set({
          settings,
          sessions,
          currentTaskId: st.currentTaskId ?? null,
          remainingMs: Math.max(1, settings.focusMin) * 60_000,
          loaded: true,
        })
      } catch {
        set({ loaded: true })
      }
    },

    start: () => {
      const s = get()
      if (s.running) return
      const end = Date.now() + (s.remainingMs > 0 ? s.remainingMs : durationMs())
      set({ running: true, endAt: end })
      applySound(true)
    },
    pause: () => {
      const s = get()
      if (!s.running || !s.endAt) return
      set({ running: false, remainingMs: Math.max(0, s.endAt - Date.now()), endAt: null })
      stopNoise()
    },
    reset: () => {
      set({ running: false, endAt: null, remainingMs: durationMs() })
      stopNoise()
    },
    skip: () => {
      stopNoise()
      // 跳过当前阶段(不计专注、不累加周期): 专注→短休, 休息→专注。
      const next: Phase = get().phase === 'focus' ? 'short' : 'focus'
      set({ phase: next, running: false, endAt: null, remainingMs: durationMs(next) })
    },
    tick: () => {
      const s = get()
      if (!s.running || !s.endAt) return
      if (s.endAt - Date.now() <= 0) complete()
    },
    setPhase: (p) => {
      stopNoise()
      set({ phase: p, running: false, endAt: null, remainingMs: durationMs(p) })
    },
    setTaskId: (currentTaskId) => {
      set({ currentTaskId })
      persist()
    },
    setSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      // 调整时长后, 若未运行则刷新剩余显示
      if (!get().running) set({ remainingMs: durationMs() })
      applySound(get().running)
      persist()
    },

    durationMs,
    displayMs: () => {
      const s = get()
      return s.running && s.endAt ? Math.max(0, s.endAt - Date.now()) : s.remainingMs
    },
  }
})

// —— 统计选择器 (组件里用) ——
export function focusStats(sessions: FocusSession[]) {
  const today = todayStr()
  const todays = sessions.filter((s) => s.date === today)
  const todayMinutes = todays.reduce((a, s) => a + s.minutes, 0)
  const byDate = new Set(sessions.map((s) => s.date))
  // streak: 从今天往前连续有专注的天数
  let streak = 0
  const d = new Date()
  for (;;) {
    if (byDate.has(todayStr(d))) {
      streak++
      d.setDate(d.getDate() - 1)
    } else break
  }
  // 近 7 天柱状
  const week: { date: string; minutes: number }[] = []
  const w = new Date()
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(w)
    dd.setDate(w.getDate() - i)
    const ds = todayStr(dd)
    week.push({
      date: ds,
      minutes: sessions.filter((s) => s.date === ds).reduce((a, s) => a + s.minutes, 0),
    })
  }
  return { todayMinutes, todayCount: todays.length, streak, week }
}
