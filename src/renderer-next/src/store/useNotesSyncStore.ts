import { create } from 'zustand'
import type { MergeReport } from '@/lib/notes/merge'

export type NotesSyncState = 'off' | 'local' | 'syncing' | 'synced' | 'error'

interface NotesSyncStore {
  state: NotesSyncState
  lastReport: MergeReport | null
  compareOpen: boolean
  resetForPrincipal: () => void
  setState: (s: NotesSyncState) => void
  showReport: (r: MergeReport) => void
  setCompareOpen: (v: boolean) => void
}
export const useNotesSyncStore = create<NotesSyncStore>((set) => ({
  state: 'off',
  lastReport: null,
  compareOpen: false,
  resetForPrincipal: () => set({ state: 'off', lastReport: null, compareOpen: false }),
  setState: (state) => set({ state }),
  showReport: (lastReport) => set({ lastReport, compareOpen: true }),
  setCompareOpen: (compareOpen) => set({ compareOpen }),
}))
