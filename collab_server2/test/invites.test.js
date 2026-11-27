const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { readJsonStore, saveJsonStore } = require("../json_store");
const { createInviteHandler } = require("../invites");
const { createUserStore } = require("../user_store");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-invites-"));
for (const key of [
  "USERS_FILE",
  "SERVER_IDENTITY_FILE",
  "GPT_USAGE_FILE",
  "CHAT_HISTORY_FILE",
  "CLIENT_BOOTSTRAP_FILE",
  "CALENDARS_FILE",
  "USER_STORES_FILE",
  "FOCUS_FILE",
  "SHARED_RELEASE_FILE",
  "TRANSLATION_PROFILES_FILE",
  "TRANSLATION_USAGE_FILE",
  "FEEDBACK_FILE",
  "PROXY_MISSING_FILE",
  "AIRPORT_FILE",
  "PROXY_ROUTES_FILE",
  "PROXY_ROUTE_HEALTH_FILE",
  "INVITES_FILE",
]) {
  process.env[key] = path.join(directory, `${key}.json`);
}
process.env.RELEASE_STORE = path.join(directory, "release-store");
process.env.RELEASES_DIR = path.join(directory, "releases");
process.env.INVITE_RATE_MAX = "60";
const { server, createUserRecord, normalizeProxyRouteIds } = require("../server");
let base;
let token;
let ipSequence = 1;
async function request(
  url,
  body,
  {
    method = body === undefined ? "GET" : "POST",
    admin = false,
    ip = `198.51.100.${ipSequence++}`,
  } = {},
) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
      ...(admin ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}
async function create(body = {}) {
  const result = await request("/api/admin/invites", body, { admin: true });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.invite;
}
const register = (invite, username, extra = {}, options) =>
  request(
    "/api/invite/register",
    { code: invite.code, username, password: "test-password", ...extra },
    options,
  );
const preview = (invite) => request(`/api/invite/preview?code=${encodeURIComponent(invite.code)}`);
function changeInvite(id, change) {
  const store = readJsonStore(process.env.INVITES_FILE, "invites");
  Object.assign(
    store.invites.find((item) => item.id === id),
    change,
  );
  saveJsonStore(process.env.INVITES_FILE, store, "invites");
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const setup = await request("/api/admin/setup", {
    username: "private-admin",
    password: "test-password",
  });
  assert.equal(setup.status, 200);
  token = setup.data.token;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("administrator creates, lists and idempotently revokes persisted invites; unprivileged access fails", async () => {
  assert.equal((await request("/api/admin/invites")).status, 401);
  assert.equal((await request("/api/admin/invites", {})).status, 401);
  const invite = await create({
    note: "团队邀请",
    maxUses: 2,
    expiresInHours: 2,
    allowedProxyRouteIds: [" route-a ", "route-a"],
    chatDisabled: true,
    isAdmin: true,
    advancedAiAllowed: true,
  });
  assert.match(invite.code, /^[\w-]{24}$/);
  assert.match(invite.id, /^inv_/);
  assert.equal(invite.status, "active");
  assert.equal(invite.remainingUses, 2);
  assert.deepEqual(invite.allowedProxyRouteIds, ["route-a"]);
  assert.equal(invite.isAdmin, undefined);
  assert.equal(invite.advancedAiAllowed, undefined);
  const second = await create({ maxUses: null, expiresInHours: 0 });
  assert.equal(second.maxUses, null);
  assert.equal(second.remainingUses, null);
  const listed = await request("/api/admin/invites", undefined, { admin: true });
  assert.equal(listed.data.invites[0].id, second.id);
  assert.equal(listed.data.invites[1].createdBy, "private-admin");
  assert.equal((await request(`/api/admin/invites/${invite.id}/revoke`, {})).status, 401);
  const revoked = await request(`/api/admin/invites/${invite.id}/revoke`, {}, { admin: true });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.invite.status, "revoked");
  const again = await request(`/api/admin/invites/${invite.id}`, undefined, {
    admin: true,
    method: "DELETE",
  });
  assert.equal(again.data.invite.revokedAt, revoked.data.invite.revokedAt);
  assert.equal(
    (await request("/api/admin/invites/missing", undefined, { admin: true, method: "DELETE" }))
      .status,
    404,
  );
});

