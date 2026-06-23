import { create } from 'zustand'
import { api } from '@/lib/api'
import type { VaultChangeEvent, VaultFileMeta, VaultImportReport } from '@/types/api'
import { NotesIndex } from '@/lib/notes'
import { parseNote } from '@/lib/notes/parse'
import type { ParsedNote } from '@/lib/notes/types'

// 知识库主 store: 持有 vault 根、各笔记磁盘内容/解析结果、全库索引、当前打开的笔记与编辑缓冲。
// 真源在磁盘 (主进程 vault); 本 store 是其内存镜像 + 派生索引。保存防抖落盘后重建索引。

interface VaultState {
  loaded: boolean
  root: string
  rawByPath: Record<string, string> // 磁盘原文 (含 frontmatter)
  notesByPath: Record<string, ParsedNote>
  fileList: VaultFileMeta[]
  index: NotesIndex | null
  indexVersion: number
  currentPath: string | null
  draft: string // 当前笔记编辑缓冲 (整文件内容)
  dirty: boolean
  busy: boolean

  init: () => Promise<void>
  reload: () => Promise<void>
  openNote: (path: string) => Promise<void>
  setDraft: (content: string) => void
  saveCurrent: () => Promise<void>
  createNote: (path: string, content?: string) => Promise<string>
  renameNote: (from: string, to: string) => Promise<void>
  deleteNote: (path: string) => Promise<void>
  setRootViaDialog: () => Promise<boolean>
  importVault: () => Promise<VaultImportReport | null>
  applyExternalChanges: (payload: VaultChangeEvent) => Promise<void>
}

