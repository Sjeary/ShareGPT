// CodeMirror 6 扩展: 双链/标签高亮装饰 + [[ 自动补全。
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

// [[目标#子路径|别名]] → 整段加 .cm-wikilink, 并把解析出的目标放进 data-wikilink (供点击跳转)。
const wikilinkMatcher = new MatchDecorator({
  regexp: /(!?)\[\[([^\]\n]+?)\]\]/g,
  decoration: (m) => {
    const target = m[2].split('|')[0].split('#')[0].trim()
    return Decoration.mark({
      class: m[1] === '!' ? 'cm-wikilink cm-wikiembed' : 'cm-wikilink',
      attributes: { 'data-wikilink': target },
    })
  },
})

const tagMatcher = new MatchDecorator({
  regexp: /(?<=^|\s)#[A-Za-z0-9_一-龥/-]+/g,
  decoration: () => Decoration.mark({ class: 'cm-hashtag' }),
})

function decoPlugin(matcher: MatchDecorator) {
  return ViewPlugin.fromClass(
    class {
      deco: DecorationSet
      constructor(view: EditorView) {
        this.deco = matcher.createDeco(view)
      }
      update(u: ViewUpdate) {
        this.deco = matcher.updateDeco(u, this.deco)
      }
    },
    { decorations: (v) => v.deco },
  )
}

export const wikilinkDecorations = [decoPlugin(wikilinkMatcher), decoPlugin(tagMatcher)]

export interface CompletionItem {
  label: string
  detail?: string
}

// [[ 后弹出笔记标题/路径补全。getItems 由调用方提供(读 store 的笔记列表)。
export function wikilinkCompletions(getItems: () => CompletionItem[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\]\n]*$/)
    if (!before) return null
    const typed = before.text.slice(2).toLowerCase()
    const options = getItems()
      .filter((it) => !typed || it.label.toLowerCase().includes(typed))
      .slice(0, 50)
      .map((it) => ({
        label: it.label,
        detail: it.detail,
        type: 'text',
        apply: it.label + ']]',
      }))
    return { from: before.from + 2, options, validFor: /[^\]\n]*$/ }
  }
}

// 点击 [[ ]] 跳转: 在编辑器 DOM 上监听 click, 命中 data-wikilink 则回调。
export function wikilinkClickHandler(onOpen: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      const el = (event.target as HTMLElement)?.closest?.('[data-wikilink]') as HTMLElement | null
      if (el && (event.ctrlKey || event.metaKey || event.button === 0)) {
        const target = el.getAttribute('data-wikilink')
        if (target) {
          // 仅在按住修饰键或单纯点击链接文本时跳转, 避免妨碍正常放置光标
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            onOpen(target)
            return true
          }
        }
      }
      return false
    },
  })
}
