import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'

// 编辑器桥: 让 AI 功能读取当前选区并以「可撤销的事务」替换内容 (Ctrl+Z 可撤回)。
interface Selection {
  from: number
  to: number
  text: string
}
interface AiEdit {
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
  replaceRange: (from: number, to: number, text: string) => void
}

export const useEditorBridge = create<EditorBridgeState>((set, get) => ({
  view: null,
  selection: { from: 0, to: 0, text: '' },
  aiEdit: null,
  setView: (view) => set({ view }),
  setSelection: (selection) => set({ selection }),
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
    set({ aiEdit: { open: true, from: sel.from, to: sel.to, original, anchor } })
  },
  closeAiEdit: () => set({ aiEdit: null }),
  replaceRange: (from, to, text) => {
    const view = get().view
    if (!view) return
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  },
}))
