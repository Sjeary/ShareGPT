import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVaultStore } from '@/store/useVaultStore'
import { useNotesUi } from '@/store/useNotesUi'

type Mode = 'global' | 'local'
interface GNode {
  id: string
  title: string
  degree: number
  folder: string
  x?: number
  y?: number
}
interface GLink {
  source: string | GNode
  target: string | GNode
}

// 知识库图谱: 节点=笔记, 连线=双链。global 全库 / local 当前笔记邻域。点击节点打开笔记。
export function GraphView() {
  const index = useVaultStore((s) => s.index)
  const currentPath = useVaultStore((s) => s.currentPath)
  const openNote = useVaultStore((s) => s.openNote)

  const [mode, setMode] = useState<Mode>('global')
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [hover, setHover] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  // react-force-graph 实例引用 (centerAt / zoom 等命令式方法)
  const fgRef = useRef<{ centerAt: (x?: number, y?: number, ms?: number) => void; zoom: (k?: number, ms?: number) => void } | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    if (!index) return { nodes: [] as GNode[], links: [] as GLink[] }
    const g =
      mode === 'local' && currentPath
        ? index.graph({ mode: 'local', path: currentPath, depth: 2 })
        : index.graph({ mode: 'global' })
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, title: n.title, degree: n.degree, folder: n.folder })),
      links: g.links.map((l) => ({ source: l.source, target: l.target })),
    }
  }, [index, mode, currentPath])

  // 邻接表 (悬停高亮用)
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const l of data.links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      if (!map.has(s)) map.set(s, new Set())
      if (!map.has(t)) map.set(t, new Set())
      map.get(s)!.add(t)
      map.get(t)!.add(s)
    }
    return map
  }, [data])

  const isDark = document.documentElement.classList.contains('dark')
  const baseColor = isDark ? '#a5b4fc' : '#6366f1'
  const dimColor = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.25)'
  const linkColor = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.22)'

  return (
    <div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-lg border border-border bg-popover/90 p-1 shadow-sm backdrop-blur">
        {(['global', 'local'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={m === 'local' && !currentPath}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40',
              mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {m === 'global' ? '全局' : '局部'}
          </button>
        ))}
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => useNotesUi.getState().setAutoLinkOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-popover/90 px-2.5 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur transition-colors hover:bg-accent"
          title="让 AI 分析全库并自动建立双链"
        >
          <Sparkles className="size-3.5" /> AI 连线
        </button>
        <span className="rounded-md border border-border bg-popover/90 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {data.nodes.length} 节点 · {data.links.length} 连接
        </span>
      </div>
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          还没有可成图的笔记
        </div>
      ) : (
        <ForceGraph2D
          ref={fgRef as never}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          linkColor={() => linkColor}
          linkWidth={1}
          onNodeClick={(n: GNode) => {
            // 点击节点: 平滑居中并放大到该节点, 同时打开笔记
            if (typeof n.x === 'number' && typeof n.y === 'number') {
              fgRef.current?.centerAt(n.x, n.y, 600)
              fgRef.current?.zoom(2.4, 600)
            }
            void openNote(n.id)
          }}
          onNodeHover={(n: GNode | null) => setHover(n ? n.id : null)}
          cooldownTicks={80}
          nodeCanvasObject={(node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
            const r = Math.max(2, Math.min(10, 2 + node.degree * 0.8))
            const active =
              !hover || hover === node.id || neighbors.get(hover)?.has(node.id)
            ctx.beginPath()
            ctx.arc(node.x || 0, node.y || 0, r, 0, 2 * Math.PI)
            ctx.fillStyle = active ? baseColor : dimColor
            ctx.fill()
            if (scale > 1.2 || hover === node.id) {
              const label = node.title
              ctx.font = `${Math.max(3, 11 / scale)}px ui-sans-serif, sans-serif`
              ctx.fillStyle = active
                ? isDark
                  ? 'rgba(226,232,240,0.9)'
                  : 'rgba(30,41,59,0.9)'
                : dimColor
              ctx.textAlign = 'center'
              ctx.fillText(label, node.x || 0, (node.y || 0) + r + 9 / scale)
            }
          }}
        />
      )}
    </div>
  )
}
