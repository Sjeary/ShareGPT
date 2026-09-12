const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUserStore } = require("../user_store");

const account = { username: "Alice", salt: "test-salt", passwordHash: "test-hash", isAdmin: true };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-user-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "users.json");
  const identityFile = path.join(directory, "server_identity.json");
  return { directory, file, identityFile, store: createUserStore(file, { identityFile }) };
}

test("new deployment initializes accounts and recovers its first account from backup", (t) => {
  const { file, store } = fixture(t);
  assert.deepEqual(store.load(), { users: [] });
  store.save({ users: [account] });
  fs.unlinkSync(file);
  assert.deepEqual(store.load().users, [account]);
});

test("legacy accounts retain identity and entitlement fields across backup recovery", (t) => {
  const { directory, file, store } = fixture(t);
  const legacy = {
    ...account,
    identityUserId: "preserved",
    allowedProxyRouteIds: ["internal-airport"],
  };
  fs.writeFileSync(file, JSON.stringify({ users: [legacy] }));
  assert.deepEqual(store.load().users, [legacy]);
  fs.writeFileSync(file, "{truncated");
  assert.deepEqual(store.load().users, [legacy]);
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith("users.json.corrupt-")));
});

test("corrupt or invalid account data cannot be overwritten through normal account creation", (t) => {
  const { file, store } = fixture(t);
  for (const original of ["{truncated", '{"users":{}}', '{"users":[{}]}']) {
    fs.writeFileSync(file, original);
    assert.throws(() => store.load(), { code: "USER_STORE_UNAVAILABLE" });
    assert.throws(() => store.save({ users: [account] }), { code: "USER_STORE_UNAVAILABLE" });
    assert.equal(fs.readFileSync(file, "utf8"), original);
  }
});

test("missing account files or an empty backup do not reopen an established deployment", (t) => {
  const { file, store } = fixture(t);
  store.save({ users: [account] });
  fs.unlinkSync(file);
  fs.unlinkSync(`${file}.backup`);
  assert.throws(() => store.load(), { code: "USER_STORE_UNAVAILABLE" });
  fs.writeFileSync(`${file}.backup`, JSON.stringify({ users: [] }));
  assert.throws(() => store.load(), { code: "USER_STORE_UNAVAILABLE" });
});

test("legacy deployment identity also blocks initialization when accounts are missing", (t) => {
  const { identityFile, store } = fixture(t);
  fs.writeFileSync(identityFile, "{}");
  assert.throws(() => store.load(), { code: "USER_STORE_UNAVAILABLE" });
});
