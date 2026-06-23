// 双链/嵌入解析 + 目标解析 (Obsidian「最短唯一路径」规则)。
import type { LinkRef } from './types'

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g

// 去掉围栏代码块与行内代码, 避免把代码里的 [[ / #tag 误判为链接/标签。
export function stripCode(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

// 把 [[目标#子路径|别名]] 拆开。
function splitLink(inner: string): { target: string; subpath: string; alias: string } {
  let rest = inner
  let alias = ''
  const pipe = rest.indexOf('|')
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim()
    rest = rest.slice(0, pipe)
  }
  let subpath = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    subpath = rest.slice(hash + 1).trim()
    rest = rest.slice(0, hash)
  }
  return { target: rest.trim(), subpath, alias }
}

export function parseLinks(body: string): LinkRef[] {
  const scan = stripCode(body)
  const lines = scan.split('\n')
  const out: LinkRef[] = []
  lines.forEach((lineText, lineIdx) => {
    WIKILINK_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIKILINK_RE.exec(lineText)) !== null) {
      const embed = m[1] === '!'
      const { target, subpath, alias } = splitLink(m[2])
      if (!target && !subpath) continue
      out.push({ raw: m[0], target, subpath, alias, embed, line: lineIdx })
    }
  })
  return out
}

function stripExt(p: string): string {
  return p.replace(/\.(md|markdown)$/i, '')
}

// 由全部笔记路径建解析器: 优先完整相对路径命中, 否则按 basename, 多义时取最短路径。
export function buildResolver(paths: string[]): (linkText: string) => string | null {
  const byFull = new Map<string, string>()
  const byBase = new Map<string, string[]>()
  for (const p of paths) {
    const noExt = stripExt(p).toLowerCase()
    byFull.set(noExt, p)
    const base = noExt.split('/').pop() || noExt
    const arr = byBase.get(base)
    if (arr) arr.push(p)
    else byBase.set(base, [p])
  }
  return (linkText: string): string | null => {
    const t = stripExt(linkText.trim()).toLowerCase()
    if (!t) return null
    const full = byFull.get(t)
    if (full) return full
    const base = t.split('/').pop() || t
    const arr = byBase.get(base)
    if (!arr || arr.length === 0) return null
    if (arr.length === 1) return arr[0]
    return [...arr].sort((a, b) => a.length - b.length)[0]
  }
}

// 由目标 + 别名得到显示文本。
export function linkDisplay(target: string, subpath: string, alias: string): string {
  if (alias) return alias
  if (subpath && !target) return subpath
  if (subpath) return `${target} › ${subpath}`
  return target
}