test("preview exposes only the public contract for every invitation state", async () => {
  const invite = await create({ note: "欢迎", maxUses: 1 });
  const valid = await preview(invite);
  assert.deepEqual(valid.data, {
    ok: true,
    valid: true,
    note: "欢迎",
    expiresAt: "",
    maxUses: 1,
    usedCount: 0,
    remainingUses: 1,
  });
  assert.equal((await preview({ code: "missing" })).status, 404);
  assert.equal((await preview({ code: "missing" })).data.reason, "invalid");
  for (const [reason, fields] of [
    ["expired", { expiresAt: "2000-01-01T00:00:00.000Z" }],
    [
      "exhausted",
      {
        expiresAt: "",
        usedCount: 1,
        registrations: [{ username: "private-member", registeredAt: new Date().toISOString() }],
      },
    ],
    ["revoked", { revokedAt: new Date().toISOString() }],
  ]) {
    changeInvite(invite.id, fields);
    const result = await preview(invite);
    assert.equal(result.status, 410);
    assert.deepEqual(Object.keys(result.data).sort(), ["message", "ok", "reason", "valid"]);
    assert.equal(result.data.reason, reason);
    assert.doesNotMatch(
      JSON.stringify(result.data),
      /private-admin|private-member|registrations|createdBy/,
    );
    assert.equal((await register(invite, `blocked-${reason}`)).status, 410);
  }
});

test("invited users can use standard login and cannot grant themselves privileged permissions", async () => {
  for (const routes of [[], ["route-a"]]) {
    const invite = await create({
      allowedProxyRouteIds: routes,
      chatDisabled: true,
      isAdmin: true,
      advancedAiAllowed: true,
    });
    const name = routes.length ? "routed-user" : "legacy-user";
    const result = await register(invite, ` ${name} `, {
      displayName: "  昵称  ",
      isAdmin: true,
      advancedAiAllowed: true,
      disabled: true,
      chatDisabled: false,
    });
    assert.deepEqual(result.data, { ok: true, username: name, displayName: "昵称" });
    assert.equal(result.status, 200);
    const user = readJsonStore(process.env.USERS_FILE, "users").users.find(
      (item) => item.username === name,
    );
    assert.equal(user.isAdmin, false);
    assert.equal(user.advancedAiAllowed, false);
    assert.equal(user.disabled, false);
    assert.equal(user.chatDisabled, true);
    assert.equal(user.legacyProxyEntitled, !routes.length);
    assert.deepEqual(user.allowedProxyRouteIds, routes);
    const login = await request("/api/login", { username: name, password: "test-password" });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
    assert.equal(
      (await request("/api/admin/login", { username: name, password: "test-password" })).status,
      401,
    );
    const updated = readJsonStore(process.env.INVITES_FILE, "invites").invites.find(
      (item) => item.id === invite.id,
    );
    assert.equal(updated.usedCount, 1);
    assert.equal(updated.registrations[0].username, name);
    assert.ok(updated.registrations[0].registeredAt);
  }
});

test("concurrent requests consume a single-use invite exactly once", async () => {
  const invite = await create({ maxUses: 1 });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => register(invite, `racer-${i}`)),
  );
  assert.equal(results.filter((item) => item.status === 200).length, 1);
  assert.equal(
    results.filter((item) => item.status === 410 && item.data.reason === "exhausted").length,
    7,
  );
  const users = readJsonStore(process.env.USERS_FILE, "users").users;
  assert.equal(users.filter((item) => item.username.startsWith("racer-")).length, 1);
});

test("case-insensitive username conflicts and invalid fields do not consume an invite", async () => {
  const invite = await create();
  assert.equal((await register(invite, "PRIVATE-ADMIN")).status, 409);
  assert.equal((await register(invite, "private-admin")).data.message, "该用户名已被占用");
  for (const username of ["a", "a:b", "has space", "a\u0000b", "a\u007fb", "a".repeat(41)]) {
    assert.equal((await register(invite, username)).status, 400);
  }
  for (const password of ["short", "      ", "x".repeat(129), 12345678]) {
    assert.equal((await register(invite, "valid-name", { password })).status, 400);
  }
  assert.equal((await preview(invite)).data.usedCount, 0);
  const result = await register(invite, "long-display", { displayName: `  ${"x".repeat(45)} ` });
  assert.equal(result.data.displayName.length, 40);
});

test("administrator validation rejects out-of-range settings and accepts unlimited forms", async () => {
  for (const body of [
    { maxUses: -1 },
    { maxUses: 1001 },
    { maxUses: 1.5 },
    { maxUses: "1" },
    { expiresInHours: 0.5 },
    { expiresInHours: 8761 },
    { expiresInHours: "12" },
    { note: "x".repeat(81) },
    { allowedProxyRouteIds: "route-a" },
  ]) {
    assert.equal((await request("/api/admin/invites", body, { admin: true })).status, 400);
  }
  assert.equal((await create({ maxUses: 0, expiresInHours: null })).maxUses, null);
  assert.equal((await create({ maxUses: 1000, expiresInHours: 1.5 })).maxUses, 1000);
});

