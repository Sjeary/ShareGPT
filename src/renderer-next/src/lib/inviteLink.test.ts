import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInviteLink, parseInviteLink } from './inviteLink.ts'

test('builds and parses canonical sharegpt:// invite links', () => {
  const link = buildInviteLink('https://team.example.com:8443/sub/', 'AbCdEf123456')
  assert.equal(
    link,
    'sharegpt://invite?server=https%3A%2F%2Fteam.example.com%3A8443%2Fsub&code=AbCdEf123456',
  )
  assert.deepEqual(parseInviteLink(link), {
    serverUrl: 'https://team.example.com:8443/sub',
    code: 'AbCdEf123456',
  })
})

test('extracts invite links embedded inside copied chat messages', () => {
  const message =
    '欢迎加入团队，下载 ShareGPT 后复制这条链接注册：sharegpt://invite?server=https%3A%2F%2Fcollab.example.com&code=XYZ_987-abc 即可登录'
  assert.deepEqual(parseInviteLink(message), {
    serverUrl: 'https://collab.example.com',
    code: 'XYZ_987-abc',
  })
})

test('parses https invite query and hash links and rejects invalid protocols', () => {
  assert.deepEqual(parseInviteLink('https://collab.example.com/invite?code=Code123'), {
    serverUrl: 'https://collab.example.com',
    code: 'Code123',
  })
  assert.deepEqual(parseInviteLink('https://collab.example.com/team/#invite=HashCode9'), {
    serverUrl: 'https://collab.example.com/team',
    code: 'HashCode9',
  })
  assert.equal(parseInviteLink('sharegpt://invite?server=javascript:alert(1)&code=bad'), null)
  assert.equal(parseInviteLink('not-a-link'), null)
})
