import { AiWorkspace } from './ai/AiWorkspace'

// 内嵌 Gemini 网页面板 (单视图)。原生 WebContentsView 由主进程管理。
export function GeminiPanel() {
  return <AiWorkspace kind="gemini" />
}
