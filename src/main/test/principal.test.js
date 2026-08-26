const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePrincipalId,
  normalizePrincipalUsername,
  normalizeServerBaseUrl,
  principalIdFor,
} = require("../principal");
const {
  partitionForAiEnvironment,
  partitionForAiKind,
  partitionForAiProfile,
} = require("../aiEnvironments");

test("principal identity canonicalizes the server base without discarding its path", () => {
  const first = principalIdFor("HTTPS://Example.COM:443/team-a/", "Alice");
  const second = principalIdFor("https://example.com/team-a", "Alice");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(normalizeServerBaseUrl("https://example.com/team-a/"), "https://example.com/team-a");
  assert.equal(normalizeServerBaseUrl("https://example.com/"), "https://example.com");
});

test("principal identity preserves the server-confirmed username exactly", () => {
  assert.notEqual(
    principalIdFor("https://example.com", "Alice"),
    principalIdFor("https://example.com", "alice"),
  );
  assert.notEqual(
    principalIdFor("https://example.com", "Ａlice"),
    principalIdFor("https://example.com", "Alice"),
  );
  assert.notEqual(
    principalIdFor("https://example.com", "\u00e9"),
    principalIdFor("https://example.com", "e\u0301"),
  );
  assert.equal(normalizePrincipalUsername(" Alice "), " Alice ");
});

test("principal identity rejects ambiguous server URLs and separates base paths", () => {
  assert.notEqual(
    principalIdFor("https://example.com/team-a", "Alice"),
    principalIdFor("https://example.com/team-b", "Alice"),
  );
  assert.equal(normalizeServerBaseUrl("https://example.com/team-a?tenant=b"), "");
  assert.equal(normalizeServerBaseUrl("https://example.com/team-a#fragment"), "");
  assert.equal(normalizeServerBaseUrl("https://user@example.com/team-a"), "");
  assert.equal(principalIdFor("https://example.com/team-a?tenant=b", "Alice"), "");
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

test("case- and path-distinct principals receive distinct persistent partitions", () => {
  const alice = principalIdFor("https://example.com/team-a", "Alice");
  const lowerAlice = principalIdFor("https://example.com/team-a", "alice");
  const otherTeam = principalIdFor("https://example.com/team-b", "Alice");
  assert.notEqual(partitionForAiKind("gpt", alice), partitionForAiKind("gpt", lowerAlice));
  assert.notEqual(partitionForAiKind("gpt", alice), partitionForAiKind("gpt", otherTeam));
});
