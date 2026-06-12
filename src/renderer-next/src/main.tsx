import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 渲染前据偏好设定主题, 默认深色(品牌深色优先), 避免首帧闪烁。
const savedTheme = (() => {
  try {
    return localStorage.getItem('sharegpt-theme')
  } catch {
    return null
  }
})()
document.documentElement.classList.toggle('dark', savedTheme !== 'light')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
