import assert from 'node:assert/strict'
import test from 'node:test'
import { createNavTooltipInputState } from './navTooltipIntent.ts'

const validFocus = {
  documentHasFocus: true,
  isActiveElement: true,
  isFocusVisible: true,
}

test('mouse focus and restored window focus are not keyboard tooltip intents', () => {
  const state = createNavTooltipInputState()
  state.notePointer()
  assert.equal(state.canShowKeyboardFocus(validFocus), false)
  state.invalidate()
  assert.equal(state.canShowKeyboardFocus(validFocus), false)
})

test('only navigation keys authorize a focus-visible tooltip', () => {
  const state = createNavTooltipInputState()
  assert.equal(state.noteKeyboardKey('a'), false)
  assert.equal(state.canShowKeyboardFocus(validFocus), false)
  assert.equal(state.noteKeyboardKey('Tab'), true)
  assert.equal(state.canShowKeyboardFocus(validFocus), true)
  assert.equal(state.canShowKeyboardFocus({ ...validFocus, isFocusVisible: false }), false)
  state.notePointer()
  assert.equal(state.canShowKeyboardFocus(validFocus), false)
})

test('interaction ids are monotonic across invalidation', () => {
  const state = createNavTooltipInputState()
  assert.equal(state.nextInteractionId('gpt'), 'gpt:1')
  state.invalidate()
  assert.equal(state.nextInteractionId('gpt'), 'gpt:3')
})
