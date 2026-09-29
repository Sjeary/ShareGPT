const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-admin-writes-"));
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
process.env.DEV_TOKEN = "fixture-developer-key";
process.env.SHAREGPT_TRANSLATION_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const { server, revokeUserSessions } = require("../server");
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function request(url, method, token, body, hold = false) {
  const req = new PassThrough();
  Object.assign(req, {
    method,
    url,
    headers: { host: "localhost", authorization: `Bearer ${token || ""}` },
    socket: { remoteAddress: "127.0.0.1" },
  });
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  const res = {
    writeHead(status) {
      this.status = status;
    },
    setHeader() {},
    end(value) {
      finish({ status: this.status, body: String(value) });
    },
  };
  server.emit("request", req, res);
  if (!hold) req.end(JSON.stringify(body || {}));
  return { req, result };
}
function snapshot() {
  const records = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else records[path.relative(directory, file)] = fs.readFileSync(file, "base64");
    }
  }
  visit(directory);
  return records;
}

test("revocation while reading an admin body prevents every privileged commit", async () => {
  const setup = await request("/api/admin/setup", "POST", "", {
    username: "admin",
    password: "fixture-password",
  }).result;
  assert.equal(setup.status, 200);
  const routes = [
    ["/api/admin/bootstrap", "PUT", { sender: { proxy_server: "fixture.example" } }],
    ["/api/admin/translation-profiles", "PUT", { profiles: [], defaultProfileId: "" }],
    [
      "/api/admin/airport",
      "PUT",
      {
        name: "fixture",
        outbound: { type: "socks", server: "fixture.example", server_port: 1080 },
      },
    ],
    [
      "/api/admin/proxy-routes",
      "PUT",
      {
        routes: [
          {
            id: "fixture",
            name: "fixture",
            enabled: true,
            outbound: { type: "socks", server: "fixture.example", server_port: 1080 },
          },
        ],
      },
    ],
    ["/api/admin/releases/upload?platform=windows&fileName=fixture.exe", "POST", "fixture-bytes"],
  ];
  for (const [url, method, body] of routes) {
    const login = await request("/api/admin/login", "POST", "", {
      username: "admin",
      password: "fixture-password",
    }).result;
    assert.equal(login.status, 200);
    const token = JSON.parse(login.body).token;
    const pending = request(url, method, token, null, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pending.req.listenerCount("data") > 0, `body reader started: ${url}`);
    revokeUserSessions("admin");
    const before = snapshot();
    pending.req.end(JSON.stringify(body));
    const response = await pending.result;
    assert.equal(response.status, 401, url);
    assert.deepEqual(snapshot(), before, `revoked request must not write: ${url}`);
    // A fresh session must still be able to perform the same supported operation.
    const again = await request("/api/admin/login", "POST", "", {
      username: "admin",
      password: "fixture-password",
    }).result;
    const allowed = await request(url, method, JSON.parse(again.body).token, body).result;
    assert.equal(allowed.status, 200, `${url}: ${allowed.body}`);
  }
});

test("developer logout while reading metadata or installer also prevents writes", async () => {
  for (const [url, method, body] of [
    ["/api/dev/release", "PUT", { version: "fixture" }],
    ["/api/dev/releases/upload?platform=windows&fileName=fixture.exe", "POST", "fixture-bytes"],
  ]) {
    const login = await request("/api/dev/login", "POST", "", { key: process.env.DEV_TOKEN })
      .result;
    assert.equal(login.status, 200);
    const token = JSON.parse(login.body).token;
    const pending = request(url, method, token, null, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pending.req.listenerCount("data") > 0);
    assert.equal((await request("/api/dev/logout", "POST", token, {}).result).status, 200);
    const before = snapshot();
    pending.req.end(JSON.stringify(body));
    assert.equal((await pending.result).status, 401);
    assert.deepEqual(snapshot(), before);
    const again = await request("/api/dev/login", "POST", "", { key: process.env.DEV_TOKEN })
      .result;
    assert.equal(
      (await request(url, method, JSON.parse(again.body).token, body).result).status,
      200,
    );
  }
});
