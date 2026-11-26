import test from 'node:test'
import assert from 'node:assert/strict'
import { handleTerminalCopy } from './terminalClipboard.ts'

function key(modifiers: Partial<KeyboardEvent> = {}) {
  return {
    type: 'keydown',
    key: 'c',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...modifiers,
  }
}

for (const [platform, modifiers] of [
  ['darwin', { metaKey: true }],
  ['win32', { ctrlKey: true }],
  ['linux', { ctrlKey: true, shiftKey: true }],
  ['darwin', { ctrlKey: true, shiftKey: true }],
] as const) {
  test(`${platform} copies the xterm selection without sending the key to the shell`, async () => {
    const event = key(modifiers),
      writes: string[] = []
    const text = '中文 output\nsecond line 😀'
    assert.equal(
      handleTerminalCopy(
        event,
        platform,
        () => text,
        async (value) => {
          writes.push(value)
        },
        (error) => assert.fail(String(error)),
      ),
      false,
    )
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(writes, [text])
    assert.ok(event.prevented)
    assert.ok(event.stopped)
  })
}

test('Ctrl+C with no selection and Mac Ctrl+C with selection remain shell interrupts', () => {
  for (const [platform, text] of [
    ['win32', ''],
    ['darwin', 'selected'],
    ['linux', ''],
  ]) {
    const event = key({ ctrlKey: true })
    assert.equal(
      handleTerminalCopy(
        event,
        platform,
        () => text,
        async () => assert.fail('must not copy'),
        (error) => assert.fail(String(error)),
      ),
      true,
    )
    assert.equal(event.prevented, false)
  }
})

test('ordinary keys, paste, keyup and Alt shortcuts are untouched', () => {
  for (const event of [
    key(),
    key({ key: 'v', metaKey: true }),
    key({ type: 'keyup', metaKey: true }),
    key({ ctrlKey: true, altKey: true }),
  ])
    assert.equal(
      handleTerminalCopy(
        event,
        'darwin',
        () => 'selected',
        async () => assert.fail('unexpected copy'),
        (error) => assert.fail(String(error)),
      ),
      true,
    )
})

test('clipboard failures are reported and held shortcuts do not repeatedly copy', async () => {
  const errors: unknown[] = []
  const failure = new Error('clipboard unavailable')
  handleTerminalCopy(
    key({ metaKey: true }),
    'darwin',
    () => 'selection',
    async () => {
      throw failure
    },
    (error) => errors.push(error),
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(errors, [failure])
  assert.equal(
    handleTerminalCopy(
      key({ metaKey: true, repeat: true }),
      'darwin',
      () => 'selection',
      async () => assert.fail('repeat'),
      (error) => assert.fail(String(error)),
    ),
    false,
  )
})
