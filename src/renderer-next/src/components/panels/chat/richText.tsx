import { Fragment, type ReactNode } from 'react'
import { api } from '@/lib/api'

// 聊天正文富文本渲染 (移植自旧 renderer.js renderMessageRichText ~544 / extractFirstUrl ~539 /
// buildMessageLinkPreview ~574)。
// 支持: ```代码块``` / `行内代码` / **粗体** / __斜体__ / http 链接(可点, 走 api.openExternal) / \n 换行。
// React 实现以受控节点替代旧版 innerHTML, 避免 XSS 且无需手动 escape。

const URL_RE = /https?:\/\/[^\s<]+/i

export function extractFirstUrl(text: string): string {
  const match = String(text || '').match(URL_RE)
  return match ? match[0] : ''
}

function openUrl(url: string) {
  void Promise.resolve(api.openExternal(url)).catch(() => undefined)
}

// 行内片段: `行内代码` / **粗体** / __斜体__ / http 链接 / 纯文本。
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // 优先级与旧版一致: 行内代码 > 粗体 > 斜体 > 链接。
  const pattern =
    /(`[^`\n]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(https?:\/\/[^\s<]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <Fragment key={`${keyPrefix}-t${i}`}>{text.slice(last, m.index)}</Fragment>,
      )
    }
    const token = m[0]
    const key = `${keyPrefix}-m${i}`
    if (m[1]) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else if (m[2]) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (m[3]) {
      nodes.push(<em key={key}>{token.slice(2, -2)}</em>)
    } else {
      nodes.push(
        <a
          key={key}
          href={token}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openUrl(token)
          }}
          className="break-all underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current"
        >
          {token}
        </a>,
      )
    }
    last = m.index + token.length
    i += 1
  }
  if (last < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-tail`}>{text.slice(last)}</Fragment>)
  }
  return nodes
}

// 把一段含 \n 的纯/行内文本渲染为带 <br> 的节点。
function renderWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  lines.forEach((line, idx) => {
    if (idx > 0) out.push(<br key={`${keyPrefix}-br${idx}`} />)
    out.push(...renderInline(line, `${keyPrefix}-l${idx}`))
  })
  return out
}

// 渲染聊天正文: 先抽取 ```代码块```, 其余按行内+换行渲染。
export function renderMessageRichText(text: string): ReactNode {
  const source = String(text || '')
  if (!source.trim()) return null

  const nodes: ReactNode[] = []
  const blockRe = /```([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = blockRe.exec(source)) !== null) {
    if (m.index > last) {
      nodes.push(
        ...renderWithBreaks(source.slice(last, m.index), `seg${i}`),
      )
    }
    nodes.push(
      <pre
        key={`code${i}`}
        className="my-1 overflow-x-auto rounded-md bg-foreground/10 px-2.5 py-2 font-mono text-[0.85em] [overflow-wrap:anywhere]"
      >
        <code>{m[1].trim()}</code>
      </pre>,
    )
    last = m.index + m[0].length
    i += 1
  }
  if (last < source.length) {
    nodes.push(...renderWithBreaks(source.slice(last), `seg${i}`))
  }
  return nodes
}

// 链接预览卡数据 (移植自旧 buildMessageLinkPreview ~574)。
export interface MessageLinkPreview {
  url: string
  host: string
}

export function buildMessageLinkPreview(rawUrl: string): MessageLinkPreview | null {
  const url = (rawUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return null
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    /* 非法 URL: 退回原文 */
  }
  return { url, host: host || '链接' }
}

// 打开链接 (点击预览卡 / 链接走 api.openExternal)。
export function openMessageUrl(url: string): void {
  openUrl(url)
}
