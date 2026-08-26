const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePrincipalId,
  normalizePrincipalUsername,
  normalizeServerOrigin,
  principalIdFor,
} = require("../principal");
const {
  partitionForAiEnvironment,
  partitionForAiKind,
  partitionForAiProfile,
} = require("../aiEnvironments");

test("principal identity is stable for normalized server origin and username", () => {
  const first = principalIdFor("HTTPS://Example.COM:443/path/", " User ");
  const second = principalIdFor("https://example.com", "user");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(normalizeServerOrigin("https://example.com/a"), "https://example.com");
  assert.equal(normalizePrincipalUsername(" ＵＳＥＲ "), "user");
});

test("principal and environment partition inputs are strictly validated", () => {
  const principalId = principalIdFor("https://example.com", "alice");
  assert.equal(normalizePrincipalId(principalId), principalId);
  assert.match(partitionForAiKind("gpt", principalId), new RegExp(principalId));
  assert.match(
    partitionForAiEnvironment("claude", "env-one", principalId),
    new RegExp(principalId),
  );
  assert.match(
    partitionForAiProfile("gpt", "gpt-profile-one", principalId),
    new RegExp(principalId),
  );
  assert.equal(partitionForAiKind("gpt", principalId, principalId), "persist:gpt-chat");
  assert.equal(
    partitionForAiEnvironment("claude", "env-one", principalId, principalId),
    "persist:sharegpt-ai-claude-env-one",
  );
  assert.throws(() => partitionForAiKind("gpt", "../shared"), /principal/);
  assert.throws(() => partitionForAiEnvironment("gpt", "__proto__", principalId), /环境标识/);
});
