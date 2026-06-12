import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { PanelScaffold } from './PanelScaffold'
import { LogToolbar } from './logs/LogToolbar'
import { useLogStream } from './logs/useLogStream'
import type { LogEntry } from './logs/types'

// 运行日志面板。对齐旧版 renderer.js logLine + index.html #logBox/.ops-log-card:
// - 实时订阅 api.onLog, 行结构 [时间] [来源] 文本
// - 等宽字体滚动区, 自动滚到底
// - 顶部工具条: 清空 / 复制全部 / 暂停自动滚动 / 按来源过滤
// - 容量上限裁剪 (见 useLogStream / MAX_LOG_ENTRIES)
export function LogsPanel() {
  const { entries, clear } = useLogStream()
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeSource, setActiveSource] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 当前出现过的来源集合 (用于过滤芯片)。
  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.source) set.add(e.source)
    return Array.from(set)
  }, [entries])

  // 选中的来源若已消失 (清空后), 回退到「全部」。
  useEffect(() => {
    if (activeSource !== null && !sources.includes(activeSource)) {
      setActiveSource(null)
    }
  }, [sources, activeSource])

  const visible = useMemo(
    () =>
      activeSource === null
        ? entries
        : entries.filter((e) => e.source === activeSource),
    [entries, activeSource],
  )

  // 自动滚到底 (旧版 box.scrollTop = box.scrollHeight)。暂停时不滚。
  useEffect(() => {
    if (!autoScroll) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [visible, autoScroll])

  const handleCopy = () => {
    if (visible.length === 0) {
      toast.info('暂无日志可复制')
      return
    }
    const text = visible.map(formatLine).join('\n')
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`已复制 ${visible.length} 行日志`))
      .catch(() => toast.error('复制失败'))
  }

  const handleClear = () => {
    clear()
    setActiveSource(null)
  }

  return (
    <PanelScaffold
      icon={ScrollText}
      title="运行日志"
      hint="显示启动、停止和异常信息，方便排查问题"
    >
      <div className="flex h-full min-h-0 flex-col">
        <LogToolbar
          sources={sources}
          activeSource={activeSource}
          onSourceChange={setActiveSource}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((v) => !v)}
          onCopy={handleCopy}
          onClear={handleClear}
          count={entries.length}
          filteredCount={visible.length}
        />

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto bg-background px-4 py-3 font-mono text-xs leading-relaxed"
        >
          {visible.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无日志
            </div>
          ) : (
            visible.map((e) => <LogRow key={e.id} entry={e} />)
          )}
        </div>
      </div>
    </PanelScaffold>
  )
}

function formatLine(e: LogEntry): string {
  return `[${e.ts}] [${e.sourceLabel}] ${e.line}`
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-all">
      <span className="shrink-0 text-muted-foreground tabular-nums">
        [{entry.ts}]
      </span>
      <span className="shrink-0 text-primary">[{entry.sourceLabel}]</span>
      <span className="text-foreground">{entry.line}</span>
    </div>
  )
}
