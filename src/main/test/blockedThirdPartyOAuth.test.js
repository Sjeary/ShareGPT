const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load the actual module without initializing Electron, logging or user profiles.
const loaded = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../appFactory.js"), "utf8"), {
  module: loaded,
  URL,
  require: (name) => {
    if (name === "./logger") return { scoped: () => ({}) };
    if (name === "./aiWorkspaceLifecycle") return require("../aiWorkspaceLifecycle");
    return {};
  },
});
const { classifyBlockedThirdPartyOAuth } = loaded.exports;

for (const [host, provider] of [
  ["accounts.google.com", "google"],
  ["appleid.apple.com", "apple"],
  ["login.microsoftonline.com", "microsoft"],
  ["login.live.com", "microsoft"],
]) {
  test(`GPT blocks ${host} and its subdomains only`, () => {
    for (const prefix of ["", "tenant."]) {
      assert.equal(
        classifyBlockedThirdPartyOAuth("gpt", `https://${prefix}${host}/oauth?state=test`),
        provider,
      );
      assert.equal(
        classifyBlockedThirdPartyOAuth("gpt", `https://${prefix}${host.toUpperCase()}./oauth`),
        provider,
      );
      for (const kind of ["claude", "gemini", ""])
        assert.equal(classifyBlockedThirdPartyOAuth(kind, `https://${prefix}${host}/`), null);
    }
    for (const url of [
      `https://${host}.example.org/`,
      `https://fake${host}/`,
      `https://${host}@example.org/`,
      `https://example.org/?next=https://${host}`,
      `ftp://${host}/`,
    ]) {
      assert.equal(classifyBlockedThirdPartyOAuth("gpt", url), null);
    }
  });
}

test("ordinary external links and invalid URLs retain the existing navigation path", () => {
  for (const url of [
    "",
    null,
    "not a URL",
    "https://google.com/",
    "https://example.org/",
    "https://chatgpt.com/",
    "javascript:alert(1)",
  ]) {
    assert.equal(classifyBlockedThirdPartyOAuth("gpt", url), null);
  }
});
