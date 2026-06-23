import { useEffect, useState } from 'react'
import { useFocusStore } from '@/store/useFocusStore'
import { useChatStore } from '@/store/useChatStore'

// 全局计时驱动: 每秒 tick(处理阶段完成); 应用级挂载一次, 关面板也继续走。
export function useFocusTimer(): void {
  useEffect(() => {
    void useFocusStore.getState().init()
    const id = window.setInterval(() => useFocusStore.getState().tick(), 1000)
    return () => window.clearInterval(id)
  }, [])
}

// 把新完成的专注段上报到协作服务器(供团队排名)。仅上报订阅之后新增的, 不补报历史。
export function useFocusSync(): void {
  const serverUrl = useChatStore((s) => s.identity.serverUrl)
  const token = useChatStore((s) => s.identity.token)
  useEffect(() => {
    if (!serverUrl || !token) return
    let lastCount = -1
    const st = useFocusStore.getState()
    if (st.loaded) lastCount = st.sessions.length
    const report = (minutes: number) => {
      void fetch(`${serverUrl}/api/focus/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ minutes, count: 1 }),
      }).catch(() => undefined)
    }
    return useFocusStore.subscribe((s) => {
      if (!s.loaded) return
      if (lastCount < 0) {
        lastCount = s.sessions.length
        return
      }
      if (s.sessions.length > lastCount) {
        const added = s.sessions.slice(lastCount)
        lastCount = s.sessions.length
        for (const sess of added) report(sess.minutes)
      }
    })
  }, [serverUrl, token])
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
