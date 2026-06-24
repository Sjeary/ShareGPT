import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { notoAnimatedWebp, resolveEmojiKitchen } from '@/lib/chat/emoji'

// 组合结果缓存 (会话内): url=有组合且已就绪; null=无组合/失败。同一对再次出现直接命中。
const kitchenCache = new Map<string, string | null>()

// 单个动态 emoji: 优先 Noto 动图 (WebP), 加载失败回退为系统静态 emoji 字符。
function AnimatedEmoji({ cluster, size }: { cluster: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span style={{ fontSize: size, lineHeight: 1 }} className="select-text">
        {cluster}
      </span>
    )
  }
  return (
    <img
      src={notoAnimatedWebp(cluster)}
      alt={cluster}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="inline-block select-none"
    />
  )
}

// 两个 emoji: 查本地索引判断是否有 Emoji Kitchen 组合。
// 始终先即时显示两个动态 emoji 占位; 若有组合, 后台直连 Google gstatic 预加载好再无缝替换;
// 无组合则一直保持两个 emoji(0 网络请求)。会话内缓存结果, 二次出现直接命中。
function KitchenCombo({ a, b, size }: { a: string; b: string; size: number }) {
  const key = `${a}__${b}`
  // undefined=查询中; string=组合图就绪; null=无组合/失败
  const [url, setUrl] = useState<string | null | undefined>(() =>
    kitchenCache.has(key) ? kitchenCache.get(key) : undefined,
  )

  useEffect(() => {
    if (kitchenCache.has(key)) return
    let alive = true
    void resolveEmojiKitchen(a, b).then((resolved) => {
      if (!resolved) {
        kitchenCache.set(key, null)
        if (alive) setUrl(null)
        return
      }
      const img = new Image()
      img.onload = () => {
        kitchenCache.set(key, resolved)
        if (alive) setUrl(resolved)
      }
      img.onerror = () => {
        kitchenCache.set(key, null)
        if (alive) setUrl(null)
      }
      img.src = resolved // 后台预加载, 加载完进 HTTP 缓存
    })
    return () => {
      alive = false
    }
  }, [a, b, key])

  if (typeof url === 'string') {
    return (
      <img
        src={url}
        alt={`${a}${b}`}
        draggable={false}
        style={{ height: size * 1.4 }}
        className="inline-block select-none"
      />
    )
  }
  // 查询中 / 无组合 → 即时两个动态 emoji, 不留空白
  return (
    <span className="flex items-center gap-1">
      <AnimatedEmoji cluster={a} size={size} />
      <AnimatedEmoji cluster={b} size={size} />
    </span>
  )
}

// 放大表情消息 (Telegram 式): 1 个最大; 2 个尝试组合; 3 个并排放大。
export function JumboEmoji({ clusters }: { clusters: string[] }) {
  if (clusters.length === 2) {
    return (
      <div className="py-0.5">
        <KitchenCombo a={clusters[0]} b={clusters[1]} size={48} />
      </div>
    )
  }
  const size = clusters.length === 1 ? 64 : 48
  return (
    <span className={cn('flex items-center py-0.5', clusters.length > 1 ? 'gap-1.5' : '')}>
      {clusters.map((c, i) => (
        <AnimatedEmoji key={i} cluster={c} size={size} />
      ))}
    </span>
  )
}
