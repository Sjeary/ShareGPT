// 表情消息工具: 判断「整条消息是否只有 emoji」, 以及生成动态 emoji / Emoji Kitchen 组合图的 URL。
// 用于聊天里「单个/少量 emoji 放大 + 动态化, 两个 emoji 组合」的 Telegram 式体验。

// 纯 emoji 消息最多放大的表情数 (超过则按普通文本渲染), 对齐 Telegram 的做法。
export const JUMBO_MAX = 3

const EMOJI_RE = /\p{Extended_Pictographic}/u

// 用字素簇 (grapheme) 切分, 把带变体选择符 / ZWJ 的组合 emoji 当作一个整体。
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

// 若 text 去空白后「只由 emoji 组成」(1..N 个), 返回各 emoji 字素簇数组; 否则返回 null。
// 含字母/数字的簇(如键帽 1️⃣)按普通文本处理, 避免误判。
export function emojiClusters(text: string): string[] | null {
  const t = (text || '').trim()
  if (!t) return null
  const clusters = segmenter ? Array.from(segmenter.segment(t), (s) => s.segment) : Array.from(t) // 退化: 按码点切 (老环境)
  if (!clusters.length) return null
  for (const c of clusters) {
    if (!EMOJI_RE.test(c)) return null
    if (/[0-9a-zA-Z]/.test(c)) return null
  }
  return clusters
}

// emoji 字素簇 → Noto 动画资源的码点序列 (小写 hex, 下划线连接), 如 ❤️ → "2764_fe0f"。
export function notoSequence(cluster: string): string {
  return Array.from(cluster)
    .map((ch) => ch.codePointAt(0)?.toString(16) ?? '')
    .filter(Boolean)
    .join('_')
}

// Google Noto 动态 emoji 的动图 (WebP, 自动循环播放)。约 470 个常用 emoji 有动画,
// 不在集合内会 404 → 调用方应回退到静态字符。Apache-2.0。
export function notoAnimatedWebp(cluster: string): string {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${notoSequence(cluster)}/512.webp`
}

// Emoji Kitchen 组合贴纸 (Google Gboard 的两两混合)。用 emojik 代理, 它内部处理
// 「日期码 / 合法配对」并在无组合时回退; 失败时调用方回退为并排放大。
export function emojiKitchenUrl(a: string, b: string, size = 256): string {
  return `https://emojik.vercel.app/s/${encodeURIComponent(a)}_${encodeURIComponent(b)}?size=${size}`
}
