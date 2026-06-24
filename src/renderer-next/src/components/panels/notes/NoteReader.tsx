import { useMemo } from 'react'
import { Markdown } from './Markdown'
import { useVaultStore } from '@/store/useVaultStore'
import type { ParsedNote } from '@/lib/notes/types'

// 阅读模式: 在交给 Markdown 渲染前, 把 ![[ ]] 嵌入/转写就地展开为引用块 (笔记 / 章节 / 块)。
// 非递归 (展开内容里的 ![[ ]] 被剥除), 避免循环嵌入。

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w一-龥- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// 取某标题下的章节 (到下一个同级或更高级标题为止)。
function extractSection(note: ParsedNote, sub: string): string {
  const want = slugify(sub)
  const h = note.headings.find((x) => slugify(x.text) === want || x.text === sub)
  if (!h) return `(未找到章节 “${sub}”)`
  const lines = note.body.split('\n')
  const next = note.headings.find((x) => x.line > h.line && x.level <= h.level)
  const end = next ? next.line : lines.length
  return lines.slice(h.line, end).join('\n')
}

function asQuote(header: string, content: string): string {
  const stripped = content.replace(/!\[\[[^\]\n]+?\]\]/g, '').trimEnd()
  const body = stripped
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n')
  return `> **${header}**\n>\n${body}\n`
}

export function NoteReader({ body }: { body: string }) {
  const notesByPath = useVaultStore((s) => s.notesByPath)
  const index = useVaultStore((s) => s.index)
  const setQuery = (q: string) =>
    import('@/store/useNotesUi').then((m) => m.useNotesUi.getState().setQuery(q))
  const openNote = useVaultStore((s) => s.openNote)

  const expanded = useMemo(() => {
    return body.replace(/!\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
      const targetPart = inner.split('|')[0]
      const [target, sub] = targetPart.split('#')
      const t = target.trim()
      // 图片附件: 转成标准 markdown 图片, 由 VaultImage 经主进程读成 dataURL 展示。
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(t)) return `![${t}](${encodeURIComponent(t)})`
      if (/\.pdf$/i.test(t)) return `> 📎 PDF 附件：${inner}`
      const path = index?.resolve(t) ?? null
      if (!path) return `> ⚠️ 未找到嵌入：[[${inner}]]`
      const note = notesByPath[path]
      if (!note) return `> ⚠️ 未找到：[[${inner}]]`
      const s = (sub || '').trim()
      let content: string
      let label = t
      if (s.startsWith('^')) {
        const id = s.slice(1).trim()
        const block = note.blocks.find((b) => b.id === id)
        content = block ? block.text : `(块 ^${id} 未找到)`
        label = `${t} › ^${id}`
      } else if (s) {
        content = extractSection(note, s)
        label = `${t} › ${s}`
      } else {
        content = note.body
      }
      return asQuote(`📎 ${label}`, content)
    })
  }, [body, notesByPath, index])

  return (
    <Markdown
      content={expanded}
      onOpenLink={(target) => {
        const p = index?.resolve(target) ?? null
        if (p) void openNote(p)
        else void useVaultStore.getState().createNote(target)
      }}
      onOpenTag={(tag) => void setQuery(`tag:${tag}`)}
    />
  )
}
