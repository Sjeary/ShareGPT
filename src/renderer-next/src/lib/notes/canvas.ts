// JSON Canvas (jsoncanvas.org v1.0) ↔ react-flow 映射。开放 MIT 格式, 可被 Obsidian 直接打开。
import type { Edge, Node } from '@xyflow/react'

export interface CanvasNode {
  id: string
  type: 'text' | 'file' | 'link' | 'group'
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string // text
  file?: string // file
  subpath?: string
  url?: string // link
  label?: string // group
}
export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: string
  toSide?: string
  color?: string
  label?: string
}
export interface CanvasDoc {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

// JSON Canvas 预设色 1-6 → hex (边框/强调)。
const PRESET: Record<string, string> = {
  '1': '#e5534b',
  '2': '#e08c3b',
  '3': '#dbb42c',
  '4': '#4eb36b',
  '5': '#2bb5c9',
  '6': '#9b6bdf',
}
export function canvasColor(c?: string): string | undefined {
  if (!c) return undefined
  return PRESET[c] || c
}

export function parseCanvas(raw: string): CanvasDoc {
  try {
    const j = JSON.parse(raw || '{}')
    return {
      nodes: Array.isArray(j.nodes) ? j.nodes : [],
      edges: Array.isArray(j.edges) ? j.edges : [],
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

export function toReactFlow(doc: CanvasDoc): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = doc.nodes.map((n) => ({
    id: n.id,
    type: `c_${n.type}`,
    position: { x: n.x, y: n.y },
    style: { width: n.width || 250, height: n.height || 120 },
    data: { text: n.text, file: n.file, url: n.url, label: n.label, color: canvasColor(n.color) },
  }))
  const edges: Edge[] = doc.edges.map((e) => ({
    id: e.id,
    source: e.fromNode,
    target: e.toNode,
    label: e.label,
    style: e.color ? { stroke: canvasColor(e.color) } : undefined,
  }))
  return { nodes, edges }
}

export function toCanvas(nodes: Node[], edges: Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const type = (n.type || 'c_text').replace(/^c_/, '') as CanvasNode['type']
      const d = (n.data || {}) as Record<string, unknown>
      const w = typeof n.style?.width === 'number' ? n.style.width : n.measured?.width || 250
      const h = typeof n.style?.height === 'number' ? n.style.height : n.measured?.height || 120
      return {
        id: n.id,
        type,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        width: Math.round(w),
        height: Math.round(h),
        text: typeof d.text === 'string' ? d.text : undefined,
        file: typeof d.file === 'string' ? d.file : undefined,
        url: typeof d.url === 'string' ? d.url : undefined,
        label: typeof d.label === 'string' ? d.label : undefined,
      }
    }),
    edges: edges.map((e) => ({ id: e.id, fromNode: e.source, toNode: e.target, label: typeof e.label === 'string' ? e.label : undefined })),
  }
}
