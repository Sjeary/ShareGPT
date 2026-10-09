const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminAccountHandler } = require("../admin_accounts");

function fixture(users) {
  const store = { users: structuredClone(users) };
  const writes = [],
    revoked = [];
  const handler = createAdminAccountHandler({
    requireAdminSession: () => ({ username: "admin" }),
    readBody: async (req) => JSON.stringify(req.body),
    safeParseJson: JSON.parse,
    loadUserStore: () => store,
    saveUserStore: (value) => writes.push(structuredClone(value)),
    sendText: (res, status, body) => Object.assign(res, { status, body }),
    sendJson: (res, status, body) => Object.assign(res, { status, body }),
    safeText: (value) => String(value || "").trim(),
    nowIso: () => "2026-01-01T00:00:00Z",
    revokeUserSessions: (username) => revoked.push(username),
    normalizeUserRecord: (value) => value,
    adminUserSummary: (value) => value,
  });
  return {
    store,
    writes,
    revoked,
    update: async (body) => {
      const res = {};
      await handler({ method: "PATCH", body }, res, "/api/admin/users/admin");
      return res;
    },
  };
}

for (const patch of [{ disabled: true }, { isAdmin: false }, { disabled: true, isAdmin: false }]) {
  for (const other of [
    [],
    [{ username: "disabled-admin", isAdmin: true, disabled: true }],
    [{ username: "member", isAdmin: false, disabled: false }],
  ]) {
    test(`last enabled admin rejects ${JSON.stringify(patch)} with ${JSON.stringify(other)}`, async () => {
      const users = [{ username: "admin", isAdmin: true, disabled: false }, ...other];
      const f = fixture(users);
      const response = await f.update({ ...patch, displayName: "must not be saved" });
      assert.equal(response.status, 409);
      assert.deepEqual(f.store.users, users);
      assert.equal(f.writes.length, 0);
      assert.equal(f.revoked.length, 0);
    });
  }
  test(`a second enabled admin permits ${JSON.stringify(patch)} and revokes the changed account`, async () => {
    const f = fixture([
      { username: "admin", isAdmin: true },
      { username: "backup", isAdmin: true },
    ]);
    const response = await f.update(patch);
    assert.equal(response.status, 200);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.revoked, ["admin"]);
  });
}

test("sole administrator can still edit profile and re-enable an existing disabled account", async () => {
  const f = fixture([{ username: "admin", isAdmin: true, disabled: false }]);
  assert.equal(
    (await f.update({ displayName: "New name", disabled: false, isAdmin: true })).status,
    200,
  );
  assert.equal(f.store.users[0].displayName, "New name");
  assert.equal(f.revoked.length, 0);
  const disabled = fixture([{ username: "admin", isAdmin: true, disabled: true }]);
  assert.equal((await disabled.update({ disabled: false })).status, 200);
  assert.equal(disabled.store.users[0].disabled, false);
});
