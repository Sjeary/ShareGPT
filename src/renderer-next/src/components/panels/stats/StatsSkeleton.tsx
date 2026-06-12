import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// 统计页首次加载骨架: 用 animate-pulse 灰条/灰环占位, 结构与真实主体对齐
// (两块概览数字 + 环形图 + 排行榜), 避免首屏数值从 0 跳变到真实值。
// 排行榜占位复用 RankList 的「圆点 + 灰条」结构。
export function StatsSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      {/* 概览数字 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              总查询数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-9 w-24 rounded bg-muted" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              参与人数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-9 w-20 rounded bg-muted" />
          </CardContent>
        </Card>
      </div>

      {/* 占比环形图 + 排行 */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">查询占比与排行</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* 灰环: 外圆灰底, 中心挖空成卡片色, 对应 PieChart 结构 */}
          <div className="relative grid size-44 shrink-0 place-items-center">
            <div className="size-44 rounded-full bg-muted" />
            <div className="absolute size-28 rounded-full bg-card" />
          </div>
          {/* 排行榜灰条 (圆点 + 名称条 + 进度条) */}
          <ul className="min-w-0 flex-1 self-stretch space-y-3">
            {[72, 58, 44, 30].map((width, index) => (
              <li key={index} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full bg-muted" />
                  <span
                    className="h-3.5 rounded bg-muted"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div className="ml-5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-muted-foreground/30"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
