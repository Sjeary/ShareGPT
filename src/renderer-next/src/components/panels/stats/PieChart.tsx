import { buildPieSegments, conicGradient, type StatsEntry } from './helpers'

// 环形图: 用内联 conic-gradient 画饼, 中间挖空成环 (不引第三方图表库)。
// 对应旧版 renderGptStats 的 #gptPieChart / #gptPieCenter。
export function PieChart({
  entries,
  total,
}: {
  entries: StatsEntry[]
  total: number
}) {
  const segments = buildPieSegments(entries, total)
  const hasData = segments.length > 0 && total > 0
  const centerText = hasData ? `${total}` : '—'
  const centerHint = hasData ? '次提问' : '暂无统计'

  return (
    <div className="relative grid size-44 shrink-0 place-items-center">
      <div
        className="size-44 rounded-full"
        style={{ background: conicGradient(segments) }}
        role="img"
        aria-label={hasData ? `共 ${total} 次提问的占比环形图` : '暂无统计数据'}
      />
      {/* 中心挖空 */}
      <div className="absolute grid size-28 place-items-center rounded-full bg-card text-center shadow-sm">
        <div className="text-2xl font-semibold tabular-nums leading-none text-foreground">
          {centerText}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{centerHint}</div>
      </div>
    </div>
  )
}
