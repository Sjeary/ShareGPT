// CodeMirror 6 主题: 跟随 app 的 CSS 变量(明暗自适应), 双链/标签/标题等高亮。
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    height: '100%',
    fontSize: '15px',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    fontFamily:
      'ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    lineHeight: '1.75',
    padding: '20px 28px 40% 28px',
    maxWidth: '860px',
    margin: '0 auto',
  },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)',
  },
  '.cm-wikilink': {
    color: 'var(--primary)',
    textDecoration: 'none',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: '0 1px',
  },
  '.cm-wikilink:hover': {
    textDecoration: 'underline',
    backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)',
  },
  '.cm-wikiembed': { fontStyle: 'italic' },
  '.cm-hashtag': {
    color: 'color-mix(in oklch, var(--primary) 80%, var(--foreground))',
    backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)',
    borderRadius: '999px',
    padding: '1px 6px',
    fontSize: '0.92em',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 40%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
})

// markdown 语法高亮 (标题/加粗/斜体/代码/引用等)。
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--primary)' },
  { tag: t.url, color: 'var(--primary)' },
  { tag: [t.monospace], fontFamily: 'ui-monospace, monospace', color: 'var(--primary)' },
  { tag: t.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--foreground)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--muted-foreground)' },
])

export const editorHighlighting = syntaxHighlighting(mdHighlight)
