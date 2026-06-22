import { useEffect, useState } from 'react'

// 观察 <html> 上的 .dark 类, 返回当前是否深色 (便签底色随主题切换需要)。
// 主题切换在 useAppStore 里 toggle documentElement 的 class, 这里用 MutationObserver 跟随。
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}
