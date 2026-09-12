const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { once } = require("node:events");
const WebSocket = require("ws");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-auth-security-"));
for (const name of [
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
])
  process.env[name] = path.join(directory, `${name}.json`);
process.env.RELEASE_STORE = path.join(directory, "release-store");
process.env.RELEASES_DIR = path.join(directory, "releases");
process.env.LOGIN_MAX_FAILS = "3";
const { server, createUserRecord, clearLoginFails } = require("../server");
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function post(url, body, hold = false, options = {}) {
  const req = new PassThrough();
  req.method = options.method || "POST";
  req.url = url;
  req.headers = { host: "localhost", ...options.headers };
  req.socket = { remoteAddress: "127.0.0.1" };
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const res = {
    writeHead(status) {
      this.status = status;
    },
    setHeader() {},
    end(body) {
      finish({ status: this.status, body: String(body) });
    },
  };
  server.emit("request", req, res);
  if (!hold) req.end(JSON.stringify(body));
  return { req, result };
}

test("unreadable accounts do not reopen unauthenticated administrator setup", async () => {
  const original = "{truncated";
  fs.writeFileSync(process.env.USERS_FILE, original);
  const response = await post("/api/admin/setup", {
    username: "first-admin",
    password: "test-password",
  }).result;
  assert.equal(response.status, 400);
  assert.match(response.body, /账号数据不可用/);
  assert.equal(fs.readFileSync(process.env.USERS_FILE, "utf8"), original);
  fs.unlinkSync(process.env.USERS_FILE);
});

test("concurrent first-admin requests create exactly one administrator", async () => {
  const first = post("/api/admin/setup", null, true);
  const second = post("/api/admin/setup", null, true);
  first.req.end(JSON.stringify({ username: "first-admin", password: "test-password" }));
  assert.equal((await first.result).status, 200);
  second.req.end(JSON.stringify({ username: "second-admin", password: "test-password" }));
  assert.equal((await second.result).status, 409);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(process.env.USERS_FILE)).users.map((user) => user.username),
    ["first-admin"],
  );
});

test("disabling the last administrator does not reopen unauthenticated setup", async () => {
  const store = JSON.parse(fs.readFileSync(process.env.USERS_FILE));
  store.users[0].disabled = true;
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(store));
  const response = await post("/api/admin/setup", {
    username: "replacement",
    password: "test-password",
  }).result;
  assert.equal(response.status, 409);
  store.users[0].disabled = false;
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(store));
});

test("administrator password attempts are limited independently of ordinary login", async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    statuses.push(
      (await post("/api/admin/login", { username: "first-admin", password: "wrong" }).result)
        .status,
    );
  }
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
  const legacyLogin = await post("/api/login", {
    username: "first-admin",
    password: "test-password",
  }).result;
  assert.equal(legacyLogin.status, 200);
  assert.ok(JSON.parse(legacyLogin.body).token);
  // A successful ordinary login cannot reset the privileged login limiter.
  assert.equal(
    (await post("/api/admin/login", { username: "first-admin", password: "test-password" }).result)
      .status,
    429,
  );
});

async function openClient(url, token) {
  const ws = new WebSocket(`${url}/ws?token=${encodeURIComponent(token)}`);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await once(ws, "open");
  return { ws, messages };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected server message was not delivered");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("chat-disabled accounts retain legacy login and proxy access but cannot read or send chat", async (t) => {
  const accounts = JSON.parse(fs.readFileSync(process.env.USERS_FILE));
  accounts.users.push(createUserRecord("chat-disabled", "test-password", { chatDisabled: true }));
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(accounts));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpBase = `http://127.0.0.1:${server.address().port}`;
  const wsBase = httpBase.replace("http:", "ws:");
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const normalLogin = JSON.parse(
    (await post("/api/login", { username: "first-admin", password: "test-password" }).result).body,
  );
  const disabledLogin = JSON.parse(
    (await post("/api/login", { username: "chat-disabled", password: "test-password" }).result)
      .body,
  );
  assert.ok(disabledLogin.token);
  const normal = await openClient(wsBase, normalLogin.token);
  clients.push(normal);
  const disabled = await openClient(wsBase, disabledLogin.token);
  clients.push(disabled);
  normal.ws.send(JSON.stringify({ type: "chat", text: "allowed room message" }));
  await waitFor(() => normal.messages.some((message) => message.type === "chat"));
  const messageId = normal.messages.find((message) => message.type === "chat").id;
  const commands = [
    { type: "chat", text: "forbidden room message" },
    { type: "history_sync" },
    { type: "chat_typing", active: true },
    { type: "chat_react", messageId, emoji: "👍" },
    { type: "chat_read", scope: "subnet", messageIds: [messageId] },
  ];
  for (const command of commands) disabled.ws.send(JSON.stringify(command));
  await waitFor(
    () =>
      disabled.messages.filter((message) => message.type === "error").length === commands.length,
  );
  normal.ws.send(JSON.stringify({ type: "chat_react", messageId, emoji: "👍" }));
  await waitFor(() => normal.messages.some((message) => message.type === "chat_reaction"));
  const history = JSON.parse(fs.readFileSync(process.env.CHAT_HISTORY_FILE)).history;
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].reactions, { "👍": ["first-admin"] });
  assert.deepEqual(history[0].readBy, []);
  assert.equal(
    disabled.messages.some((message) =>
      ["history", "history_sync", "chat", "chat_reaction"].includes(message.type),
    ),
    false,
  );
  const bootstrap = await fetch(`${httpBase}/api/client/bootstrap`, {
    headers: { Authorization: `Bearer ${disabledLogin.token}` },
  });
  assert.equal(bootstrap.status, 200);
  assert.ok((await bootstrap.json()).sender);
  const relogin = JSON.parse(
    (await post("/api/login", { username: "chat-disabled", password: "test-password" }).result)
      .body,
  );
  assert.deepEqual(relogin.history, []);
});

