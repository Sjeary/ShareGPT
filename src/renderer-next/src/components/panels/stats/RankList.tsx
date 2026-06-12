import { PIE_COLORS, entryLabel, percentOf, type StatsEntry } from './helpers'

// 用户查询排行 (进度条 + 列表)。对应旧版 #gptStatsLegend 图例。
// 颜色与 PieChart 一一对应 (同一 index 同色)。
export function RankList({
  entries,
  total,
}: {
  entries: StatsEntry[]
  total: number
}) {
  if (!entries.length || total <= 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-border py-10 text-sm text-muted-foreground">
        所选时间范围内还没有提问记录。
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const color = PIE_COLORS[index % PIE_COLORS.length]
        const pct = percentOf(entry.count, total)
        return (
          <li key={entry.username} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {entryLabel(entry)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {pct}% · {entry.count} 次
              </span>
            </div>
            {/* 进度条 */}
            <div className="ml-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(pct, 2)}%`, background: color }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