function rebuild(notesByPath: Record<string, ParsedNote>): NotesIndex {
  return new NotesIndex(Object.values(notesByPath))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useVaultStore = create<VaultState>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void get().saveCurrent()
    }, 600)
  }

  return {
    loaded: false,
    root: '',
    rawByPath: {},
    notesByPath: {},
    fileList: [],
    index: null,
    indexVersion: 0,
    currentPath: null,
    draft: '',
    dirty: false,
    busy: false,

    init: async () => {
      if (get().loaded) return
      try {
        await api.vault.start()
      } catch {
        /* 监听不可用不致命 */
      }
      let root = ''
      try {
        root = await api.vault.getRoot()
      } catch {
        root = ''
      }
      set({ root })
      await get().reload()
      set({ loaded: true })
    },

    reload: async () => {
      set({ busy: true })
      try {
        const [fileList, files] = await Promise.all([api.vault.list(), api.vault.readAll()])
        const rawByPath: Record<string, string> = {}
        const notesByPath: Record<string, ParsedNote> = {}
        for (const f of files) {
          rawByPath[f.path] = f.content
          notesByPath[f.path] = parseNote(f)
        }
        const index = rebuild(notesByPath)
        const cur = get().currentPath
        const keepCur = cur && notesByPath[cur] ? cur : null
        set((s) => ({
          fileList,
          rawByPath,
          notesByPath,
          index,
          indexVersion: s.indexVersion + 1,
          currentPath: keepCur,
          draft: keepCur ? rawByPath[keepCur] : '',
          dirty: false,
        }))
      } finally {
        set({ busy: false })
      }
    },

    openNote: async (path) => {
      // 保存上一篇未落盘的改动
      if (get().dirty && get().currentPath) await get().saveCurrent()
      let content = get().rawByPath[path]
      if (content === undefined) {
        try {
          const f = await api.vault.read(path)
          content = f.content
          set((s) => ({ rawByPath: { ...s.rawByPath, [path]: content } }))
        } catch {
          content = ''
        }
      }
      set({ currentPath: path, draft: content, dirty: false })
    },

    setDraft: (content) => {
      set({ draft: content, dirty: true })
      scheduleSave()
    },

    saveCurrent: async () => {
      const { currentPath, draft } = get()
      if (!currentPath) return
      await api.vault.write(currentPath, draft)
      const parsed = parseNote({ path: currentPath, content: draft, mtime: Date.now(), ctime: Date.now() })
      set((s) => {
        const notesByPath = { ...s.notesByPath, [currentPath]: parsed }
        const rawByPath = { ...s.rawByPath, [currentPath]: draft }
        return {
          notesByPath,
          rawByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
          dirty: false,
        }
      })
    },

    createNote: async (path, content = '') => {
      let p = path.trim()
      if (!/\.(md|markdown)$/i.test(p)) p += '.md'
      const f = await api.vault.create(p, content)
      const parsed = parseNote(f)
      set((s) => {
        const notesByPath = { ...s.notesByPath, [f.path]: parsed }
        const rawByPath = { ...s.rawByPath, [f.path]: f.content }
        return {
          notesByPath,
          rawByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
        }
      })
      await get().openNote(f.path)
      return f.path
    },

    renameNote: async (from, to) => {
      let target = to.trim()
      if (!/\.(md|markdown)$/i.test(target)) target += '.md'
      await api.vault.rename(from, target)
      const fromContent = get().rawByPath[from] ?? ''
      set((s) => {
        const rawByPath = { ...s.rawByPath }
        const notesByPath = { ...s.notesByPath }
        delete rawByPath[from]
        delete notesByPath[from]
        rawByPath[target] = fromContent
        notesByPath[target] = parseNote({ path: target, content: fromContent, mtime: Date.now(), ctime: Date.now() })
        return {
          rawByPath,
          notesByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
          currentPath: s.currentPath === from ? target : s.currentPath,
        }
      })
    },

    deleteNote: async (path) => {
      await api.vault.remove(path)
      set((s) => {
        const rawByPath = { ...s.rawByPath }
        const notesByPath = { ...s.notesByPath }
        delete rawByPath[path]
        delete notesByPath[path]
        const wasCurrent = s.currentPath === path
        return {
          rawByPath,
          notesByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
          currentPath: wasCurrent ? null : s.currentPath,
          draft: wasCurrent ? '' : s.draft,
          dirty: wasCurrent ? false : s.dirty,
        }
      })
    },

    setRootViaDialog: async () => {
      const picked = await api.vault.pickFolder()
      if (!picked) return false
      const res = await api.vault.setRoot(picked)
      set({ root: res.root })
      await get().reload()
      return true
    },

    importVault: async () => {
      const picked = await api.vault.pickFolder()
      if (!picked) return null
      set({ busy: true })
      try {
        const report = await api.vault.importFrom(picked)
        await get().reload()
        return report
      } finally {
        set({ busy: false })
      }
    },

    applyExternalChanges: async (payload) => {
      const events = payload?.events ?? []
      if (!events.length) return
      const { currentPath, dirty } = get()
      const rawByPath = { ...get().rawByPath }
      const notesByPath = { ...get().notesByPath }
      let changed = false
      for (const ev of events) {
        // 当前正在编辑且有未保存改动 → 跳过, 避免覆盖 (留待同步/手动处理)
        if (ev.path === currentPath && dirty) continue
        if (ev.type === 'unlink') {
          if (notesByPath[ev.path]) {
            delete rawByPath[ev.path]
            delete notesByPath[ev.path]
            changed = true
          }
        } else {
          try {
            const f = await api.vault.read(ev.path)
            rawByPath[f.path] = f.content
            notesByPath[f.path] = parseNote(f)
            changed = true
          } catch {
            /* 文件可能已被删 */
          }
        }
      }
      if (!changed) return
      set((s) => ({
        rawByPath,
        notesByPath,
        index: rebuild(notesByPath),
        indexVersion: s.indexVersion + 1,
        draft:
          currentPath && rawByPath[currentPath] !== undefined && !s.dirty
            ? rawByPath[currentPath]
            : s.draft,
      }))
    },
  }
})
