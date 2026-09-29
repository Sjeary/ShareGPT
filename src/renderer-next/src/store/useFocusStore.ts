import { create } from 'zustand'
import { api, userDataApiFor } from '@/lib/api'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import { createPrincipalDebouncedSave } from '@/lib/principalDebouncedSave'
import { assertUserDataWritable, userDataTransitionState } from '@/lib/userDataTransitionState'
import { coalesceInFlight } from '@/lib/inFlightRequest'
import type { ShareGptApi } from '@/types/api'
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
  round: { startedAt: number; durationMs: number; taskId: string | null } | null
  cycle: number // 已完成专注数(用于长休判定)
  currentTaskId: string | null
  sessions: FocusSession[]
  loaded: boolean
  loading: boolean
  loadError: string

  init: () => Promise<void>
  flushPending: () => Promise<void>
  resetForPrincipal: () => void
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

export const useFocusStore = create<FocusState>((set, get) => {
  let owner: SettingsPrincipalSnapshot | null = null
  let loadEpoch = 0
  const loads = new Map<string, Promise<void>>()
  const persistence = createPrincipalDebouncedSave<Parameters<ShareGptApi['saveFocus']>[0]>(
    (payload, snapshot) => userDataApiFor(snapshot).saveFocus(payload),
  )
  const persist = () => {
    if (!owner || !get().loaded) return
    settingsPrincipalRuntime.assertCurrent(owner)
    const s = get()
    persistence.schedule(
      {
        version: 1,
        sessions: s.sessions.slice(-2000),
        settings: { ...s.settings, currentTaskId: s.currentTaskId },
      },
      owner,
    )
  }

  const assertReady = () => {
    assertUserDataWritable()
    if (!owner || !get().loaded) throw new Error('专注资料尚未加载，请重新加载后再试')
    settingsPrincipalRuntime.assertCurrent(owner)
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
    if (s.phase === 'focus' && s.round) {
      const session: FocusSession = {
        id: crypto.randomUUID(),
        startedAt: new Date(s.round.startedAt).toISOString(),
        date: todayStr(),
        minutes: s.round.durationMs / 60_000,
        taskId: s.round.taskId,
      }
      const cycle = s.cycle + 1
      const next: Phase = cycle % s.settings.longEvery === 0 ? 'long' : 'short'
      set({ sessions: [...s.sessions, session], cycle, phase: next })
      void api.showSystemNotification({
        title: '专注完成 🍅',
        body: `已专注 ${session.minutes} 分钟，休息一下`,
      })
    } else {
      set({ phase: 'focus' })
      void api.showSystemNotification({ title: '休息结束', body: '开始下一个专注吧' })
    }
    const auto = get().settings.autoStart
    const dur = durationMs(get().phase)
    if (auto) {
      set({
        running: true,
        endAt: Date.now() + dur,
        remainingMs: dur,
        round: { startedAt: Date.now(), durationMs: dur, taskId: get().currentTaskId },
      })
      applySound(true)
    } else {
      set({ running: false, endAt: null, remainingMs: dur, round: null })
    }
    persist()
  }

  return {
    settings: DEFAULTS,
    phase: 'focus',
    running: false,
    endAt: null,
    remainingMs: DEFAULTS.focusMin * 60_000,
    round: null,
    cycle: 0,
    currentTaskId: null,
    sessions: [],
    loaded: false,
    loading: false,
    loadError: '',

    flushPending: () => persistence.flushPending(),
    resetForPrincipal: () => {
      loadEpoch += 1
      persistence.cancel()
      loads.clear()
      owner = null
      stopNoise()
      set({
        settings: { ...DEFAULTS },
        phase: 'focus',
        running: false,
        endAt: null,
        remainingMs: DEFAULTS.focusMin * 60000,
        round: null,
        cycle: 0,
        currentTaskId: null,
        sessions: [],
        loaded: false,
        loading: false,
        loadError: '',
      })
    },
    init: async () => {
      const snapshot = settingsPrincipalRuntime.snapshot()
      if (
        get().loaded &&
        owner?.principalId === snapshot.principalId &&
        owner?.generation === snapshot.generation
      )
        return
      set({ loading: true, loadError: '' })
      return coalesceInFlight(loads, JSON.stringify(snapshot), async () => {
        const epoch = ++loadEpoch
        const isCurrent = () => {
          const current = settingsPrincipalRuntime.current()
          return (
            epoch === loadEpoch &&
            current.principalId === snapshot.principalId &&
            current.generation === snapshot.generation
          )
        }
        if (!isCurrent()) return
        owner = snapshot
        try {
          const f = await userDataApiFor(snapshot).loadFocus()
          if (!isCurrent()) return
          const st = (f?.settings ?? {}) as Partial<FocusSettings> & {
            currentTaskId?: string | null
          }
          const settings = { ...DEFAULTS, ...st }
          const sessions = Array.isArray(f?.sessions) ? (f.sessions as FocusSession[]) : []
          set({
            settings,
            sessions,
            currentTaskId: st.currentTaskId ?? null,
            remainingMs: Math.max(1, settings.focusMin) * 60_000,
            loaded: true,
            loading: false,
            loadError: '',
          })
        } catch {
          if (isCurrent())
            set({
              loaded: false,
              loading: false,
              loadError:
                '无法读取专注资料，原有资料已保留。请检查文件访问权限或恢复有效备份后重试。',
            })
        }
      })
    },

    start: () => {
      assertReady()
      const s = get()
      if (s.running) return
      const startedAt = Date.now()
      const remaining = s.remainingMs > 0 ? s.remainingMs : durationMs()
      const end = startedAt + remaining
      set({
        running: true,
        endAt: end,
        round: s.round ?? {
          startedAt,
          durationMs: remaining,
          taskId: s.currentTaskId,
        },
      })
      applySound(true)
    },
    pause: () => {
      assertReady()
      const s = get()
      if (!s.running || !s.endAt) return
      set({ running: false, remainingMs: Math.max(0, s.endAt - Date.now()), endAt: null })
      stopNoise()
    },
    reset: () => {
      assertReady()
      set({ running: false, endAt: null, remainingMs: durationMs(), round: null })
      stopNoise()
    },
    skip: () => {
      assertReady()
      stopNoise()
      // 跳过当前阶段(不计专注、不累加周期): 专注→短休, 休息→专注。
      const next: Phase = get().phase === 'focus' ? 'short' : 'focus'
      set({ phase: next, running: false, endAt: null, remainingMs: durationMs(next), round: null })
    },
    tick: () => {
      if (userDataTransitionState.isSuspended() || !get().loaded || !owner) return
      const current = settingsPrincipalRuntime.current()
      if (current.principalId !== owner.principalId || current.generation !== owner.generation)
        return
      const s = get()
      if (!s.running || !s.endAt) return
      if (s.endAt - Date.now() <= 0) complete()
    },
    setPhase: (p) => {
      assertReady()
      stopNoise()
      set({ phase: p, running: false, endAt: null, remainingMs: durationMs(p), round: null })
    },
    setTaskId: (currentTaskId) => {
      assertReady()
      set({ currentTaskId })
      persist()
    },
    setSettings: (patch) => {
      assertReady()
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      // 时长设置只影响下一轮，暂停后继续仍保留本轮时长。
      if (!get().round) set({ remainingMs: durationMs() })
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
