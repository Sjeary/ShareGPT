import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { emojiKitchenUrl, notoAnimatedWebp } from '@/lib/chat/emoji'

// 组合图加载结果缓存 (会话内): 同一对 emoji 再次出现时直接命中, 不再等待。
const kitchenCache = new Map<string, 'loaded' | 'failed'>()

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

// 两个 emoji: 尝试 Emoji Kitchen 组合贴纸。
// 关键: 先即时显示两个动态 emoji 占位 (无空白等待), 组合图在后台预加载完成后再无缝替换;
// 无组合/失败则一直保持两个 emoji。会话内缓存结果, 二次出现直接命中。
function KitchenCombo({ a, b, size }: { a: string; b: string; size: number }) {
  const url = emojiKitchenUrl(a, b, 256)
  const key = `${a}__${b}`
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(
    () => kitchenCache.get(key) ?? 'loading',
  )

  useEffect(() => {
    if (state !== 'loading') return
    let alive = true
    const img = new Image()
    img.onload = () => {
      kitchenCache.set(key, 'loaded')
      if (alive) setState('loaded')
    }
    img.onerror = () => {
      kitchenCache.set(key, 'failed')
      if (alive) setState('failed')
    }
    img.src = url // 后台预加载; 加载完进 HTTP 缓存, 渲染时秒出
    return () => {
      alive = false
    }
  }, [key, url, state])

  if (state === 'loaded') {
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
  // 加载中 / 无组合 → 即时两个动态 emoji, 不留空白
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
