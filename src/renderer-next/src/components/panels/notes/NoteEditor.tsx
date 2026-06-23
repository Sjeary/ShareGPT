import { useEffect, useRef } from 'react'
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { editorHighlighting, editorTheme } from './cm/theme'
import { wikilinkCompletions, tagDecorations } from './cm/wikilink'
import { livePreview } from './cm/livePreview'
import { useVaultStore } from '@/store/useVaultStore'

// 基于 CodeMirror 6 的 markdown 编辑器: 双链高亮/补全/点击跳转 + 自动换行 + 历史。
// 由父组件用 key={path} 控制, 切换笔记即重挂载, 初始内容取 store.draft。
export function NoteEditor({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 用 ref 持有最新回调, 避免 CM 闭包拿到过期函数。
  const setDraft = useVaultStore((s) => s.setDraft)
  const setDraftRef = useRef(setDraft)
  useEffect(() => {
    setDraftRef.current = setDraft
  }, [setDraft])

  useEffect(() => {
    if (!hostRef.current) return
    const initial = useVaultStore.getState().draft

    const completionSource = wikilinkCompletions(() =>
      Object.values(useVaultStore.getState().notesByPath).map((n) => ({
        label: n.title,
        detail: n.path,
      })),
    )

    const openLink = (target: string) => {
      const store = useVaultStore.getState()
      const resolved = store.index?.resolve(target) ?? null
      if (resolved) void store.openNote(resolved)
      else void store.createNote(target)
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown(),
          editorTheme,
          editorHighlighting,
          autocompletion({ override: [completionSource] }),
          livePreview(openLink),
          tagDecorations,
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setDraftRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // path 变化由父级 key 触发重挂载; 这里只在挂载时建一次。
  }, [path])

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
}
