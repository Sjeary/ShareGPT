// collab_server2 单元测试 (Node 内置 test runner, 无第三方依赖)。
// 运行: npm test  (= node --test collab_server2/test)
//
// 注意: 必须在 require("../server.js") 之前把数据文件路径指到临时目录,
// 避免 require 时的顶层初始化(ensureUsersFile/loadChatHistoryStore 等)污染真实 data/。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-test-"));
process.env.USERS_FILE = path.join(tmpDir, "users.json");
process.env.GPT_USAGE_FILE = path.join(tmpDir, "gpt_usage.json");
process.env.CHAT_HISTORY_FILE = path.join(tmpDir, "chat_history.json");
process.env.CLIENT_BOOTSTRAP_FILE = path.join(tmpDir, "client_bootstrap.json");
process.env.USER_STORES_FILE = path.join(tmpDir, "user_stores.json");
process.env.CALENDARS_FILE = path.join(tmpDir, "calendars.json");
process.env.FOCUS_FILE = path.join(tmpDir, "focus_stats.json");
process.env.FEEDBACK_FILE = path.join(tmpDir, "feedback.json");
process.env.PROXY_MISSING_FILE = path.join(tmpDir, "proxy_missing.json");
process.env.AIRPORT_FILE = path.join(tmpDir, "airport.json");
process.env.RELEASES_DIR = path.join(tmpDir, "releases");
process.env.RELEASE_STORE = path.join(tmpDir, "release_shared");
process.env.SHARED_RELEASE_FILE = path.join(tmpDir, "release_shared", "release.json");
process.env.LOGIN_MAX_FAILS = "3"; // 测试用小阈值
process.env.LOGIN_LOCK_MS = "10000";

const srv = require("../server.js");

test("hashPassword: 确定性 + 不同 salt 产生不同 hash", () => {
  const a = srv.hashPassword("pw", "salt-1", 1000, "sha256");
  const b = srv.hashPassword("pw", "salt-1", 1000, "sha256");
  const c = srv.hashPassword("pw", "salt-2", 1000, "sha256");
  assert.strictEqual(a, b, "同输入应得到相同 hash");
  assert.notStrictEqual(a, c, "不同 salt 应得到不同 hash");
  assert.match(a, /^[0-9a-f]{64}$/, "应为 32 字节 hex");
});

test("verifyPassword: 正确密码 true, 错误密码 false", () => {
  const salt = "abc123";
  const passwordHash = srv.hashPassword("correct-horse", salt, 120000, "sha256");
  const user = { passwordHash, salt, iterations: 120000, digest: "sha256" };
  assert.strictEqual(srv.verifyPassword(user, "correct-horse"), true);
  assert.strictEqual(srv.verifyPassword(user, "wrong"), false);
  assert.strictEqual(srv.verifyPassword(null, "x"), false);
  assert.strictEqual(srv.verifyPassword({}, "x"), false);
});

