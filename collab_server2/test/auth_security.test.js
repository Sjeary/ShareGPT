const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

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
const { server } = require("../server");
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function post(url, body, hold = false) {
  const req = new PassThrough();
  req.method = "POST";
  req.url = url;
  req.headers = { host: "localhost" };
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
