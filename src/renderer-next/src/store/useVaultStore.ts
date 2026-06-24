import { create } from 'zustand'
import { api } from '@/lib/api'
import type { VaultChangeEvent, VaultFileMeta, VaultImportReport } from '@/types/api'
import { dump as yamlDump } from 'js-yaml'
import { NotesIndex } from '@/lib/notes'
import { parseNote, splitFrontmatter } from '@/lib/notes/parse'
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
  moveToFolder: (from: string, folder: string) => Promise<void>
  renameFolder: (oldPrefix: string, newPrefix: string) => Promise<void>
  deleteFolder: (prefix: string) => Promise<void>
  setFrontmatter: (path: string, data: Record<string, unknown>) => Promise<void>
  batchAppend: (items: { path: string; text: string }[]) => Promise<void>
  openToday: () => Promise<void>
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
        /* 取不到 root 则保持空串 */
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
          // 保留「正在编辑且未保存」的草稿, 避免被外部刷新/同步合并覆盖丢失。
          draft: keepCur ? (s.dirty ? s.draft : rawByPath[keepCur]) : '',
          dirty: keepCur ? s.dirty : false,
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
      // 无扩展名才补 .md; 保留 .canvas / .base 等已有扩展。
      if (!/\.[a-z0-9]+$/i.test(p)) p += '.md'
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
      // 无扩展名才补 .md; 保留 .canvas/.base 等已有扩展。
      if (!/\.[a-z0-9]+$/i.test(target)) target += '.md'
      // basename 变化时, 改写所有指向它的入链 [[oldBase]] -> [[newBase]] (保留 #子路径/|别名)。
      const baseOf = (p: string) => (p.split('/').pop() || p).replace(/\.(md|markdown)$/i, '')
      const oldBase = baseOf(from)
      const newBase = baseOf(target)
      if (oldBase !== newBase && /\.(md|markdown)$/i.test(from)) {
        const esc = oldBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`(\\[\\[)${esc}(?=[\\]#|])`, 'g')
        const inbound = [...new Set((get().index?.backlinks(from) ?? []).map((h) => h.fromPath))]
        for (const p of inbound) {
          const raw = get().rawByPath[p]
          if (!raw) continue
          const next = raw.replace(re, `$1${newBase}`)
          if (next !== raw) await api.vault.write(p, next)
        }
      }
      await api.vault.rename(from, target)
      if (get().currentPath === from) set({ currentPath: target })
      await get().reload()
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

    setFrontmatter: async (path, data) => {
      const raw = get().rawByPath[path] ?? ''
      const { body } = splitFrontmatter(raw)
      const keys = Object.keys(data)
      const next = keys.length ? `---\n${yamlDump(data)}---\n${body}` : body
      await api.vault.write(path, next)
      const parsed = parseNote({ path, content: next, mtime: Date.now(), ctime: Date.now() })
      set((s) => {
        const notesByPath = { ...s.notesByPath, [path]: parsed }
        const rawByPath = { ...s.rawByPath, [path]: next }
        return {
          notesByPath,
          rawByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
          draft: s.currentPath === path && !s.dirty ? next : s.draft,
        }
      })
    },

    batchAppend: async (items) => {
      for (const { path, text } of items) {
        const raw = get().rawByPath[path] ?? ''
        if (raw.includes(text.trim())) continue
        await api.vault.write(path, raw.replace(/\s*$/, '') + '\n\n' + text + '\n')
      }
      await get().reload()
    },

    openToday: async () => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const path = `Daily/${name}.md`
      if (get().notesByPath[path]) {
        await get().openNote(path)
        return
      }
      await get().createNote(path, `# ${name}\n\n`)
    },

    moveToFolder: async (from, folder) => {
      const base = from.split('/').pop() as string
      const to = folder ? `${folder.replace(/\/$/, '')}/${base}` : base
      if (to === from) return
      await get().renameNote(from, to)
    },

    renameFolder: async (oldPrefix, newPrefix) => {
      const op = oldPrefix.replace(/\/$/, '')
      const np = newPrefix.replace(/\/$/, '')
      if (!np || np === op) return
      const files = Object.keys(get().rawByPath).filter((p) => p.startsWith(op + '/'))
      for (const p of files) {
        try {
          await api.vault.rename(p, np + p.slice(op.length))
        } catch {
          /* 单个失败跳过 */
        }
      }
      await get().reload()
    },

    deleteFolder: async (prefix) => {
      const pf = prefix.replace(/\/$/, '')
      const files = Object.keys(get().rawByPath).filter((p) => p.startsWith(pf + '/'))
      for (const p of files) {
        try {
          await api.vault.remove(p)
        } catch {
          /* 跳过 */
        }
      }
      await get().reload()
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
