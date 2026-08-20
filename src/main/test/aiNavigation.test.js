const test = require("node:test");
const assert = require("node:assert");

const {
  isAllowedUrlForHosts,
  isWorkspaceUrlAllowed,
  normalizeHttpUrl,
} = require("../aiNavigation");

test("用户输入的网址只接受 HTTP/HTTPS，并可自动补 HTTPS", () => {
  assert.strictEqual(
    normalizeHttpUrl("example.com/verify?code=abc", { assumeHttps: true }),
    "https://example.com/verify?code=abc",
  );
  assert.strictEqual(normalizeHttpUrl("http://example.com/path"), "http://example.com/path");
  assert.strictEqual(normalizeHttpUrl("javascript:alert(1)", { assumeHttps: true }), "");
  assert.strictEqual(normalizeHttpUrl("file:///tmp/code.html", { assumeHttps: true }), "");
  assert.strictEqual(normalizeHttpUrl("not a valid host", { assumeHttps: true }), "");
});

test("普通 AI 标签继续使用域名白名单", () => {
  assert.strictEqual(isAllowedUrlForHosts("https://claude.ai/chat", ["claude.ai"]), true);
  assert.strictEqual(isAllowedUrlForHosts("https://auth.claude.ai/login", ["claude.ai"]), true);
  assert.strictEqual(isAllowedUrlForHosts("https://example.com/verify", ["claude.ai"]), false);
});

test("只有显式创建的 Claude 外部网页标签允许任意 HTTP/HTTPS", () => {
  const policy = { allowedHosts: ["claude.ai"] };
  assert.strictEqual(
    isWorkspaceUrlAllowed({ kind: "claude", policy }, "https://example.com/verify"),
    false,
  );
  assert.strictEqual(
    isWorkspaceUrlAllowed(
      { kind: "claude", policy, allowExternalBrowsing: true },
      "https://example.com/verify",
    ),
    true,
  );
  assert.strictEqual(
    isWorkspaceUrlAllowed(
      { kind: "gpt", policy, allowExternalBrowsing: true },
      "https://example.com/verify",
    ),
    false,
  );
  assert.strictEqual(
    isWorkspaceUrlAllowed(
      { kind: "claude", policy, allowExternalBrowsing: true },
      "data:text/html,unsafe",
    ),
    false,
  );
});
