import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { StatsPreset, StatsRange } from './helpers'

// 时间区间预设切换 (今天范围内的 7天/30天/90天/全部/自定义)。
// 对应旧版 #gptStatsPreset 下拉 + #gptStatsFrom/#gptStatsTo + #btnGptApplyRange。
const PRESETS: ReadonlyArray<{ key: StatsPreset; label: string }> = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' },
  { key: 'all', label: '全部' },
  { key: 'custom', label: '自定义' },
]

export function RangeControls({
  range,
  loading,
  onPreset,
  onCustomRange,
  onApply,
}: {
  range: StatsRange
  loading: boolean
  onPreset: (preset: StatsPreset) => void
  onCustomRange: (patch: Partial<Pick<StatsRange, 'from' | 'to'>>) => void
  onApply: () => void
}) {
  const isCustom = range.preset === 'custom'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((item) => {
          const active = range.preset === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onPreset(item.key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {isCustom && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="stats-from" className="text-xs text-muted-foreground">
              起始日期
            </Label>
            <Input
              id="stats-from"
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => onCustomRange({ from: e.target.value })}
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="stats-to" className="text-xs text-muted-foreground">
              结束日期
            </Label>
            <Input
              id="stats-to"
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => onCustomRange({ to: e.target.value })}
              className="h-9 w-40"
            />
          </div>
          <Button size="sm" onClick={onApply} disabled={loading} className="h-9">
            {loading ? '查询中…' : '应用区间'}
          </Button>
        </div>
      )}
    </div>
  )
}
