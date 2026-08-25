import assert from 'node:assert/strict'
import test from 'node:test'

import { describeTranslationTarget } from './translationTarget.ts'

test('translation target display exposes the destination host without credentials or paths', () => {
  assert.deepEqual(
    describeTranslationTarget('ai', 'https://secret@example.com:8443/v1?api_key=hidden'),
    { label: 'example.com:8443', title: 'https://example.com:8443' },
  )
})

test('offline loopback target is clearly identified as local', () => {
  assert.deepEqual(describeTranslationTarget('offline', 'http://127.0.0.1:5000/translate'), {
    label: '本机 · 127.0.0.1:5000',
    title: 'http://127.0.0.1:5000',
  })
  assert.equal(
    describeTranslationTarget('offline', 'http://[::1]:5000/translate').label,
    '本机 · [::1]:5000',
  )
})

test('missing or invalid translation targets have explicit labels', () => {
  assert.equal(describeTranslationTarget('api', '').label, '未配置')
  assert.equal(describeTranslationTarget('api', 'not a url').label, '地址无效')
})
