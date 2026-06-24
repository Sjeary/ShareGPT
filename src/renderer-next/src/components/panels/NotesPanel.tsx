import { useEffect, useMemo } from 'react'
import {
  BookText,
  CalendarDays,
  Eye,
  FilePlus2,
  FolderInput,
  Info,
  Link2,
  ListTree,
  Network,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { PanelScaffold } from './PanelScaffold'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi, type CenterMode, type RightTab } from '@/store/useNotesUi'
import { splitFrontmatter } from '@/lib/notes/parse'
import { NotesLeft } from './notes/NotesLeft'
import { NoteEditor } from './notes/NoteEditor'
import { NoteReader } from './notes/NoteReader'
import { BacklinksPanel, OutlinePanel, PropertiesPanel } from './notes/RightPanels'
import { QuickSwitcher } from './notes/QuickSwitcher'
import { CommandPalette } from './notes/CommandPalette'
import { NotesEmptyState } from './notes/NotesEmptyState'
import { GraphView } from './notes/GraphView'
import { CanvasView } from './notes/CanvasView'
import { BaseView } from './notes/BaseView'
import { AiAssistant } from './notes/AiAssistant'
import { InputPromptDialog, inputPrompt } from './notes/InputPrompt'
import { InlineAiEdit, SelectionAiButton } from './notes/InlineAiEdit'
import { AutoLinkDialog } from './notes/AutoLinkDialog'
import { SyncCompareDialog } from './notes/SyncCompareDialog'
import { useNotesSync, useNotesSyncStore, type NotesSyncState } from '@/hooks/useNotesSync'
import { useNotesAiStore } from '@/store/useNotesAiStore'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'

const SYNC_LABEL: Record<NotesSyncState, string> = {
  off: '未同步',
  local: '仅本地',
  syncing: '同步中',
  synced: '云端已同步',
  error: '同步出错',
}
function NotesSyncBadge() {
  const state = useNotesSyncStore((s) => s.state)
  const Icon = state === 'syncing' ? RefreshCw : state === 'synced' ? Cloud : CloudOff
  const color =
    state === 'synced'
      ? 'text-emerald-500'
      : state === 'error'
        ? 'text-rose-500'
        : state === 'syncing'
          ? 'text-primary'
          : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', color)} title={SYNC_LABEL[state]}>
      <Icon className={cn('size-3.5', state === 'syncing' && 'animate-spin')} />
      <span className="hidden sm:inline">{SYNC_LABEL[state]}</span>
    </span>
  )
}

const CENTER_TABS: { key: CenterMode; label: string; icon: typeof Eye }[] = [
  { key: 'edit', label: '编辑', icon: Pencil },
  { key: 'preview', label: '预览', icon: Eye },
  { key: 'graph', label: '图谱', icon: Network },
]
const RIGHT_TABS: { key: RightTab; label: string; icon: typeof Link2 }[] = [
  { key: 'backlinks', label: '反链', icon: Link2 },
  { key: 'outline', label: '大纲', icon: ListTree },
  { key: 'properties', label: '属性', icon: Info },
  { key: 'ai', label: 'AI', icon: Sparkles },
]