test("public invitation rate limiting is IP-based and independent of standard login", async () => {
  const ip = "203.0.113.99";
  for (let i = 0; i < 60; i++) {
    assert.equal(
      (await request("/api/invite/preview?code=invalid", undefined, { ip })).status,
      404,
    );
  }
  const denied = await request("/api/invite/preview?code=other", undefined, { ip });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("Retry-After")) > 0);
  assert.equal((await register({ code: "invalid" }, "limited-user", {}, { ip })).status, 429);
  assert.equal(
    (await request("/api/login", { username: "private-admin", password: "test-password" }, { ip }))
      .status,
    200,
  );
  assert.equal((await preview({ code: "invalid" })).status, 404);
});

test("invitation corruption without backup blocks reads and writes without modifying originals", async () => {
  const file = process.env.INVITES_FILE;
  const original = fs.readFileSync(file);
  const damaged = "{corrupt-invite";
  fs.rmSync(`${file}.backup`, { force: true });
  fs.writeFileSync(file, damaged);
  const usersBefore = fs.readFileSync(process.env.USERS_FILE, "utf8");
  try {
    for (const result of [
      await preview({ code: "invalid" }),
      await register({ code: "invalid" }, "blocked-user"),
      await request("/api/admin/invites", undefined, { admin: true }),
      await request("/api/admin/invites", {}, { admin: true }),
    ]) {
      assert.equal(result.status, 500);
      assert.doesNotMatch(
        JSON.stringify(result.data),
        /INVITES_FILE|private-admin|\.json|corrupt-invite/,
      );
    }
    assert.equal(fs.readFileSync(file, "utf8"), damaged);
    assert.equal(fs.readFileSync(process.env.USERS_FILE, "utf8"), usersBefore);
  } finally {
    fs.writeFileSync(file, original);
  }
});

test("valid invitation backup recovery preserves the damaged original", async () => {
  const file = process.env.INVITES_FILE;
  const invite = await create();
  await create(); // A subsequent write backs up the invite being recovered.
  fs.writeFileSync(file, "{truncated");
  assert.equal((await preview(invite)).status, 200);
  assert.ok(
    fs.readdirSync(directory).some((name) => name.startsWith("INVITES_FILE.json.corrupt-")),
  );
});

