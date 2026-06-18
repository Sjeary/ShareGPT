import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { nextLogId, useLogStore } from '@/store/useLogStore'
import { sourceLabelOf, type LogEntry, type RawLogPayload } from './types'

// 应用级日志订阅。
//
// 修复指令 [MEDIUM] 日志采集全局化: 把 onLog 订阅从 LogsPanel 提升到应用级
// (App/Shell) 单次挂载, 写入全局 useLogStore。这样早期/后台产生的日志在
// LogsPanel 尚未挂载时也会被采集, 切到日志面板时不丢历史。
//
// 关键约束: onLog 全局只能订阅一次。本 hook 由 layout 域在 App/Shell 挂载一次,
// 不要在 LogsPanel 内调用 (LogsPanel 改为只读消费 store)。useRef 防御严格模式下
// 的重复订阅。
//
// 行处理对齐旧版 renderer.js main(): 同一 line 按 \r?\n 拆分, 逐行 trim + 过滤
// 空行后入栈; 来源 key 窄化为字符串并映射中文标签。
export function useLogStream(): void {
  // 防御 React 18 严格模式 effect 双调用导致的重复订阅。
  const subscribedRef = useRef(false)

  useEffect(() => {
    if (subscribedRef.current) return
    subscribedRef.current = true

    const append = useLogStore.getState().append

    // onLog 返回退订函数, 卸载时调用以避免泄漏。
    const unsubscribe = api.onLog((payload: unknown) => {
      const { source, line } = (payload ?? {}) as RawLogPayload
      if (line == null) return

      const sourceKey = typeof source === 'string' ? source : ''
      const sourceLabel = sourceLabelOf(sourceKey)

      const rows = String(line)
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (rows.length === 0) return

      const ts = new Date().toLocaleTimeString()
      const appended: LogEntry[] = rows.map((row) => ({
        id: nextLogId(),
        ts,
        source: sourceKey,
        sourceLabel,
        line: row,
      }))

      append(appended)
    })

    return () => {
      subscribedRef.current = false
      unsubscribe()
    }
  }, [])
}
