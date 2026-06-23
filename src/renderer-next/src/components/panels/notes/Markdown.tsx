import { useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { linkDisplay } from '@/lib/notes/wikilink'

// 与 parse.ts 的 slugify 保持一致, 供大纲滚动定位 (id = h-<slug>)。
function nodeText(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in node) return nodeText((node as { props: { children?: ReactNode } }).props.children)
  return ''
}
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-龥- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// 把 Obsidian 扩展语法降级为标准 markdown, 以便 react-markdown 渲染:
//  [[t#s|a]] -> [显示](#wiki/编码(t))   ![[t]] -> [📎 t](#embed/编码(t))   #tag -> [#tag](#tag/tag)
function preprocess(src: string): string {
  let out = src
  // 先处理嵌入 (带 !), 再处理普通双链
  out = out.replace(/!\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const target = inner.split('|')[0].split('#')[0].trim()
    return `[📎 ${inner.replace(/\|/g, ' · ')}](#embed/${encodeURIComponent(target)})`
  })
  out = out.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [targetPart, aliasPart] = inner.split('|')
    const [target, sub] = targetPart.split('#')
    const display = linkDisplay(target.trim(), (sub || '').trim(), (aliasPart || '').trim())
    return `[${display}](#wiki/${encodeURIComponent(target.trim())})`
  })
  // 行内标签 (#tag, 非标题): 标题是 "# " 带空格, 不会命中。
  out = out.replace(/(^|\s)#([A-Za-z0-9_一-龥/-]+)/g, (_m, pre: string, tag: string) => {
    if (/^\d+$/.test(tag)) return `${pre}#${tag}`
    return `${pre}[#${tag}](#tag/${encodeURIComponent(tag)})`
  })
  return out
}

export interface MarkdownProps {
  content: string
  onOpenLink?: (target: string) => void
  onOpenTag?: (tag: string) => void
  className?: string
}

export function Markdown({ content, onOpenLink, onOpenTag, className }: MarkdownProps) {
  const processed = useMemo(() => preprocess(content), [content])

  const components: Components = useMemo(
    () => ({
      a({ href, children }) {
        const url = href || ''
        if (url.startsWith('#wiki/') || url.startsWith('#embed/')) {
          const target = decodeURIComponent(url.replace(/^#(wiki|embed)\//, ''))
          return (
            <button
              type="button"
              className="cursor-pointer rounded px-0.5 font-medium text-primary transition-colors hover:bg-primary/10 hover:underline"
              onClick={() => onOpenLink?.(target)}
            >
              {children as ReactNode}
            </button>
          )
        }
        if (url.startsWith('#tag/')) {
          const tag = decodeURIComponent(url.replace('#tag/', ''))
          return (
            <button
              type="button"
              className="cursor-pointer rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.85em] font-medium text-primary/90 transition-colors hover:bg-primary/20"
              onClick={() => onOpenTag?.(tag)}
            >
              {children as ReactNode}
            </button>
          )
        }
        return (
          <a
            className="text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.preventDefault()
              if (url) void api.openExternal(url)
            }}
            href={url}
          >
            {children as ReactNode}
          </a>
        )
      },
      h1: ({ children }) => (
        <h1 id={`h-${slugify(nodeText(children))}`} className="mb-3 mt-6 scroll-mt-4 border-b border-border pb-1 text-2xl font-bold">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 id={`h-${slugify(nodeText(children))}`} className="mb-2 mt-5 scroll-mt-4 text-xl font-bold">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 id={`h-${slugify(nodeText(children))}`} className="mb-2 mt-4 scroll-mt-4 text-lg font-semibold">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 id={`h-${slugify(nodeText(children))}`} className="mb-1 mt-3 scroll-mt-4 font-semibold">
          {children}
        </h4>
      ),
      p: ({ children }) => <p className="my-2.5 leading-7">{children}</p>,
      ul: ({ children }) => <ul className="my-2.5 ml-5 list-disc space-y-1">{children}</ul>,
      ol: ({ children }) => <ol className="my-2.5 ml-5 list-decimal space-y-1">{children}</ol>,
      li: ({ children }) => <li className="leading-7">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-3 border-l-4 border-primary/40 bg-muted/40 py-1 pl-4 text-muted-foreground">
          {children}
        </blockquote>
      ),
      code: ({ className: c, children }) => {
        const isBlock = /language-/.test(c || '')
        if (isBlock) return <code className={cn('text-[0.9em]', c)}>{children}</code>
        return (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-primary">
            {children}
          </code>
        )
      },
      pre: ({ children }) => (
        <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-sm">
          {children}
        </pre>
      ),
      hr: () => <hr className="my-5 border-border" />,
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-border bg-muted/50 px-3 py-1.5 text-left font-semibold">
          {children}
        </th>
      ),
      td: ({ children }) => <td className="border border-border px-3 py-1.5">{children}</td>,
      img: ({ src, alt }) => (
        <img src={typeof src === 'string' ? src : ''} alt={alt || ''} className="my-2 max-w-full rounded-lg" />
      ),
    }),
    [onOpenLink, onOpenTag],
  )

  return (
    <div className={cn('text-[15px] text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}
