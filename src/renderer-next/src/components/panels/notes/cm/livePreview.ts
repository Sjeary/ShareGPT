// Obsidian 风格 Live Preview: 光标不在的行隐藏 markdown 记号 (#, **, `, ~~, 引用 >), 并把 [[双链]] 渲染成可点胶囊。
// 光标所在行显示原始语法以便编辑。基于 lezer markdown 语法树 + 文本扫描双链。
import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { linkDisplay } from '@/lib/notes/wikilink'

const HIDE = Decoration.replace({})

class WikiLinkWidget extends WidgetType {
  target: string
  display: string
  embed: boolean
  onOpen: (t: string) => void
  constructor(target: string, display: string, embed: boolean, onOpen: (t: string) => void) {
    super()
    this.target = target
    this.display = display
    this.embed = embed
    this.onOpen = onOpen
  }
  eq(o: WikiLinkWidget) {
    return o.target === this.target && o.display === this.display && o.embed === this.embed
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-wikilink' + (this.embed ? ' cm-wikiembed' : '')
    s.textContent = this.display
    s.setAttribute('data-wikilink', this.target)
    s.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.onOpen(this.target)
    })
    return s
  }
  ignoreEvent() {
    return false
  }
}

const WIKI_RE = /(!?)\[\[([^\]\n]+?)\]\]/g
const HIDE_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'QuoteMark',
])

function cursorLines(view: EditorView): Set<number> {
  const s = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number
    const b = view.state.doc.lineAt(r.to).number
    for (let l = a; l <= b; l++) s.add(l)
  }
  return s
}

export function livePreview(onOpen: (target: string) => void) {
  const build = (view: EditorView): DecorationSet => {
    const cur = cursorLines(view)
    const doc = view.state.doc
    const items: { from: number; to: number; deco: Decoration }[] = []

    for (const { from, to } of view.visibleRanges) {
      // 1) 隐藏 markdown 记号 (非光标行)
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (node) => {
          if (!HIDE_MARKS.has(node.name)) return
          const line = doc.lineAt(node.from).number
          if (cur.has(line)) return
          let end = node.to
          if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
            while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++
          }
          if (end > node.from) items.push({ from: node.from, to: end, deco: HIDE })
        },
      })
      // 2) [[双链]] → 胶囊 widget (非光标行)
      const text = doc.sliceString(from, to)
      WIKI_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = WIKI_RE.exec(text)) !== null) {
        const start = from + m.index
        const fin = start + m[0].length
        if (cur.has(doc.lineAt(start).number)) continue
        const inner = m[2]
        const [targetPart, aliasPart] = inner.split('|')
        const [target, sub] = targetPart.split('#')
        const display = linkDisplay(target.trim(), (sub || '').trim(), (aliasPart || '').trim())
        items.push({
          from: start,
          to: fin,
          deco: Decoration.replace({
            widget: new WikiLinkWidget(target.trim(), display, m[1] === '!', onOpen),
          }),
        })
      }
    }

    items.sort((a, b) => a.from - b.from || a.to - b.to)
    const builder = new RangeSetBuilder<Decoration>()
    let lastTo = -1
    for (const it of items) {
      if (it.from < lastTo) continue // 防止区间重叠
      builder.add(it.from, it.to, it.deco)
      lastTo = it.to
    }
    return builder.finish()
  }

  return ViewPlugin.fromClass(
    class {
      deco: DecorationSet
      constructor(view: EditorView) {
        this.deco = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) this.deco = build(u.view)
      }
    },
    { decorations: (v) => v.deco },
  )
}
