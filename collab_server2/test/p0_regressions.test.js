const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-p0-"));
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
process.env.LOGIN_ACCOUNT_MAX_FAILS = "6";

// 历史在模块加载时读取, 先写入一条带回应的消息来验证重启后的加载路径。
fs.writeFileSync(
  process.env.CHAT_HISTORY_FILE,
  JSON.stringify({
    history: [
      {
        id: "m1",
        type: "chat",
        scope: "subnet",
        from: "alice",
        username: "alice",
        text: "hello",
        subnetKey: "global",
        timestamp: "2026-01-01T00:00:00.000Z",
        reactions: { "👍": ["alice", "bob", "bob", ""], "": ["x"], "🎉": [] },
      },
    ],
  }),
);

const { server, createUserRecord, clearLoginFails } = require("../server");
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function request(url, body, options = {}) {
  const req = new PassThrough();
  req.method = options.method || "POST";
  req.url = url;
  req.headers = { host: "localhost", ...options.headers };
  req.socket = { remoteAddress: options.remoteAddress || "127.0.0.1" };
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const res = {
    writeHead(status) {
      this.status = status;
    },
    setHeader() {},
    end(text) {
      finish({ status: this.status, body: String(text) });
    },
  };
  server.emit("request", req, res);
  req.end(body === undefined ? "" : JSON.stringify(body));
  return result;
}

const accounts = { users: ["alice", "bob", "carol"].map((u) => createUserRecord(u, "pass-word")) };
fs.writeFileSync(process.env.USERS_FILE, JSON.stringify(accounts));

async function login(username, extra = {}) {
  const response = await request("/api/login", { username, password: "pass-word" }, extra);
  assert.equal(response.status, 200, response.body);
  return { authorization: `Bearer ${JSON.parse(response.body).token}` };
}

test("chat reactions survive a history reload", async () => {
  const response = await request("/api/login", { username: "alice", password: "pass-word" });
  const { history } = JSON.parse(response.body);
  const message = history.find((item) => item.id === "m1");
  assert.deepEqual(message.reactions, { "👍": ["alice", "bob"] });
});

test("only the organizer can edit a team event and nobody can rewrite other RSVPs", async () => {
  const alice = await login("alice");
  const bob = await login("bob");
  const created = await request(
    "/api/team-calendar/events",
    {
      title: "standup",
      start: "2026-11-02T01:00:00.000Z",
      attendees: [{ username: "bob" }, { username: "carol" }],
    },
    { headers: alice },
  );
  const { event } = JSON.parse(created.body);
  const url = `/api/team-calendar/events/${encodeURIComponent(event.id)}`;

  assert.equal((await request(`${url}/rsvp`, { status: "accept" }, { headers: bob })).status, 200);

  const hijack = await request(
    url,
    { title: "hijacked", attendees: [{ username: "alice", rsvp: "decline" }] },
    { method: "PATCH", headers: bob },
  );
  assert.equal(hijack.status, 403);

  const edited = await request(
    url,
    {
      title: "standup v2",
      attendees: [
        { username: "bob", rsvp: "decline" },
        { username: "dave", rsvp: "accept" },
      ],
    },
    { method: "PATCH", headers: alice },
  );
  assert.equal(edited.status, 200);
  const saved = JSON.parse(edited.body).event;
  assert.equal(saved.title, "standup v2");
  assert.deepEqual(
    saved.attendees.map((a) => [a.username, a.rsvp]),
    [
      ["bob", "accept"],
      ["dave", "needs_action"],
    ],
  );
});

test("failed logins behind the local reverse proxy are counted per real client", async () => {
  const proxied = (ip) => ({ headers: { "x-forwarded-for": ip } });
  for (let i = 0; i < 3; i++) {
    await request("/api/login", { username: "alice", password: "wrong" }, proxied("203.0.113.9"));
  }
  const attacker = await request(
    "/api/login",
    { username: "alice", password: "pass-word" },
    proxied("203.0.113.9"),
  );
  assert.equal(attacker.status, 429);
  // 另一名经同一反代访问的用户不受影响。
  await login("bob", proxied("198.51.100.4"));
  clearLoginFails("203.0.113.9");
});

test("a direct client cannot spoof X-Forwarded-For to dodge the limit", async () => {
  const direct = (fake) => ({ remoteAddress: "192.0.2.50", headers: { "x-forwarded-for": fake } });
  for (let i = 0; i < 3; i++) {
    await request("/api/login", { username: "carol", password: "wrong" }, direct(`10.0.0.${i}`));
  }
  const response = await request(
    "/api/login",
    { username: "carol", password: "pass-word" },
    direct("10.0.0.99"),
  );
  assert.equal(response.status, 429);
  clearLoginFails("192.0.2.50");
  clearLoginFails("account:carol");
});

test("one account is locked after too many failures from rotating addresses", async () => {
  for (let i = 0; i < 6; i++) {
    await request(
      "/api/login",
      { username: "carol", password: "wrong" },
      { headers: { "x-forwarded-for": `198.18.0.${i}` } },
    );
  }
  const response = await request(
    "/api/login",
    { username: "carol", password: "pass-word" },
    { headers: { "x-forwarded-for": "198.18.1.1" } },
  );
  assert.equal(response.status, 429);
  clearLoginFails("account:carol");
});

for (const [label, file, route, body] of [
  ["feedback", "FEEDBACK_FILE", "/api/feedback", { text: "new" }],
  ["focus stats", "FOCUS_FILE", "/api/focus/report", { minutes: 25 }],
  ["team calendar", "CALENDARS_FILE", "/api/team-calendar/events", { title: "t", start: "x" }],
]) {
  test(`a corrupt ${label} file without backup is preserved instead of overwritten`, async () => {
    const headers = await login("alice");
    const original = "{truncated";
    fs.rmSync(`${process.env[file]}.backup`, { force: true });
    fs.writeFileSync(process.env[file], original);
    const response = await request(route, body, { headers });
    assert.notEqual(response.status, 200);
    assert.equal(fs.readFileSync(process.env[file], "utf8"), original);
    fs.unlinkSync(process.env[file]);
  });
}

test("feedback recovers from its backup when the main file is corrupt", async () => {
  const headers = await login("alice");
  assert.equal((await request("/api/feedback", { text: "first" }, { headers })).status, 200);
  assert.equal((await request("/api/feedback", { text: "second" }, { headers })).status, 200);
  fs.writeFileSync(process.env.FEEDBACK_FILE, "{truncated");
  assert.equal((await request("/api/feedback", { text: "third" }, { headers })).status, 200);
  const items = JSON.parse(fs.readFileSync(process.env.FEEDBACK_FILE, "utf8")).items;
  assert.deepEqual(
    items.map((item) => item.text),
    ["first", "third"],
  );
});
