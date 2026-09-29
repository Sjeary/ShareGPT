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
  [key: string]: unknown
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
    const doc = JSON.parse(raw.trim() || '{}')
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('格式不是对象')
    const nodes = doc.nodes ?? []
    const edges = doc.edges ?? []
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error('节点或连线不是列表')
    const ids = new Set<string>()
    for (const node of nodes) {
      if (
        !node ||
        typeof node.id !== 'string' ||
        !node.id ||
        ids.has(node.id) ||
        !['text', 'file', 'link', 'group'].includes(node.type) ||
        !['x', 'y', 'width', 'height'].every(
          (key) => typeof node[key] === 'number' && Number.isFinite(node[key]),
        )
      )
        throw new Error('节点格式不完整')
      ids.add(node.id)
    }
    ids.clear()
    for (const edge of edges) {
      if (
        !edge ||
        typeof edge.id !== 'string' ||
        !edge.id ||
        ids.has(edge.id) ||
        typeof edge.fromNode !== 'string' ||
        typeof edge.toNode !== 'string'
      )
        throw new Error('连线格式不完整')
      ids.add(edge.id)
    }
    return { ...doc, nodes, edges }
  } catch {
    throw new Error(
      '无法读取画布：文件格式不完整，原文件已保留。请修复 JSON Canvas 文件后重新打开。',
    )
  }
}

export function toReactFlow(doc: CanvasDoc): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = doc.nodes.map((n) => ({
    id: n.id,
    type: `c_${n.type}`,
    position: { x: n.x, y: n.y },
    style: { width: n.width ?? 250, height: n.height ?? 120 },
    data: {
      text: n.text,
      file: n.file,
      url: n.url,
      label: n.label,
      color: canvasColor(n.color),
      canvasSource: { ...n },
    },
  }))
  const edges: Edge[] = doc.edges.map((e) => ({
    id: e.id,
    source: e.fromNode,
    target: e.toNode,
    label: e.label,
    data: { canvasSource: { ...e } },
    style: e.color ? { stroke: canvasColor(e.color) } : undefined,
  }))
  return { nodes, edges }
}

export function toCanvas(nodes: Node[], edges: Edge[], original?: CanvasDoc): CanvasDoc {
  return {
    ...original,
    nodes: nodes.map((n) => {
      const type = (n.type || 'c_text').replace(/^c_/, '') as CanvasNode['type']
      const d = (n.data || {}) as Record<string, unknown>
      const w = typeof n.style?.width === 'number' ? n.style.width : n.measured?.width || 250
      const h = typeof n.style?.height === 'number' ? n.style.height : n.measured?.height || 120
      return {
        ...(d.canvasSource as CanvasNode | undefined),
        id: n.id,
        type,
        x: n.position.x,
        y: n.position.y,
        width: w,
        height: h,
        text: typeof d.text === 'string' ? d.text : undefined,
        file: typeof d.file === 'string' ? d.file : undefined,
        url: typeof d.url === 'string' ? d.url : undefined,
        label: typeof d.label === 'string' ? d.label : undefined,
      }
    }),
    edges: edges.map((e) => ({
      ...(e.data?.canvasSource as CanvasEdge | undefined),
      id: e.id,
      fromNode: e.source,
      toNode: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
  }
}
