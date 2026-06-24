import { useState } from 'react'
import { cn } from '@/lib/utils'
import { emojiKitchenUrl, notoAnimatedWebp } from '@/lib/chat/emoji'

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

// 两个 emoji: 尝试 Emoji Kitchen 组合贴纸, 无组合/加载失败时回退为两个放大 emoji 并排。
function KitchenCombo({ a, b, size }: { a: string; b: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="flex items-center gap-1">
        <AnimatedEmoji cluster={a} size={size} />
        <AnimatedEmoji cluster={b} size={size} />
      </span>
    )
  }
  return (
    <img
      src={emojiKitchenUrl(a, b, 256)}
      alt={`${a}${b}`}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ height: size * 1.4 }}
      className="inline-block select-none"
    />
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
