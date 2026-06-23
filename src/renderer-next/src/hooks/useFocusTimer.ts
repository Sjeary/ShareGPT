import { useEffect, useState } from 'react'
import { useFocusStore } from '@/store/useFocusStore'

// 全局计时驱动: 每秒 tick(处理阶段完成); 应用级挂载一次, 关面板也继续走。
export function useFocusTimer(): void {
  useEffect(() => {
    void useFocusStore.getState().init()
    const id = window.setInterval(() => useFocusStore.getState().tick(), 1000)
    return () => window.clearInterval(id)
  }, [])
}

// 让组件每 ~0.5s 重新渲染以刷新倒计时显示 (运行时)。
export function useClockTick(active: boolean): void {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setN((n) => n + 1), 500)
    return () => window.clearInterval(id)
  }, [active])
}
