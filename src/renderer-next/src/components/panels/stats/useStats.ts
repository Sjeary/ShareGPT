import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import {
  fetchRangeStats,
  rangeFromPreset,
  rangeFromSettings,
  type RangeStats,
  type StatsPreset,
  type StatsRange,
} from './helpers'

const EMPTY_STATS: RangeStats = { totalQueries: 0, userCount: 0, entries: [] }

// 使用统计 hook: 读取 collab.server_url + 登录 token, 拉取区间排行,
// 并把区间预设持久化到 settings.gpt (对应旧版 persistGptState 中的 stats_*)。
export function useStats() {
  const serverUrl = useAppStore((s) => s.settings?.collab?.server_url ?? '')
  const gptSettings = useAppStore((s) => s.settings?.gpt)
  const patchSection = useAppStore((s) => s.patchSection)
  const token = useAuthStore((s) => s.token)

  // 初始区间从持久化设置恢复。
  const [range, setRange] = useState<StatsRange>(() => rangeFromSettings(gptSettings))
  const [stats, setStats] = useState<RangeStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 避免过期响应覆盖新结果。
  const reqIdRef = useRef(0)

  const load = useCallback(
    async (target: StatsRange) => {
      if (!serverUrl || !token) {
        setStats(EMPTY_STATS)
        setError('')
        return
      }
      const reqId = ++reqIdRef.current
      setLoading(true)
      setError('')
      try {
        const result = await fetchRangeStats(serverUrl, token, target)
        if (reqId === reqIdRef.current) setStats(result)
      } catch (err) {
        if (reqId === reqIdRef.current) {
          setStats(EMPTY_STATS)
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (reqId === reqIdRef.current) setLoading(false)
      }
    },
    [serverUrl, token],
  )

  // 持久化区间到 settings.gpt (与旧版字段同名)。
  const persist = useCallback(
    (target: StatsRange) => {
      void patchSection('gpt', {
        stats_preset: target.preset,
        stats_from: target.from,
        stats_to: target.to,
      }).catch(() => {
        /* 设置保存失败不阻塞统计展示 */
      })
    },
    [patchSection],
  )

  // 切换预设: 7d/30d/90d/all 立即重算并加载; custom 仅切换不自动加载 (等用户填日期后应用)。
  const applyPreset = useCallback(
    (preset: StatsPreset) => {
      const next =
        preset === 'custom' ? { ...range, preset: 'custom' as const } : rangeFromPreset(preset)
      setRange(next)
      persist(next)
      if (preset !== 'custom') void load(next)
    },
    [range, persist, load],
  )

  // 自定义区间: 更新 from/to (标记为 custom), 不自动加载。
  const setCustomRange = useCallback((patch: Partial<Pick<StatsRange, 'from' | 'to'>>) => {
    setRange((prev) => ({ ...prev, preset: 'custom', ...patch }))
  }, [])

  // 应用 (自定义区间查询按钮 / 刷新)。
  const apply = useCallback(() => {
    persist(range)
    void load(range)
  }, [range, persist, load])

  // token / serverUrl 就绪或变化时自动加载当前区间。
  useEffect(() => {
    void load(range)
    // 仅依赖凭据变化触发, 区间变化由显式动作触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, token])

  return {
    authed: Boolean(token),
    range,
    stats,
    loading,
    error,
    applyPreset,
    setCustomRange,
    apply,
  }
}
