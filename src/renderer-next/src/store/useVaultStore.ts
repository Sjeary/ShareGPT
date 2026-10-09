import { create } from 'zustand'
import { userDataApiFor } from '@/lib/api'
import {
  settingsPrincipalRuntime,
  type SettingsPrincipalSnapshot,
} from '@/lib/settingsPrincipalRuntime'
import { assertUserDataWritable, userDataTransitionState } from '@/lib/userDataTransitionState'
import { mergeVault, type MergeReport, type VaultFiles } from '@/lib/notes/merge'
import { coalesceInFlight } from '@/lib/inFlightRequest'
import type { VaultChangeEvent, VaultFileMeta, VaultImportReport } from '@/types/api'
import { dump as yamlDump } from 'js-yaml'
import { NotesIndex } from '@/lib/notes'
import { parseNote, splitFrontmatter } from '@/lib/notes/parse'
import type { ParsedNote } from '@/lib/notes/types'

// 知识库主 store: 持有 vault 根、各笔记磁盘内容/解析结果、全库索引、当前打开的笔记与编辑缓冲。
// 真源在磁盘 (主进程 vault); 本 store 是其内存镜像 + 派生索引。保存防抖落盘后重建索引。

interface VaultState {
  loaded: boolean
  loadError: string
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
  flushPending: () => Promise<void>
  resetForPrincipal: () => void
  reload: () => Promise<void>
  mergeFromCloud: (base: VaultFiles, theirs: VaultFiles) => Promise<MergeReport>
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
  let owner: SettingsPrincipalSnapshot | null = null
  const loads = new Map<string, Promise<void>>()
  const operations = new Set<Promise<unknown>>()
  let operationChain: Promise<unknown> = Promise.resolve()
  let rootEpoch = 0
  let changingRoot = false
  const snapshotForOperation = () => {
    const snapshot = owner ?? settingsPrincipalRuntime.snapshot()
    settingsPrincipalRuntime.assertCurrent(snapshot)
    return snapshot
  }
  const track =
    <T extends unknown[], R>(operation: (...args: T) => Promise<R>) =>
    (...args: T): Promise<R> => {
      const snapshot = settingsPrincipalRuntime.current()
      const epoch = rootEpoch
      const pending = operationChain
        .catch(() => undefined)
        .then(() => {
          settingsPrincipalRuntime.assertCurrent(snapshot)
          if (epoch !== rootEpoch) throw new Error('知识库已切换，请重试')
          return operation(...args)
        })
      operationChain = pending
      operations.add(pending)
      void pending.finally(() => operations.delete(pending)).catch(() => undefined)
      return pending
    }
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void get()
        .saveCurrent()
        .catch(() => console.error('笔记保存失败，草稿已保留'))
    }, 600)
  }

  const flushDraft = async () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    while (get().dirty && get().currentPath) await state.saveCurrent()
  }

  const state: VaultState = {
    loaded: false,
    loadError: '',
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

    resetForPrincipal: () => {
      owner = null
      rootEpoch++
      changingRoot = false
      loads.clear()
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = null
      set({
        loaded: false,
        loadError: '',
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
      })
    },
    flushPending: async () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = null
      const settled = await Promise.allSettled([...operations])
      const failed = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
      )
      if (failed) throw failed.reason
      await flushDraft()
    },
    init: async () => {
      const snapshot = settingsPrincipalRuntime.snapshot()
      if (
        get().loaded &&
        owner?.principalId === snapshot.principalId &&
        owner?.generation === snapshot.generation
      )
        return
      owner = snapshot
      return coalesceInFlight(loads, JSON.stringify(snapshot), async () => {
        const api = userDataApiFor(snapshot)
        try {
          await api.vault.start()
        } catch {
          /* 监听不可用不致命 */
        }
        try {
          const root = await api.vault.getRoot()
          settingsPrincipalRuntime.assertCurrent(snapshot)
          set({ root })
          await state.reload()
          settingsPrincipalRuntime.assertCurrent(snapshot)
          set({ loaded: true, loadError: '' })
        } catch {
          if (
            settingsPrincipalRuntime.current().principalId === snapshot.principalId &&
            settingsPrincipalRuntime.current().generation === snapshot.generation
          )
            set({
              loadError: '无法完整读取知识库，原有资料已保留。请检查文件和目录访问权限后重新加载。',
            })
        }
      })
    },

    reload: async () => {
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
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
        const keepCur = cur && (notesByPath[cur] || get().dirty) ? cur : null
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
        if (
          settingsPrincipalRuntime.current().principalId === snapshot.principalId &&
          settingsPrincipalRuntime.current().generation === snapshot.generation
        )
          set({ busy: false })
      }
    },

    openNote: async (path) => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      // 保存上一篇未落盘的改动
      await flushDraft()
      let content = get().rawByPath[path]
      if (content === undefined) {
        try {
          const f = await api.vault.read(path)
          content = f.content
          set((s) => ({ rawByPath: { ...s.rawByPath, [path]: content } }))
        } catch (error) {
          settingsPrincipalRuntime.assertCurrent(snapshot)
          throw error
        }
      }
      set({ currentPath: path, draft: content, dirty: false })
    },

    setDraft: (content) => {
      assertUserDataWritable()
      snapshotForOperation()
      if (changingRoot) throw new Error('正在切换知识库，请稍后编辑')
      if (!get().currentPath || get().draft === content) return
      set({ draft: content, dirty: true })
      scheduleSave()
    },

    saveCurrent: async () => {
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      const { currentPath, draft } = get()
      if (!currentPath || !get().dirty) return
      await api.vault.write(currentPath, draft)
      const parsed = parseNote({
        path: currentPath,
        content: draft,
        mtime: Date.now(),
        ctime: Date.now(),
      })
      set((s) => {
        const notesByPath = { ...s.notesByPath, [currentPath]: parsed }
        const rawByPath = { ...s.rawByPath, [currentPath]: draft }
        return {
          notesByPath,
          rawByPath,
          index: rebuild(notesByPath),
          indexVersion: s.indexVersion + 1,
          dirty: s.currentPath !== currentPath || s.draft !== draft,
        }
      })
    },

    createNote: async (path, content = '') => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
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
      await state.openNote(f.path)
      return f.path
    },

    renameNote: async (from, to) => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      await flushDraft()
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
      await state.reload()
    },

    deleteNote: async (path) => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
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
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      await flushDraft()
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
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      await flushDraft()
      for (const { path, text } of items) {
        const raw = get().rawByPath[path] ?? ''
        if (raw.includes(text.trim())) continue
        await api.vault.write(path, raw.replace(/\s*$/, '') + '\n\n' + text + '\n')
      }
      await state.reload()
    },

    openToday: async () => {
      assertUserDataWritable()
      snapshotForOperation()

      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const path = `Daily/${name}.md`
      if (get().notesByPath[path]) {
        await state.openNote(path)
        return
      }
      await state.createNote(path, `# ${name}\n\n`)
    },

    moveToFolder: async (from, folder) => {
      assertUserDataWritable()
      snapshotForOperation()

      const base = from.split('/').pop() as string
      const to = folder ? `${folder.replace(/\/$/, '')}/${base}` : base
      if (to === from) return
      await state.renameNote(from, to)
    },

    renameFolder: async (oldPrefix, newPrefix) => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      await flushDraft()
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
      await state.reload()
    },

    deleteFolder: async (prefix) => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      const pf = prefix.replace(/\/$/, '')
      const files = Object.keys(get().rawByPath).filter((p) => p.startsWith(pf + '/'))
      for (const p of files) {
        try {
          await api.vault.remove(p)
        } catch {
          /* 跳过 */
        }
      }
      await state.reload()
    },

    setRootViaDialog: async () => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      const picked = await api.vault.pickFolder()
      if (!picked) return false
      await flushDraft()
      changingRoot = true
      const wasLoaded = get().loaded
      let switched = false
      set({ loaded: false, busy: true, loadError: '' })
      try {
        const res = await api.vault.setRoot(picked)
        rootEpoch++
        switched = true
        set({
          root: res.root,
          currentPath: null,
          draft: '',
          dirty: false,
          rawByPath: {},
          notesByPath: {},
          fileList: [],
          index: null,
        })
        await state.reload()
        set({ loaded: true })
        return true
      } catch (error) {
        set({
          loaded: switched ? false : wasLoaded,
          loadError: switched ? '新知识库暂时无法完整读取，请重新加载。原知识库的修改已保存。' : '',
        })
        throw error
      } finally {
        changingRoot = false
        set({ busy: false })
      }
    },

    importVault: async () => {
      assertUserDataWritable()
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      const picked = await api.vault.pickFolder()
      if (!picked) return null
      set({ busy: true })
      try {
        const report = await api.vault.importFrom(picked)
        await state.reload()
        return report
      } finally {
        set({ busy: false })
      }
    },

    mergeFromCloud: async (base, theirs) => {
      const snapshot = snapshotForOperation()
      const api = userDataApiFor(snapshot)
      await flushDraft()
      let local = { ...get().rawByPath }
      const persisted = { ...local }
      let report = mergeVault(base, local, theirs)
      const includeNewDraft = () => {
        const { currentPath, draft, dirty } = get()
        if (!dirty || !currentPath || draft === local[currentPath]) return false
        const nextLocal = { ...local, [currentPath]: draft }
        const next = mergeVault(local, nextLocal, report.merged)
        local = nextLocal
        report = {
          ...next,
          changed: report.changed || next.changed,
          fromCloud: [...new Set([...report.fromCloud, ...next.fromCloud])],
          keptLocal: [...new Set([...report.keptLocal, ...next.keptLocal])],
          autoMerged: [...new Set([...report.autoMerged, ...next.autoMerged])],
          deleted: [...new Set([...report.deleted, ...next.deleted])],
          conflicts: [...report.conflicts, ...next.conflicts],
        }
        return true
      }
      // Typing can continue during every IPC write and reload. Rebase it onto the
      // pending merge until the persisted result includes both sides.
      for (;;) {
        for (const [path, content] of Object.entries(report.merged)) {
          if (persisted[path] !== content) {
            await api.vault.write(path, content)
            persisted[path] = content
          }
        }
        for (const path of Object.keys(persisted)) {
          if (report.merged[path] === undefined) {
            await api.vault.remove(path)
            delete persisted[path]
          }
        }
        if (includeNewDraft()) continue
        await state.reload()
        if (includeNewDraft()) continue
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = null
        const path = get().currentPath
        set({ draft: path ? (report.merged[path] ?? '') : '', dirty: false })
        return report
      }
    },

    applyExternalChanges: async (payload) => {
      if (userDataTransitionState.isSuspended() || !payload?.snapshot) return
      const snapshot = payload.snapshot
      try {
        settingsPrincipalRuntime.assertCurrent(snapshot)
      } catch {
        return
      }
      const api = userDataApiFor(snapshot)
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
      settingsPrincipalRuntime.assertCurrent(snapshot)
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
  const wrapped = { ...state }
  for (const name of [
    'init',
    'reload',
    'openNote',
    'saveCurrent',
    'createNote',
    'renameNote',
    'deleteNote',
    'setFrontmatter',
    'batchAppend',
    'openToday',
    'moveToFolder',
    'renameFolder',
    'deleteFolder',
    'setRootViaDialog',
    'importVault',
    'applyExternalChanges',
    'mergeFromCloud',
  ]) {
    const key = name as keyof VaultState
    const original = state[key] as (...args: unknown[]) => Promise<unknown>
    Object.assign(wrapped, { [key]: track(original) })
  }
  return wrapped
})
