import test from 'node:test'
import assert from 'node:assert/strict'
import { userFacingErrorMessage } from './errors.ts'

test('IPC implementation details are removed from user-facing errors', () => {
  assert.equal(
    userFacingErrorMessage(
      new Error(
        "Error invoking remote method 'ai:ensure': Error: 线路 US-LA-mac 未通过出口身份预检",
      ),
    ),
    '线路 US-LA-mac 未通过出口身份预检',
  )
  assert.equal(userFacingErrorMessage('', '加载失败'), '加载失败')
});
