import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'

// 编辑器桥: 让 AI 功能读取当前选区并以「可撤销的事务」替换内容 (Ctrl+Z 可撤回)。
interface Selection {
  from: number
  to: number
  text: string
}
export interface AiEdit {
  id: number
  view: EditorView
  doc: EditorView['state']['doc']
  open: boolean
  from: number
  to: number
  original: string
  anchor: { x: number; y: number }
}

interface EditorBridgeState {
  view: EditorView | null
  selection: Selection
  aiEdit: AiEdit | null
  setView: (v: EditorView | null) => void
  setSelection: (s: Selection) => void
  openAiEdit: () => void
  closeAiEdit: () => void
  replaceRange: (target: AiEdit, text: string) => boolean
}

let nextAiEditId = 0
export const useEditorBridge = create<EditorBridgeState>((set, get) => ({
  view: null,
  selection: { from: 0, to: 0, text: '' },
  aiEdit: null,
  setView: (view) => {
    if (view !== get().view) set({ view, aiEdit: null, selection: { from: 0, to: 0, text: '' } })
  },
  setSelection: (selection) =>
    set((state) => ({
      selection,
      aiEdit: state.aiEdit && state.view?.state.doc !== state.aiEdit.doc ? null : state.aiEdit,
    })),
  openAiEdit: () => {
    const view = get().view
    if (!view) return
    const sel = view.state.selection.main
    const original = view.state.sliceDoc(sel.from, sel.to)
    let anchor = { x: window.innerWidth / 2 - 220, y: 160 }
    try {
      const c = view.coordsAtPos(sel.to)
      if (c) anchor = { x: Math.max(12, c.left), y: c.bottom + 6 }
    } catch {
      /* fallback */
    }
    set({
      aiEdit: {
        id: ++nextAiEditId,
        view,
        doc: view.state.doc,
        open: true,
        from: sel.from,
        to: sel.to,
        original,
        anchor,
      },
    })
  },
  closeAiEdit: () => set({ aiEdit: null }),
  replaceRange: (target, text) => {
    const { view, aiEdit } = get()
    if (!view || aiEdit !== target || view !== target.view || view.state.doc !== target.doc)
      return false
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: text },
      selection: { anchor: target.from + text.length },
    })
    view.focus()
    return true
  },
}))
