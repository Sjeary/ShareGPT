const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { signLoginIdentity } = require("../../../collab_server2/server_identity");
const {
  verifiedIdentity,
  resolvePrincipalIdentity,
  linkPrincipalEndpoint,
} = require("../principalIdentity");
const { principalIdFor } = require("../principal");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const user = { username: "Alice" };
  const file = path.join(root, "server_identity.json");
  const nonce = "a".repeat(64);
  return { root, user, file, nonce, proof: signLoginIdentity(file, user, nonce) };
}

test("server identity persists across restart; proof binds account and fresh login challenge", (t) => {
  const { user, file, nonce, proof } = fixture(t);
  const nextNonce = "b".repeat(64);
  const next = signLoginIdentity(file, user, nextNonce, [user]);
  assert.equal(verifiedIdentity(proof, nonce, "Alice"), verifiedIdentity(next, nextNonce, "Alice"));
  assert.throws(() => verifiedIdentity(proof, nextNonce, "Alice"));
  assert.throws(() => verifiedIdentity(proof, nonce, "alice"));
  assert.throws(() => verifiedIdentity({ ...proof, userId: "0".repeat(36) }, nonce, "Alice"));
  // Windows reports synthetic POSIX mode bits; encryption/signature assertions still apply.
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(proof).includes("PRIVATE KEY"), false);
  fs.unlinkSync(file);
  assert.throws(() => signLoginIdentity(file, user, nextNonce, [user]), /missing/);
});

test("verified IP/domain/path changes reuse storage; impostors and missing proofs fail closed", (t) => {
  const { proof, nonce } = fixture(t);
  const oldUrl = "https://old.example/team";
  const nextUrl = "https://new.example/frp";
  const state = { byPrincipal: {} };
  const oldId = resolvePrincipalIdentity(state, oldUrl, "Alice", { proof, nonce }).principalId;
  state.byPrincipal[oldId] = { ownerUsername: "Alice", environments: ["preserve"] };
  assert.equal(
    resolvePrincipalIdentity(state, nextUrl, "Alice", { proof, nonce }).principalId,
    oldId,
  );
  assert.equal(
    resolvePrincipalIdentity(state, oldUrl, "Alice", { proof, nonce }).principalId,
    oldId,
  );
  assert.throws(() => resolvePrincipalIdentity(state, nextUrl, "Alice"), /缺少/);
  const attacker = fixture(t);
  assert.throws(() => resolvePrincipalIdentity(state, nextUrl, "Alice", attacker), /身份已改变/);
  assert.notEqual(
    resolvePrincipalIdentity(state, "https://different.example", "Alice", attacker).principalId,
    oldId,
  );
  assert.deepEqual(state.byPrincipal[oldId].environments, ["preserve"]);
});

test("explicit legacy endpoint link preserves both datasets and keeps personal/other accounts isolated", (t) => {
  const { proof, nonce } = fixture(t);
  const oldUrl = "http://old.example:8088";
  const nextUrl = "http://new.example:8088";
  const oldId = principalIdFor(oldUrl, "Alice");
  const nextId = principalIdFor(nextUrl, "Alice");
  const state = {
    byPrincipal: {
      [oldId]: { ownerServer: oldUrl, ownerUsername: "Alice", partitions: { gpt: "persist:old" } },
      [nextId]: {
        ownerServer: nextUrl,
        ownerUsername: "Alice",
        partitions: { gpt: "persist:new" },
      },
      "local-device": { partitions: { gpt: "persist:personal" } },
    },
  };
  const original = structuredClone(state.byPrincipal);
  linkPrincipalEndpoint(state, oldUrl, nextUrl, "Alice");
  assert.equal(resolvePrincipalIdentity(state, nextUrl, "Alice").principalId, oldId);
  assert.notEqual(resolvePrincipalIdentity(state, nextUrl, "alice").principalId, oldId);
  assert.equal(
    resolvePrincipalIdentity(state, nextUrl, "Alice", { proof, nonce }).principalId,
    oldId,
  );
  assert.equal(
    resolvePrincipalIdentity(state, "https://third.example", "Alice", { proof, nonce }).principalId,
    oldId,
  );
  assert.deepEqual(state.byPrincipal, original);
  assert.throws(() => linkPrincipalEndpoint(state, oldUrl, nextUrl, "Bob"));
});
