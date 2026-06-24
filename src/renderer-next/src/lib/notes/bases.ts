// Bases (.base, YAML) 的轻量子集: 对 vault 笔记按 frontmatter/标签/文件夹过滤, 以表格/看板呈现。
import { load as yamlLoad } from 'js-yaml'

export interface BaseView {
  name: string
  type: 'table' | 'board'
  filterTag?: string
  filterFolder?: string
  columns: string[] // 内置: title/tags/path/mtime; 其余视作 frontmatter 字段
  groupBy?: string // board 用 (frontmatter 字段或 'tags')
}
export interface BaseDoc {
  views: BaseView[]
}

const DEFAULT: BaseDoc = {
  views: [{ name: '全部', type: 'table', columns: ['title', 'tags', 'mtime'] }],
}

export function parseBase(raw: string): BaseDoc {
  try {
    const j = yamlLoad(raw) as Record<string, unknown> | null
    const rawViews =
      j && Array.isArray((j as { views?: unknown[] }).views)
        ? (j as { views: unknown[] }).views
        : []
    const views: BaseView[] = rawViews
      .map((v): BaseView | null => {
        if (!v || typeof v !== 'object') return null
        const o = v as Record<string, unknown>
        const filter = (o.filter || {}) as Record<string, unknown>
        return {
          name: typeof o.name === 'string' ? o.name : '视图',
          type: o.type === 'board' ? 'board' : 'table',
          filterTag: typeof filter.tag === 'string' ? filter.tag : undefined,
          filterFolder: typeof filter.folder === 'string' ? filter.folder : undefined,
          columns: Array.isArray(o.columns)
            ? (o.columns as unknown[]).filter((c): c is string => typeof c === 'string')
            : ['title', 'tags', 'mtime'],
          groupBy: typeof o.groupBy === 'string' ? o.groupBy : undefined,
        }
      })
      .filter((v): v is BaseView => v !== null)
    return views.length ? { views } : DEFAULT
  } catch {
    return DEFAULT
  }
}

export const STARTER_BASE = `# Bases 视图定义 (YAML)
views:
  - name: 全部笔记
    type: table
    columns: [title, tags, mtime]
  # 示例: 按标签过滤 + 看板分组
  # - name: 项目看板
  #   type: board
  #   filter:
  #     tag: project
  #   groupBy: status
  #   columns: [title, status, mtime]
`
