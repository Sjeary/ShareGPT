// 知识库笔记的共享类型 (渲染层)。一篇 .md 解析后的内存表示 + 索引派生结构。

export interface Heading {
  level: number // 1..6
  text: string
  line: number // 0-based
  slug: string
}

export interface BlockRef {
  id: string // ^id 中的 id
  line: number
  text: string
}

// 一条双链/嵌入引用 (解析自正文)。
export interface LinkRef {
  raw: string // 原始片段, 如 "[[A#标题|别名]]"
  target: string // # 与 | 之前的目标文本
  subpath: string // # 之后 (标题或 ^块id), 不含 #
  alias: string // | 之后的显示文本
  embed: boolean // ![[ ]] => true
  line: number
}

export interface ResolvedLink extends LinkRef {
  targetPath: string | null // 解析到的目标 vault 路径; null = 未解析
}

export interface ParsedNote {
  path: string // vault 内相对路径 (正斜杠), 即 id
  title: string
  frontmatter: Record<string, unknown>
  tags: string[] // frontmatter.tags ∪ 正文 #tag (含嵌套 a/b)
  body: string // 去掉 frontmatter 的 markdown
  headings: Heading[]
  blocks: BlockRef[]
  links: LinkRef[]
  mtime: number
  ctime: number
}

export interface BacklinkHit {
  fromPath: string
  fromTitle: string
  line: number
  context: string // 来源行原文 (片段)
  subpath: string
}

export interface TagCount {
  tag: string
  count: number
}

export interface UnresolvedRef {
  text: string
  from: string[] // 引用它的笔记 path
}

export interface GraphNode {
  id: string // path
  title: string
  degree: number
  tags: string[]
  folder: string
}
export interface GraphLink {
  source: string
  target: string
}
export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface SearchHit {
  path: string
  title: string
  score: number
  snippet: string
}
