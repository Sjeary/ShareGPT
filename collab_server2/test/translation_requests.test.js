const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranslationRequestRegistry } = require("../translation_requests");

test("托管翻译取消按大小写敏感用户名和 requestId 隔离", () => {
  const registry = createTranslationRequestRegistry();
  const alice = registry.begin("Alice", "request-12345678");
  const lowerAlice = registry.begin("alice", "request-12345678");

  assert.equal(registry.cancel("Bob", "request-12345678"), false);
  assert.equal(registry.cancel("Alice", "other-request"), false);
  assert.equal(registry.cancel("Alice", "request-12345678"), true);
  assert.equal(alice.controller.signal.aborted, true);
  assert.equal(lowerAlice.controller.signal.aborted, false);

  registry.finish(alice.key, alice.controller);
  registry.finish(lowerAlice.key, lowerAlice.controller);
  assert.equal(registry.size(), 0);
});

test("托管翻译拒绝同一用户的并发重复 requestId", () => {
  const registry = createTranslationRequestRegistry();
  registry.begin("Alice", "request-12345678");
  assert.throws(() => registry.begin("Alice", "request-12345678"), /相同的翻译请求仍在处理中/);
});
