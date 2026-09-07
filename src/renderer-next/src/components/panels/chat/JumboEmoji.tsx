import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { notoAnimatedWebp, resolveEmojiKitchen } from '@/lib/chat/emoji'
import { loadEmojiImage } from '@/lib/chat/emojiImage'

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
// 无组合则保留两个 emoji；临时网络失败可重试，成功图片复用有界缓存。
function KitchenCombo({ a, b, size }: { a: string; b: string; size: number }) {
  const key = `${a}__${b}`
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean }>()
  const [attempt, setAttempt] = useState(0)
  const current = result?.key === key ? result : undefined

  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  useEffect(() => {
    let alive = true
    void resolveEmojiKitchen(a, b)
      .then(async (url) => {
        if (!alive) return
        if (url) await loadEmojiImage(url)
        if (alive) setResult({ key, url: url ?? undefined })
      })
      .catch(() => {
        if (alive) setResult({ key, failed: true })
      })
    return () => {
      alive = false
    }
  }, [a, b, key, attempt])

  if (current?.url) {
    return (
      <img
        src={current.url}
        alt={`${a}${b}`}
        draggable={false}
        onError={() => setResult({ key, failed: true })}
        style={{ height: size * 1.4 }}
        className="inline-block select-none"
      />
    )
  }
  // 查询中 / 无组合 → 即时两个动态 emoji, 不留空白
  return (
    <span className="flex items-center gap-1">
      <AnimatedEmoji key={`a:${a}`} cluster={a} size={size} />
      <AnimatedEmoji key={`b:${b}`} cluster={b} size={size} />
      {current?.failed && (
        <button
          type="button"
          aria-label="重新加载组合表情"
          title="组合图片加载失败，点击重试"
          className="rounded p-1 text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-primary"
          onClick={() => {
            setResult({ key })
            setAttempt((value) => value + 1)
          }}
        >
          <RotateCw size={14} />
        </button>
      )}
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
