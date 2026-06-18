import { useEffect } from 'react'
import { BarChart3, RefreshCw, TriangleAlert, Users } from 'lucide-react'
import { PanelScaffold } from './PanelScaffold'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useStats } from './stats/useStats'
import { formatRangeText, STATS_KIND_LABELS, type StatsKind } from './stats/helpers'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { RangeControls } from './stats/RangeControls'
import { PieChart } from './stats/PieChart'
import { RankList } from './stats/RankList'
import { StatsSkeleton } from './stats/StatsSkeleton'

// 使用统计面板:
// - 总查询数 (大数字, tabular-nums) + 参与人数
// - 时间区间预设切换 (近7/30/90天 / 全部 / 自定义), 持久化到 settings.gpt.stats_*
// - 环形图 (内联 conic-gradient, 琥珀主题) + 用户查询排行 (进度条列表)
// 数据直连协作服务器 GET /api/gpt/stats[?from&to], 带 Bearer useAuthStore.token。
// 逻辑对照旧版 renderer.js loadGptRangeStats / renderGptStats / setGptStatsPreset。
export function StatsPanel() {
  const { authed, range, kind, setKind, stats, loading, error, applyPreset, setCustomRange, apply } =
    useStats()
  // 维度可见性跟随导航开关: Gemini 默认隐藏(集成未成功), Claude 跟随其开关; ChatGPT 始终有。
  const showGemini = useAppStore((s) => s.showGemini)
  const showClaude = useAppStore((s) => s.showClaude)
  const kinds: StatsKind[] = [
    'gpt',
    ...(showGemini ? (['gemini'] as StatsKind[]) : []),
    ...(showClaude ? (['claude'] as StatsKind[]) : []),
  ]
  // 当前维度若被隐藏(如 Gemini 关闭), 回落到 ChatGPT。
  useEffect(() => {
    if (!kinds.includes(kind)) setKind('gpt')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGemini, showClaude, kind])

  // 未登录: 参照账户面板的 authed 判断, 给出登录提示。
  if (!authed) {
    return (
      <PanelScaffold icon={BarChart3} title="使用统计" hint="查询量与排行">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-muted">
            <BarChart3 className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base font-medium text-foreground">登录后查看统计</p>
          <p className="text-sm text-muted-foreground">
            使用统计直连协作服务器，请先在「账户」面板登录协作账号后再查看查询量与排行。
          </p>
        </div>
      </PanelScaffold>
    )
  }

  const total = stats.totalQueries
  const userCount = stats.userCount || stats.entries.length

  // 是否已有数据 (含 0 次但有条目, 或 total > 0)。
  const hasData = total > 0 || stats.entries.length > 0
  // 首次加载 (无任何旧数据): 显示骨架。
  const firstLoad = loading && !hasData && !error
  // 已有旧数据时刷新: 给主体加遮罩防数值跳变。
  const refreshing = loading && hasData

  return (
    <PanelScaffold
      icon={BarChart3}
      title="使用统计"
      hint="查询量与排行"
      toolbar={
        <Button variant="outline" size="sm" onClick={apply} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? '刷新中…' : '刷新'}
        </Button>
      }
    >
      <div className="selectable mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {/* AI 维度切换: 仅显示已启用的入口 (Gemini 默认隐藏)。单一维度时不显示切换。 */}
        {kinds.length > 1 && (
        <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              disabled={loading && kind === k}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                kind === k
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {STATS_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        )}

        {/* 区间筛选 */}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <RangeControls
              range={range}
              loading={loading}
              onPreset={applyPreset}
              onCustomRange={setCustomRange}
              onApply={apply}
            />
            <p className="text-xs text-muted-foreground">{formatRangeText(range)}</p>
          </CardContent>
        </Card>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {firstLoad ? (
          <StatsSkeleton />
        ) : (
          <div
            className={
              refreshing
                ? 'pointer-events-none flex flex-col gap-4 opacity-60 transition-opacity'
                : 'flex flex-col gap-4 transition-opacity'
            }
          >
        {/* 概览数字 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                总查询数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
                {total.toLocaleString('zh-CN')}
              </span>
              <span className="ml-2 text-sm text-muted-foreground">次提问</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Users className="size-4" />
                参与人数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
                {userCount.toLocaleString('zh-CN')}
              </span>
              <span className="ml-2 text-sm text-muted-foreground">位成员</span>
            </CardContent>
          </Card>
        </div>

        {/* 占比环形图 + 排行 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">查询占比与排行</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <PieChart entries={stats.entries} total={total} />
            <div className="min-w-0 flex-1 self-stretch">
              <RankList entries={stats.entries} total={total} />
            </div>
          </CardContent>
        </Card>
          </div>
        )}
      </div>
    </PanelScaffold>
  )
}
