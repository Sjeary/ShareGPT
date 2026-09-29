import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCanvas, toCanvas, toReactFlow } from './canvas.ts'

test('canvas editing retains node/edge metadata and extension fields', () => {
  const input = {
    version: '1.0',
    extension: { enabled: true },
    nodes: [
      {
        id: 'a',
        type: 'file',
        x: 0,
        y: 1,
        width: 240,
        height: 100,
        file: 'a.md',
        subpath: '#Section',
        color: '2',
        unknown: 'keep',
      },
      { id: 'b', type: 'text', x: 20, y: 20, width: 240, height: 100, text: 'text' },
    ],
    edges: [
      {
        id: 'edge',
        fromNode: 'a',
        toNode: 'b',
        fromSide: 'top',
        toSide: 'bottom',
        color: '4',
        label: 'link',
        fromEnd: 'none',
      },
    ],
  }
  const doc = parseCanvas(JSON.stringify(input))
  const flow = toReactFlow(doc)
  assert.deepEqual(JSON.parse(JSON.stringify(toCanvas(flow.nodes, flow.edges, doc))), input)
  flow.nodes[0].position.x = 150
  flow.nodes[1].data.text = 'changed'
  const saved = toCanvas(flow.nodes, flow.edges, doc)
  assert.equal(saved.nodes[0].x, 150)
  assert.equal(saved.nodes[0].subpath, '#Section')
  assert.equal(saved.nodes[0].color, '2')
  assert.equal(saved.nodes[1].text, 'changed')
  assert.deepEqual(saved.edges, input.edges)
  assert.deepEqual(saved.extension, { enabled: true })
})

test('invalid canvas content cannot be converted to a writable empty canvas', () => {
  for (const raw of [
    '{broken',
    '[]',
    'null',
    '{"nodes":{}}',
    '{"nodes":[{"id":"bad"}]}',
    '{"edges":[null]}',
  ])
    assert.throws(() => parseCanvas(raw), /原文件已保留/)
  assert.deepEqual(parseCanvas(''), { nodes: [], edges: [] })
})
