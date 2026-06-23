import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileText, Plus, Type as TypeIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { useVaultStore } from '@/store/useVaultStore'
import { parseCanvas, toCanvas, toReactFlow } from '@/lib/notes/canvas'

let idc = 0
const newId = () => `n${Date.now()}_${idc++}`

function NodeShell({
  children,
  color,
}: {
  children: React.ReactNode
  color?: string
}) {
  return (
    <div
      className="h-full w-full overflow-auto rounded-lg border bg-card p-2.5 text-sm shadow-sm"
      style={{ borderColor: color || 'var(--border)' }}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !bg-primary" />
      {children}
      <Handle type="source" position={Position.Right} className="!size-2 !bg-primary" />
    </div>
  )
}

function TextNode({ id, data }: NodeProps) {
  const rf = useReactFlow()
  const [editing, setEditing] = useState(false)
  const text = (data as { text?: string }).text || ''
  const color = (data as { color?: string }).color
  return (
    <NodeShell color={color}>
      {editing ? (
        <textarea
          autoFocus
          defaultValue={text}
          onBlur={(e) => {
            const v = e.target.value
            rf.setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: v } } : n)))
            setEditing(false)
          }}
          className="nodrag h-full w-full resize-none bg-transparent outline-none"
        />
      ) : (
        <div onDoubleClick={() => setEditing(true)} className="h-full whitespace-pre-wrap break-words">
          {text || <span className="text-muted-foreground">双击编辑…</span>}
        </div>
      )}
    </NodeShell>
  )
}

function FileNode({ data }: NodeProps) {
  const d = data as { file?: string; color?: string }
  const openNote = useVaultStore((s) => s.openNote)
  const resolve = useVaultStore((s) => s.index?.resolve)
  return (
    <NodeShell color={d.color}>
      <button
        type="button"
        className="flex items-center gap-1.5 font-medium text-primary"
        onClick={() => {
          const p = resolve?.(String(d.file || '').replace(/\.md$/i, '')) || d.file
          if (p) void openNote(p)
        }}
      >
        <FileText className="size-4" /> {String(d.file || '').split('/').pop()}
      </button>
    </NodeShell>
  )
}

function LinkNode({ data }: NodeProps) {
  const d = data as { url?: string; color?: string }
  return (
    <NodeShell color={d.color}>
      <a
        className="break-all text-primary underline"
        onClick={(e) => {
          e.preventDefault()
          if (d.url) void api.openExternal(d.url)
        }}
        href={d.url}
      >
        {d.url}
      </a>
    </NodeShell>
  )
}

function GroupNode({ data }: NodeProps) {
  const d = data as { label?: string; color?: string }
  return (
    <div
      className="h-full w-full rounded-xl border-2 border-dashed bg-muted/20 p-2 text-xs font-medium text-muted-foreground"
      style={{ borderColor: d.color || 'var(--border)' }}
    >
      {d.label}
    </div>
  )
}

function CanvasInner({ path }: { path: string }) {
  const raw = useVaultStore((s) => s.rawByPath[path] || '')
  const initial = useMemo(() => toReactFlow(parseCanvas(raw)), [raw])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const rf = useReactFlow()
  const dark = useAppStore((s) => s.dark)
  const ready = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nodeTypes = useMemo(
    () => ({ c_text: TextNode, c_file: FileNode, c_link: LinkNode, c_group: GroupNode }),
    [],
  )

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: newId() }, eds)),
    [setEdges],
  )

  // 防抖落盘 (JSON Canvas)。跳过首帧加载。
  useEffect(() => {
    if (!ready.current) {
      ready.current = true
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const doc = toCanvas(nodes as Node[], edges as Edge[])
      void api.vault.write(path, JSON.stringify(doc, null, 2))
    }, 700)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [nodes, edges, path])

  const addText = () => {
    const c = rf.screenToFlowPosition({ x: 300, y: 200 })
    setNodes((ns) => [
      ...ns,
      { id: newId(), type: 'c_text', position: c, style: { width: 240, height: 120 }, data: { text: '' } },
    ])
  }
  const addFile = () => {
    const name = window.prompt('链接到笔记 (相对路径)', 'Welcome.md')
    if (!name) return
    const c = rf.screenToFlowPosition({ x: 360, y: 240 })
    setNodes((ns) => [
      ...ns,
      { id: newId(), type: 'c_file', position: c, style: { width: 220, height: 70 }, data: { file: name } },
    ])
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute left-3 top-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={addText}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-popover/90 px-2.5 py-1 text-xs shadow-sm backdrop-blur hover:bg-accent"
        >
          <TypeIcon className="size-3.5" /> 文本
        </button>
        <button
          type="button"
          onClick={addFile}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-popover/90 px-2.5 py-1 text-xs shadow-sm backdrop-blur hover:bg-accent"
        >
          <Plus className="size-3.5" /> 笔记卡片
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        colorMode={dark ? 'dark' : 'light'}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color={dark ? '#3f3f46' : '#d4d4d8'} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}

// 画布视图: .canvas 文件用无限白板渲染/编辑 (JSON Canvas 往返), 可被 Obsidian 直接打开。
export function CanvasView({ path }: { path: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner key={path} path={path} />
    </ReactFlowProvider>
  )
}
