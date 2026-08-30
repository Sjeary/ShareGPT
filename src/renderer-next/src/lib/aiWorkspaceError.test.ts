import test from 'node:test'
import assert from 'node:assert/strict'
import { userFacingAiWorkspaceError } from './aiWorkspaceError.ts'

test('internal stale workspace failures are not exposed to users', () => {
  assert.equal(
    userFacingAiWorkspaceError(
      new Error("Error invoking remote method 'ai:ensure': Error: 网页运行状态已变化，请重试"),
    ),
    null,
  )
  assert.equal(
    userFacingAiWorkspaceError({ code: 'STALE_AI_WORKSPACE', message: 'internal stale' }),
    null,
  )
})

test('actionable errors are normalized without Electron IPC wrappers', () => {
  assert.equal(
    userFacingAiWorkspaceError(
      new Error("Error invoking remote method 'ai:ensure': Error: 线路 US 未通过预检"),
    ),
    '线路 US 未通过预检',
  )
})