test("writeJsonAtomic: 写出合法 JSON, 可覆盖, 不留临时文件", () => {
  const file = path.join(tmpDir, "atomic.json");
  srv.writeJsonAtomic(file, { a: 1, list: [1, 2, 3] });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf-8")), { a: 1, list: [1, 2, 3] });
  srv.writeJsonAtomic(file, { a: 2 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf-8")), { a: 2 });
  const leftovers = fs.readdirSync(tmpDir).filter((n) => n.includes("atomic.json.tmp"));
  assert.strictEqual(leftovers.length, 0, "不应残留 .tmp 文件");
});

test("normalizeIp: IPv6 映射与回环归一", () => {
  assert.strictEqual(srv.normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
  assert.strictEqual(srv.normalizeIp("::1"), "127.0.0.1");
  assert.strictEqual(srv.normalizeIp(""), "127.0.0.1");
  assert.strictEqual(srv.normalizeIp("203.0.113.7"), "203.0.113.7");
});

test("登录限流: 达到阈值后锁定, clear 后解锁", () => {
  const ip = "198.51.100.9";
  srv.clearLoginFails(ip);
  assert.strictEqual(srv.loginLockState(ip).locked, false);
  srv.recordLoginFail(ip); // 1
  srv.recordLoginFail(ip); // 2
  assert.strictEqual(srv.loginLockState(ip).locked, false, "未达阈值不应锁定");
  srv.recordLoginFail(ip); // 3 == LOGIN_MAX_FAILS
  const st = srv.loginLockState(ip);
  assert.strictEqual(st.locked, true, "达到阈值应锁定");
  assert.ok(st.retryAfterMs > 0, "应给出剩余锁定时间");
  srv.clearLoginFails(ip);
  assert.strictEqual(srv.loginLockState(ip).locked, false, "clear 后应解锁");
});

test("safeParseJson: 合法返回对象, 非法返回 null", () => {
  assert.deepStrictEqual(srv.safeParseJson('{"x":1}'), { x: 1 });
  assert.strictEqual(srv.safeParseJson("not json"), null); // 真正非法 -> null
  assert.deepStrictEqual(srv.safeParseJson(""), {}); // 空串按 "{}" 处理 -> {}
});

test("putUserStore: 乐观并发 — baseRev 不匹配则拒绝, 防止老版本覆盖新版本", () => {
  const stores = { stores: {} };

  // 初始空: rev 0。
  assert.strictEqual(srv.getUserStoreEntry(stores, "alice", "calendar").rev, 0);

  // 首次写入 baseRev=0 -> rev1。
  const r1 = srv.putUserStore(stores, "alice", "calendar", 0, { events: [{ id: "a" }] });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.rev, 1);
  assert.strictEqual(stores.stores.alice.calendar.rev, 1);

  // 老版本(baseRev=0)再写 -> 冲突, 不覆盖, 返回服务器当前(rev1)。
  const stale = srv.putUserStore(stores, "alice", "calendar", 0, { events: [{ id: "OLD" }] });
  assert.strictEqual(stale.ok, false);
  assert.strictEqual(stale.conflict, true);
  assert.strictEqual(stale.rev, 1);
  assert.deepStrictEqual(stale.data, { events: [{ id: "a" }] }, "冲突时不应被老数据覆盖");
  assert.strictEqual(stores.stores.alice.calendar.rev, 1, "rev 不应变化");

  // 用正确 baseRev=1 写 -> rev2 成功。
  const r2 = srv.putUserStore(stores, "alice", "calendar", 1, { events: [{ id: "b" }] });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.rev, 2);
  assert.deepStrictEqual(stores.stores.alice.calendar.data, { events: [{ id: "b" }] });

  // 不同用户/种类相互隔离。
  assert.strictEqual(srv.getUserStoreEntry(stores, "bob", "calendar").rev, 0);
  assert.strictEqual(srv.getUserStoreEntry(stores, "alice", "tasks").rev, 0);
});

test("旧客户端契约兼容 + 密码复核与隐私配置增量接口", async (t) => {
  const salt = "verify-password-salt";
  const password = "correct-password";
  fs.writeFileSync(
    process.env.USERS_FILE,
    JSON.stringify({
      users: [
        {
          username: "verify-user",
          displayName: "Verify User",
          salt,
          passwordHash: srv.hashPassword(password, salt, 120000, "sha256"),
          iterations: 120000,
          digest: "sha256",
          disabled: false,
        },
      ],
    }),
    "utf8",
  );

  await new Promise((resolve) => srv.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => srv.server.close(resolve)));
  const address = srv.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(health.status, 200);
  const healthBody = await health.json();
  assert.strictEqual(healthBody.ok, true);
  assert.strictEqual(typeof healthBody.serverTime, "string");

  const preflight = await fetch(`${baseUrl}/api/login`, { method: "OPTIONS" });
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "*");

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "verify-user", password }),
  });
  assert.strictEqual(login.status, 200);
  const { token } = await login.json();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const profile = await fetch(`${baseUrl}/api/profile`, { headers: authHeaders });
  assert.strictEqual(profile.status, 200);
  assert.strictEqual((await profile.json()).profile.username, "verify-user");

  const bootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders });
  assert.strictEqual(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json();
  assert.strictEqual(typeof bootstrapBody.fetchedAt, "string");
  assert.ok(bootstrapBody.update && typeof bootstrapBody.update === "object");

  const usage = await fetch(`${baseUrl}/api/gpt/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ count: 1 }),
  });
  assert.strictEqual(usage.status, 200);
  const usageBody = await usage.json();
  assert.strictEqual(usageBody.ok, true);
  assert.strictEqual(usageBody.service, "gpt");

  const stats = await fetch(`${baseUrl}/api/gpt/stats`, { headers: authHeaders });
  assert.strictEqual(stats.status, 200);
  const statsBody = await stats.json();
  assert.strictEqual(statsBody.totalQueries, 1);
  assert.ok(Array.isArray(statsBody.users));

  const calendar = await fetch(`${baseUrl}/api/user-store/calendar`, { headers: authHeaders });
  assert.strictEqual(calendar.status, 200);
  assert.strictEqual((await calendar.json()).rev, 0);

  const publicUpdate = await fetch(`${baseUrl}/api/public/update`);
  assert.strictEqual(publicUpdate.status, 200);
  assert.strictEqual(typeof (await publicUpdate.json()).version, "string");

  const wrong = await fetch(`${baseUrl}/api/account/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.strictEqual(wrong.status, 401);

  const correct = await fetch(`${baseUrl}/api/account/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  assert.strictEqual(correct.status, 200);
  assert.deepStrictEqual(await correct.json().then((body) => body.ok), true);

  const stillLoggedIn = await fetch(`${baseUrl}/api/users`, {
    headers: authHeaders,
  });
  assert.strictEqual(stillLoggedIn.status, 200, "密码复核不应替换或注销当前会话");

  const privacyPayload = {
    version: 1,
    updatedAt: "2026-07-10T10:00:00.000Z",
    environment: { mode: "proxy", timezone: "America/Los_Angeles" },
  };
  const savePrivacy = await fetch(`${baseUrl}/api/user-store/browser-privacy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ baseRev: 0, data: privacyPayload }),
  });
  assert.strictEqual(savePrivacy.status, 200);
  const loadPrivacy = await fetch(`${baseUrl}/api/user-store/browser-privacy`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(loadPrivacy.status, 200);
  assert.deepStrictEqual((await loadPrivacy.json()).data, privacyPayload);
});