export function NotesPanel() {
  const init = useVaultStore((s) => s.init)
  const loaded = useVaultStore((s) => s.loaded)
  const applyExternalChanges = useVaultStore((s) => s.applyExternalChanges)
  const notesCount = useVaultStore((s) => Object.keys(s.notesByPath).length)
  const currentPath = useVaultStore((s) => s.currentPath)
  const draft = useVaultStore((s) => s.draft)
  const createNote = useVaultStore((s) => s.createNote)
  const importVault = useVaultStore((s) => s.importVault)

  const centerMode = useNotesUi((s) => s.centerMode)
  const setCenterMode = useNotesUi((s) => s.setCenterMode)
  const rightTab = useNotesUi((s) => s.rightTab)
  const setRightTab = useNotesUi((s) => s.setRightTab)
  const showLeft = useNotesUi((s) => s.showLeft)
  const showRight = useNotesUi((s) => s.showRight)
  const toggleLeft = useNotesUi((s) => s.toggleLeft)
  const toggleRight = useNotesUi((s) => s.toggleRight)
  const setQuickOpen = useNotesUi((s) => s.setQuickOpen)
  const setPaletteOpen = useNotesUi((s) => s.setPaletteOpen)
  const openToday = useVaultStore((s) => s.openToday)

  useEffect(() => {
    void init()
    void useNotesAiStore.getState().load() // 预加载 AI 配置, 供内联编辑/选区问 AI 使用
  }, [init])

  // 云端同步 (登录态自动; 未登录静默本地)。
  useNotesSync()

  useEffect(
    () => api.onVaultChanged((payload) => void applyExternalChanges(payload)),
    [applyExternalChanges],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setQuickOpen(true)
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setCenterMode(centerMode === 'edit' ? 'preview' : 'edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [centerMode, setCenterMode, setQuickOpen, setPaletteOpen])

  const previewBody = useMemo(() => splitFrontmatter(draft).body, [draft])

  const onNew = async () => {
    const name = await inputPrompt('新建笔记 (相对路径)', '未命名.md')
    if (name && name.trim()) {
      try {
        await createNote(name.trim())
        setCenterMode('edit')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '创建失败')
      }
    }
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      <NotesSyncBadge />
      <button
        type="button"
        onClick={onNew}
        title="新建笔记"
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <FilePlus2 className="size-4" /> 新建
      </button>
      <button
        type="button"
        title="今日笔记"
        onClick={() => {
          void openToday().then(() => setCenterMode('edit'))
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
      >
        <CalendarDays className="size-4" />
      </button>
      <button
        type="button"
        title="导入 Obsidian 库"
        onClick={async () => {
          const r = await importVault()
          if (r) toast.success(`已导入 ${r.notes} 篇笔记`)
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
      >
        <FolderInput className="size-4" />
      </button>
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {CENTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setCenterMode(t.key)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              centerMode === t.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center">
        <button
          type="button"
          onClick={toggleLeft}
          title="侧栏"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
        >
          {showLeft ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
        <button
          type="button"
          onClick={toggleRight}
          title="信息栏"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
        >
          {showRight ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </button>
      </div>
    </div>
  )

  return (
    <PanelScaffold
      icon={BookText}
      title="笔记 / 知识库"
      hint="双链笔记、图谱与全文检索"
      scrollable={false}
      toolbar={toolbar}
    >
      {loaded && notesCount === 0 ? (
        <NotesEmptyState />
      ) : (
        <div className="flex h-full min-h-0">
          {showLeft && <NotesLeft />}
          <div className="flex min-w-0 flex-1 flex-col">
            {centerMode === 'graph' ? (
              <GraphView />
            ) : !currentPath ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <BookText className="size-8 opacity-30" />
                <p>
                  选择左侧笔记，或按{' '}
                  <kbd className="rounded border border-border px-1">Ctrl/⌘ O</kbd> 快速跳转
                </p>
              </div>
            ) : currentPath.endsWith('.canvas') ? (
              <CanvasView key={currentPath} path={currentPath} />
            ) : currentPath.endsWith('.base') ? (
              <BaseView key={currentPath} path={currentPath} />
            ) : centerMode === 'edit' ? (
              <NoteEditor key={currentPath} path={currentPath} />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto max-w-[820px] px-8 py-6">
                  <NoteReader body={previewBody} />
                </div>
              </div>
            )}
          </div>
          {showRight &&
            currentPath &&
            centerMode !== 'graph' &&
            !currentPath.endsWith('.canvas') &&
            !currentPath.endsWith('.base') && (
              <div className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-muted/20">
                <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
                  {RIGHT_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setRightTab(t.key)}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                        rightTab === t.key
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <t.icon className="size-3.5" /> {t.label}
                    </button>
                  ))}
                </div>
                <div className="no-scrollbar min-h-0 flex-1 overflow-auto">
                  {rightTab === 'backlinks' && <BacklinksPanel />}
                  {rightTab === 'outline' && <OutlinePanel />}
                  {rightTab === 'properties' && <PropertiesPanel />}
                  {rightTab === 'ai' && <AiAssistant />}
                </div>
              </div>
            )}
        </div>
      )}
      <QuickSwitcher />
      <CommandPalette />
      <SyncCompareDialog />
      <InputPromptDialog />
      <SelectionAiButton />
      <InlineAiEdit />
      <AutoLinkDialog />
    </PanelScaffold>
  )
}
