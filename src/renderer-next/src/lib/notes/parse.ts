// 单篇 .md 解析: frontmatter(YAML) + 标题树 + 块 ^id + 标签 + 双链 → ParsedNote。
import { load as yamlLoad } from 'js-yaml'
import type { VaultFile } from '@/types/api'
import type { BlockRef, Heading, ParsedNote } from './types'
import { parseLinks, stripCode } from './wikilink'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
// 行内标签: 允许字母数字下划线连字符、CJK、嵌套 a/b。前面须是行首或空白。
const TAG_RE = /(?<=^|\s)#([A-Za-z0-9_一-龥-][A-Za-z0-9_一-龥/-]*)/g
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const BLOCK_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/

export function splitFrontmatter(content: string): {
  data: Record<string, unknown>
  body: string
} {
  const m = content.match(FRONTMATTER_RE)
  if (!m) return { data: {}, body: content }
  let data: Record<string, unknown> = {}
  try {
    const parsed = yamlLoad(m[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    data = {}
  }
  return { data, body: content.slice(m[0].length) }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-龥- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function parseHeadings(body: string): Heading[] {
  const scan = stripCode(body)
  const out: Heading[] = []
  scan.split('\n').forEach((line, i) => {
    const m = line.match(HEADING_RE)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i, slug: slugify(m[2]) })
  })
  return out
}

export function parseBlocks(body: string): BlockRef[] {
  const scan = stripCode(body)
  const out: BlockRef[] = []
  scan.split('\n').forEach((line, i) => {
    const m = line.match(BLOCK_RE)
    if (m) out.push({ id: m[1], line: i, text: line.replace(BLOCK_RE, '').trim() })
  })
  return out
}

export function parseTags(body: string, frontmatter: Record<string, unknown>): string[] {
  const set = new Set<string>()
  // frontmatter.tags: string | string[]
  const fmTags = frontmatter.tags
  if (typeof fmTags === 'string') {
    fmTags
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean)
      .forEach((t) => set.add(t))
  } else if (Array.isArray(fmTags)) {
    fmTags.forEach((t) => {
      if (typeof t === 'string' && t.trim()) set.add(t.replace(/^#/, '').trim())
    })
  }
  // 正文 #tag
  const scan = stripCode(body)
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(scan)) !== null) {
    // 纯数字不算标签 (避免 #123 之类)
    if (!/^\d+$/.test(m[1])) set.add(m[1])
  }
  return [...set]
}

function deriveTitle(
  path: string,
  frontmatter: Record<string, unknown>,
  headings: Heading[],
): string {
  const fmTitle = frontmatter.title
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim()
  const h1 = headings.find((h) => h.level === 1)
  if (h1) return h1.text
  const base = path.split('/').pop() || path
  return base.replace(/\.(md|markdown)$/i, '')
}

export function parseNote(file: VaultFile): ParsedNote {
  const { data, body } = splitFrontmatter(file.content)
  const headings = parseHeadings(body)
  const blocks = parseBlocks(body)
  const tags = parseTags(body, data)
  const links = parseLinks(body)
  const title = deriveTitle(file.path, data, headings)
  return {
    path: file.path,
    title,
    frontmatter: data,
    tags,
    body,
    headings,
    blocks,
    links,
    mtime: file.mtime,
    ctime: file.ctime,
  }
}