test("malformed invitation records never create users, bypass limits or rewrite either store", async () => {
  const invite = await create({ maxUses: 1 });
  const file = process.env.INVITES_FILE;
  const original = fs.readFileSync(file);
  const inviteBackup = fs.readFileSync(`${file}.backup`);
  const usersBefore = fs.readFileSync(process.env.USERS_FILE);
  const usersBackup = fs.readFileSync(`${process.env.USERS_FILE}.backup`);
  const cases = [
    { registrations: undefined },
    { registrations: {} },
    { registrations: [null], usedCount: 1 },
    { registrations: [{ username: "member", registeredAt: "invalid" }], usedCount: 1 },
    { usedCount: undefined },
    { usedCount: "0" },
    { usedCount: -1 },
    { usedCount: 0.5 },
    { usedCount: Number.MAX_SAFE_INTEGER + 1 },
    { usedCount: 1 },
    { maxUses: undefined },
    { maxUses: 0 },
    { maxUses: -1 },
    { maxUses: 1.5 },
    { maxUses: "1" },
    { allowedProxyRouteIds: undefined },
    { allowedProxyRouteIds: "route" },
    { allowedProxyRouteIds: [1] },
    { code: "" },
    { code: 123 },
    { code: undefined },
    { expiresAt: "invalid" },
    { revokedAt: false },
    { chatDisabled: "false" },
    { createdAt: "invalid" },
  ];
  try {
    for (const [index, change] of cases.entries()) {
      const store = JSON.parse(original);
      Object.assign(
        store.invites.find((item) => item.id === invite.id),
        change,
      );
      const damaged = JSON.stringify(store);
      fs.writeFileSync(file, damaged);
      const code = Object.hasOwn(change, "code") ? change.code : invite.code;
      // Repeated consumption must fail without changing the malformed counter.
      for (let retry = 0; retry < 2; retry++) {
        const result = await register({ code }, `corrupt-${index}-${retry}`);
        assert.equal(result.status, 500, JSON.stringify(change));
        assert.deepEqual(result.data, { ok: false, message: "邀请服务暂不可用，请联系管理员" });
      }
      assert.equal(fs.readFileSync(file, "utf8"), damaged);
      assert.deepEqual(fs.readFileSync(`${file}.backup`), inviteBackup);
      assert.deepEqual(fs.readFileSync(process.env.USERS_FILE), usersBefore);
      assert.deepEqual(fs.readFileSync(`${process.env.USERS_FILE}.backup`), usersBackup);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
});

for (const failure of ["user-save", "registration-time", "invite-save"]) {
  test(`a failure at ${failure} compensates user creation and backup rotation`, async () => {
    const file = path.join(directory, `rollback-${failure}-invites.json`);
    const usersFile = path.join(directory, `rollback-${failure}-users.json`);
    const accounts = createUserStore(usersFile);
    accounts.save({ users: [createUserRecord("seed-admin", "test-password", { isAdmin: true })] });
    const invite = { ...(await create()), code: "rollback-code", usedCount: 0, registrations: [] };
    saveJsonStore(file, { invites: [invite] }, "invites");
    let userSaved = false;
    let failOnce = true;
    const handler = createInviteHandler({
      file,
      readBody: async () =>
        JSON.stringify({ code: invite.code, username: "rolled-back", password: "test-password" }),
      safeParseJson: JSON.parse,
      sendJson: (res, status, data) => Object.assign(res, { status, data }),
      requireAdminSession: () => null,
      resolveClientIp: () => "127.0.0.1",
      loadUserStore: accounts.load,
      saveUserStore: (store) => {
        accounts.save(store);
        userSaved = true;
        if (failure === "user-save" && failOnce) {
          failOnce = false;
          throw new Error("injected failure after user write");
        }
      },
      now: () => {
        if (failure === "registration-time" && userSaved) {
          throw new Error("injected registration failure");
        }
        return Date.now();
      },
      createUserRecord,
      normalizeProxyRouteIds,
      saveInvites: () => {
        throw new Error("injected storage failure");
      },
    });
    const res = {};
    await handler({ method: "POST" }, res, new URL("http://localhost/api/invite/register"));
    assert.equal(res.status, 500);
    assert.deepEqual(
      accounts.load().users.map((item) => item.username),
      ["seed-admin"],
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(`${usersFile}.backup`)).users.map((item) => item.username),
      ["seed-admin"],
    );
    assert.equal(readJsonStore(file, "invites").invites[0].usedCount, 0);
  });
}

test("a corrupt user store blocks registration before changing invitation usage", async () => {
  const invite = await create();
  const file = process.env.USERS_FILE;
  const original = fs.readFileSync(file);
  const backup = fs.readFileSync(`${file}.backup`);
  fs.rmSync(`${file}.backup`);
  fs.writeFileSync(file, "{damaged-accounts");
  const invitesBefore = fs.readFileSync(process.env.INVITES_FILE, "utf8");
  try {
    assert.equal((await register(invite, "must-not-register")).status, 500);
    assert.equal(fs.readFileSync(file, "utf8"), "{damaged-accounts");
    assert.equal(fs.readFileSync(process.env.INVITES_FILE, "utf8"), invitesBefore);
  } finally {
    fs.writeFileSync(file, original);
    fs.writeFileSync(`${file}.backup`, backup);
  }
});

test("administrator logout while reading a pending create or revoke body prevents the write", async () => {
  const invite = await create();
  for (const url of ["/api/admin/invites", `/api/admin/invites/${invite.id}/revoke`]) {
    const req = new PassThrough();
    req.method = "POST";
    req.url = url;
    req.headers = { authorization: `Bearer ${token}`, host: "localhost" };
    req.socket = { remoteAddress: "127.0.0.1" };
    let finish;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const res = {
      status: 0,
      writeHead(status) {
        this.status = status;
      },
      setHeader() {},
      end() {
        finish(this.status);
      },
    };
    server.emit("request", req, res);
    await new Promise((resolve) => setImmediate(resolve));
    await request("/api/admin/logout", {}, { admin: true });
    const before = fs.readFileSync(process.env.INVITES_FILE, "utf8");
    req.end("{}");
    assert.equal(await result, 401);
    assert.equal(fs.readFileSync(process.env.INVITES_FILE, "utf8"), before);
    token = (
      await request("/api/admin/login", { username: "private-admin", password: "test-password" })
    ).data.token;
  }
});
