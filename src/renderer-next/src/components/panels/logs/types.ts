// 单条日志行结构。对齐旧版 logLine(source, line): 含时间戳/来源/文本。
// 旧版把同一 line 按 \r?\n 拆成多行, 每行单独 trim/过滤空行后入栈。
export interface LogEntry {
  id: number
  ts: string // 本地时间 toLocaleTimeString
  source: string // 原始来源 key (app/sender/receiver/collab/...)
  sourceLabel: string // 中文来源标签
  line: string
}

// 主进程 onLog 推送的原始负载形状。类型上是 unknown, 这里做窄化用。
export interface RawLogPayload {
  source?: unknown
  line?: unknown
}

// 来源 key -> 中文标签。对齐旧版 renderer.js SOURCE_LABELS。
export const SOURCE_LABELS: Record<string, string> = {
  app: '系统',
  sender: '代理',
  receiver: '接收服务',
  collab: '账号服务',
  'receiver-singbox': '接收端',
  'receiver-frpc': '映射服务',
}

export function sourceLabelOf(source: string): string {
  return SOURCE_LABELS[source] || source || '系统'
}

// 容量上限: 避免无限增长。旧版用 <pre> 直接累加 textContent 无上限,
// 这里主动裁剪保留最近 N 行。
export const MAX_LOG_ENTRIES = 2000
