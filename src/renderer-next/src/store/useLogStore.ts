import { create } from 'zustand'
import { MAX_LOG_ENTRIES, sourceLabelOf, type LogEntry } from '@/components/panels/logs/types'

// 全局运行日志 store。
// 动机 (修复指令 [MEDIUM]): 日志采集需全局化, 早期/后台产生的日志不能因为
// LogsPanel 尚未挂载而丢失。订阅 api.onLog 由应用级 (App/Shell) 单次挂载写入此
// store, LogsPanel 只读消费。
//
// entries 维护带容量上限的行列表, 容量裁剪逻辑对齐原 useLogStream:
// 仅保留最近 MAX_LOG_ENTRIES 行。

interface LogState {
  entries: LogEntry[]
  // 追加若干日志行 (已按行拆分/trim 后的成品), 自动裁剪容量。
  append: (rows: LogEntry[]) => void
  clear: () => void
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  append: (rows) => {
    if (rows.length === 0) return
    set((state) => {
      const next = state.entries.concat(rows)
      // 容量裁剪: 仅保留最近 MAX_LOG_ENTRIES 行。
      return {
        entries: next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next,
      }
    })
  },
  clear: () => set({ entries: [] }),
}))

// 行 id 自增计数器。放在 store 模块作用域, 与订阅生命周期解耦,
// 即使订阅在严格模式下重挂也不会重置, 保证 id 唯一。
let nextId = 0

// 重新导出便捷读取/标签工具, 供订阅 hook 复用。
export { sourceLabelOf }

// 生成下一个日志行 id。
export function nextLogId(): number {
  return nextId++
}