test("private message reactions require participation while authorized legacy packets still work", async (t) => {
  const accounts = JSON.parse(fs.readFileSync(process.env.USERS_FILE));
  for (const username of ["recipient", "unrelated-member"]) {
    accounts.users.push(createUserRecord(username, "test-password"));
  }
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(accounts));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const wsBase = `ws://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  for (const username of ["first-admin", "recipient", "unrelated-member"]) {
    const login = JSON.parse(
      (await post("/api/login", { username, password: "test-password" }).result).body,
    );
    clients.push(await openClient(wsBase, login.token));
  }
  const [sender, recipient, outsider] = clients;
  sender.ws.send(
    JSON.stringify({ type: "chat", scope: "private", to: "recipient", text: "private fixture" }),
  );
  await waitFor(() => recipient.messages.some((message) => message.text === "private fixture"));
  const messageId = recipient.messages.find((message) => message.text === "private fixture").id;
  const beforeUnauthorizedReaction = fs.readFileSync(process.env.CHAT_HISTORY_FILE, "utf8");
  outsider.ws.send(JSON.stringify({ type: "chat_react", messageId, emoji: "👍" }));
  await waitFor(() => outsider.messages.some((message) => message.type === "error"));
  assert.equal(fs.readFileSync(process.env.CHAT_HISTORY_FILE, "utf8"), beforeUnauthorizedReaction);
  recipient.ws.send(JSON.stringify({ type: "chat_react", messageId, emoji: "👍" }));
  await waitFor(() =>
    sender.messages.some(
      (message) => message.type === "chat_reaction" && message.messageId === messageId,
    ),
  );
  const reaction = sender.messages.find(
    (message) => message.type === "chat_reaction" && message.messageId === messageId,
  );
  assert.deepEqual(reaction.reactions, { "👍": ["recipient"] });
  assert.equal(
    outsider.messages.some(
      (message) => message.type === "chat_reaction" && message.messageId === messageId,
    ),
    false,
  );
});

test("legacy user-store PUT preserves modern deletions and returns the canonical revision", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = JSON.parse(
    (await post("/api/login", { username: "first-admin", password: "test-password" }).result).body,
  );
  const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
  async function put(baseRev, data) {
    const response = await fetch(`${base}/api/user-store/calendar`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ baseRev, data }),
    });
    return { status: response.status, payload: await response.json() };
  }
  const initial = await put(0, { version: 1, calendars: [], events: [{ id: "removed" }] });
  assert.equal(initial.status, 200);
  const deleted = { events: { removed: "2026-01-02T03:04:05.000Z" } };
  assert.equal((await put(1, { version: 1, calendars: [], events: [], deleted })).status, 200);
  const legacyWrite = await put(2, {
    version: 1,
    calendars: [],
    events: [{ id: "removed" }, { id: "new" }],
  });
  assert.equal(legacyWrite.status, 200);
  assert.equal(legacyWrite.payload.rev, 3);
  assert.deepEqual(legacyWrite.payload.data.events, [{ id: "new" }]);
  assert.deepEqual(legacyWrite.payload.data.deleted, deleted);
  const conflict = await put(2, { version: 1, calendars: [], events: [{ id: "stale" }] });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.payload.data, legacyWrite.payload.data);
  const fetched = await fetch(`${base}/api/user-store/calendar`, { headers }).then((response) =>
    response.json(),
  );
  assert.equal(fetched.rev, 3);
  assert.deepEqual(fetched.data, legacyWrite.payload.data);
});

test("concurrent administrator edits retain unrelated account updates", async () => {
  const accounts = JSON.parse(fs.readFileSync(process.env.USERS_FILE));
  for (const username of ["edit-first", "edit-second"]) {
    accounts.users.push(createUserRecord(username, "test-password"));
  }
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(accounts));
  clearLoginFails("admin:127.0.0.1");
  const login = JSON.parse(
    (await post("/api/admin/login", { username: "first-admin", password: "test-password" }).result)
      .body,
  );
  const options = { method: "PATCH", headers: { authorization: `Bearer ${login.token}` } };
  const first = post("/api/admin/users/edit-first", null, true, options);
  const second = post("/api/admin/users/edit-second", null, true, options);
  second.req.end(JSON.stringify({ bio: "second account update" }));
  assert.equal((await second.result).status, 200);
  first.req.end(JSON.stringify({ displayName: "first account update" }));
  assert.equal((await first.result).status, 200);
  const saved = JSON.parse(fs.readFileSync(process.env.USERS_FILE)).users;
  assert.equal(
    saved.find((user) => user.username === "edit-first").displayName,
    "first account update",
  );
  assert.equal(saved.find((user) => user.username === "edit-second").bio, "second account update");
});

test("pending account writes stop when the administrator logs out", async () => {
  for (const method of ["PATCH", "POST"]) {
    const login = JSON.parse(
      (
        await post("/api/admin/login", { username: "first-admin", password: "test-password" })
          .result
      ).body,
    );
    const headers = { authorization: `Bearer ${login.token}` };
    const url = method === "PATCH" ? "/api/admin/users/edit-first" : "/api/admin/users";
    const pending = post(url, null, true, { method, headers });
    assert.equal((await post("/api/admin/logout", {}, false, { headers }).result).status, 200);
    const before = fs.readFileSync(process.env.USERS_FILE, "utf8");
    pending.req.end(
      JSON.stringify({
        username: "not-created",
        password: "test-password",
        displayName: "must not be saved",
      }),
    );
    assert.equal((await pending.result).status, 401);
    assert.equal(fs.readFileSync(process.env.USERS_FILE, "utf8"), before);
  }
});
