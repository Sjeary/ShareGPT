const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePrincipalId,
  normalizePrincipalUsername,
  normalizeServerBaseUrl,
  principalIdFor,
} = require("../principal");

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

test("principal ids are strictly validated", () => {
  const principalId = principalIdFor("https://example.com", "alice");
  assert.equal(normalizePrincipalId(principalId), principalId);
  assert.equal(normalizePrincipalId("../shared"), "");
  assert.equal(normalizePrincipalId("LOCAL-DEVICE", { allowLocal: true }), "local-device");
});

test("case- and path-distinct principals receive distinct stable ids", () => {
  const alice = principalIdFor("https://example.com/team-a", "Alice");
  const lowerAlice = principalIdFor("https://example.com/team-a", "alice");
  const otherTeam = principalIdFor("https://example.com/team-b", "Alice");
  assert.notEqual(alice, lowerAlice);
  assert.notEqual(alice, otherTeam);
});
