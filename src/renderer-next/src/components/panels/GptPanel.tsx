import { AiWorkspace } from './ai/AiWorkspace'

// 内嵌 ChatGPT 网页面板 (多标签)。原生 WebContentsView 由主进程管理。
export function GptPanel() {
  return <AiWorkspace kind="gpt" />
}
