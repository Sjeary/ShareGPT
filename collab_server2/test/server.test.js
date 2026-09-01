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
const WebSocket = require("ws");

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
process.env.AIRPORT_FILE = path.join(tmpDir, "legacy-data", "airport.json");
process.env.PROXY_ROUTES_FILE = path.join(tmpDir, "proxy_routes.json");
process.env.PROXY_ROUTE_HEALTH_FILE = path.join(tmpDir, "proxy_route_health.json");
process.env.RELEASES_DIR = path.join(tmpDir, "releases");
process.env.RELEASE_STORE = path.join(tmpDir, "release_shared");
process.env.SHARED_RELEASE_FILE = path.join(tmpDir, "release_shared", "release.json");
process.env.TRANSLATION_PROFILES_FILE = path.join(tmpDir, "translation_profiles.json");
process.env.TRANSLATION_USAGE_FILE = path.join(tmpDir, "translation_usage.json");
process.env.SHAREGPT_TRANSLATION_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LOGIN_MAX_FAILS = "3"; // 测试用小阈值
process.env.LOGIN_LOCK_MS = "10000";

const srv = require("../server.js");
const proxyRoutesBackupFile = `${process.env.PROXY_ROUTES_FILE}.backup`;

function snapshotFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function restoreFile(file, snapshot) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  if (snapshot !== null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, snapshot);
  }
}

function openJsonWebSocket(url) {
  const ws = new WebSocket(url);
  const queued = [];
  const waiters = [];

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(payload));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
      return;
    }
    queued.push(payload);
  });

  return {
    ws,
    opened: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    next(predicate, timeoutMs = 3000) {
      const queuedIndex = queued.findIndex(predicate);
      if (queuedIndex >= 0) return Promise.resolve(queued.splice(queuedIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("等待 WebSocket 消息超时"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

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

test("高级 AI 权限在用户记录中显式归一化", () => {
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "allowed", advancedAiAllowed: true }).advancedAiAllowed,
    true,
  );
  assert.strictEqual(srv.normalizeUserRecord({ username: "normal" }).advancedAiAllowed, false);
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "legacy" }).legacyProxyEntitled,
    true,
    "只有同时缺失现代权限字段的旧账号获得 legacy 资格",
  );
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "modern", advancedAiAllowed: false }).legacyProxyEntitled,
    false,
  );
  assert.deepStrictEqual(
    srv.normalizeUserRecord({
      username: "allowed",
      allowedProxyRouteIds: ["internal-unified", "Route-US", "../bad", "route-us"],
    }).allowedProxyRouteIds,
    ["internal-unified", "route-us"],
  );
});

test("代理线路目录支持多线路并拒绝重复稳定 ID", () => {
  const routes = [
    {
      id: "internal-airport",
      name: "US-LA-mac",
      enabled: true,
      outbound: { type: "shadowsocks", server: "one.example.com", server_port: 443 },
      expected: { ip: "203.0.113.7", countryCode: "us" },
    },
    {
      id: "route-backup",
      name: "Backup",
      enabled: false,
      outbound: { type: "vmess", server: "two.example.com", server_port: 8443 },
    },
  ];
  const saved = srv.saveProxyRouteCatalog(routes);
  assert.strictEqual(saved.routes.length, 2);
  assert.strictEqual(saved.routes[0].expected.countryCode, "US");
  assert.strictEqual(saved.routes[0].outbound.tag, undefined, "服务端必须接管 sing-box tag");
  assert.deepStrictEqual(srv.loadProxyRouteCatalog().routes, saved.routes);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(proxyRoutesBackupFile, "utf8")),
    saved,
    "有效现代主目录必须维护同内容的可信备份",
  );
  fs.unlinkSync(proxyRoutesBackupFile);
  assert.deepStrictEqual(srv.loadProxyRouteCatalog().routes, saved.routes);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(proxyRoutesBackupFile, "utf8")),
    saved,
    "读取有效现代主目录时必须补回缺失的可信备份",
  );
  assert.throws(() => srv.saveProxyRouteCatalog([routes[0], routes[0]]), /不能重复/);
});

test("现代线路目录损坏时只恢复严格验证过的现代备份", (t) => {
  const catalogSnapshot = snapshotFile(process.env.PROXY_ROUTES_FILE);
  const backupSnapshot = snapshotFile(proxyRoutesBackupFile);
  const airportSnapshot = snapshotFile(process.env.AIRPORT_FILE);
  t.after(() => {
    restoreFile(process.env.PROXY_ROUTES_FILE, catalogSnapshot);
    restoreFile(proxyRoutesBackupFile, backupSnapshot);
    restoreFile(process.env.AIRPORT_FILE, airportSnapshot);
  });

  const saved = srv.saveProxyRouteCatalog([
    {
      id: "recoverable-route",
      name: "Recoverable",
      outbound: { type: "socks", server: "recover.example.com", server_port: 1080 },
    },
  ]);
  fs.writeFileSync(process.env.PROXY_ROUTES_FILE, '{"version":1,"routes":[', "utf8");
  const restored = srv.readProxyRouteCatalogStatus();
  assert.strictEqual(restored.available, true);
  assert.strictEqual(restored.source, "modern-backup");
  assert.deepStrictEqual(restored.catalog, saved);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(process.env.PROXY_ROUTES_FILE, "utf8")),
    saved,
    "恢复后必须原子重建现代主目录",
  );

  fs.writeFileSync(process.env.PROXY_ROUTES_FILE, "", "utf8");
  const restoredFromEmpty = srv.readProxyRouteCatalogStatus();
  assert.strictEqual(restoredFromEmpty.available, true);
  assert.strictEqual(restoredFromEmpty.source, "modern-backup");
  assert.deepStrictEqual(restoredFromEmpty.catalog, saved, "空主文件也必须从现代备份恢复");

  fs.unlinkSync(proxyRoutesBackupFile);
  fs.mkdirSync(path.dirname(process.env.AIRPORT_FILE), { recursive: true });
  fs.writeFileSync(
    process.env.AIRPORT_FILE,
    JSON.stringify({
      name: "Stale legacy route",
      outbound: { type: "socks", server: "legacy.example.com", server_port: 1080 },
      updatedAt: "2026-08-20T00:00:00.000Z",
    }),
    "utf8",
  );
  fs.writeFileSync(
    process.env.PROXY_ROUTES_FILE,
    JSON.stringify({
      version: 1,
      routes: [
        {
          id: "valid-route",
          outbound: { type: "socks", server: "valid.example.com", server_port: 1080 },
        },
        { id: "invalid-route" },
      ],
    }),
    "utf8",
  );
  const unavailable = srv.readProxyRouteCatalogStatus();
  assert.strictEqual(unavailable.available, false);
  assert.strictEqual(unavailable.reason, "catalog_corrupt");
  assert.deepStrictEqual(unavailable.catalog.routes, []);
  assert.throws(
    () =>
      srv.saveProxyRouteCatalog([
        {
          id: "valid-route",
          outbound: { type: "socks", server: "valid.example.com", server_port: 1080 },
        },
        { id: "invalid-route" },
      ]),
    /routes\[1\] 无效/,
    "部分无效线路不得被静默过滤后发布",
  );
});

test("线路目录权限或路径错误保持 fail-closed，legacy 只用于明确兼容场景", (t) => {
  const catalogSnapshot = snapshotFile(process.env.PROXY_ROUTES_FILE);
  const backupSnapshot = snapshotFile(proxyRoutesBackupFile);
  const airportSnapshot = snapshotFile(process.env.AIRPORT_FILE);
  const usersSnapshot = snapshotFile(process.env.USERS_FILE);
  t.after(() => {
    restoreFile(process.env.PROXY_ROUTES_FILE, catalogSnapshot);
    restoreFile(proxyRoutesBackupFile, backupSnapshot);
    restoreFile(process.env.AIRPORT_FILE, airportSnapshot);
    restoreFile(process.env.USERS_FILE, usersSnapshot);
  });

  fs.mkdirSync(path.dirname(process.env.AIRPORT_FILE), { recursive: true });
  const legacyAirport = {
    name: "Legacy airport",
    outbound: { type: "socks", server: "legacy.example.com", server_port: 1080 },
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  fs.writeFileSync(process.env.AIRPORT_FILE, JSON.stringify(legacyAirport), "utf8");
  srv.saveProxyRouteCatalog([
    {
      id: "modern-route",
      outbound: { type: "socks", server: "modern.example.com", server_port: 1080 },
    },
  ]);

  const originalReadFileSync = fs.readFileSync;
  try {
    for (const [code, reason] of [
      ["EACCES", "catalog_permission_denied"],
      ["EISDIR", "catalog_unreadable"],
    ]) {
      fs.readFileSync = function patchedReadFileSync(file, ...args) {
        if (path.resolve(String(file)) === path.resolve(process.env.PROXY_ROUTES_FILE)) {
          const error = new Error("simulated read failure");
          error.code = code;
          throw error;
        }
        return originalReadFileSync.call(this, file, ...args);
      };
      const status = srv.readProxyRouteCatalogStatus();
      assert.strictEqual(status.available, false);
      assert.strictEqual(status.reason, reason);
      assert.deepStrictEqual(status.catalog.routes, [], "不得绕过现代目录回退陈旧 airport");
    }
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  fs.unlinkSync(process.env.PROXY_ROUTES_FILE);
  fs.unlinkSync(proxyRoutesBackupFile);
  assert.notStrictEqual(
    path.dirname(process.env.PROXY_ROUTES_FILE),
    path.dirname(process.env.AIRPORT_FILE),
    "测试必须覆盖现代与 legacy 数据分目录部署",
  );
  const missingModern = srv.readProxyRouteCatalogStatus();
  assert.strictEqual(missingModern.available, true);
  assert.strictEqual(missingModern.source, "legacy-airport");
  assert.deepStrictEqual(
    missingModern.catalog.routes.map((route) => route.id),
    ["internal-airport"],
  );

  const admin = srv.createUserRecord("legacy-admin", "legacy-password", { isAdmin: true });
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify({ users: [admin] }), "utf8");
  assert.deepStrictEqual(
    srv
      .proxyRoutesForUser("legacy-admin", { sender: {} }, missingModern.catalog)
      .map((route) => route.id),
    ["internal-airport"],
    "管理员在 legacy-only 部署中仍默认拥有全部有效线路",
  );

  fs.writeFileSync(process.env.PROXY_ROUTES_FILE, JSON.stringify(legacyAirport), "utf8");
  const explicitLegacy = srv.readProxyRouteCatalogStatus();
  assert.strictEqual(explicitLegacy.available, true);
  assert.strictEqual(explicitLegacy.source, "legacy-proxy-routes-file");
  assert.deepStrictEqual(
    explicitLegacy.catalog.routes.map((route) => route.id),
    ["internal-airport"],
  );
});

test("线路授权与多环境权限解耦，管理员始终拥有全部线路", (t) => {
  const originalCatalog = srv.loadProxyRouteCatalog();
  t.after(() => srv.saveProxyRouteCatalog(originalCatalog.routes));
  const password = "proxy-policy-password";
  const users = [
    srv.createUserRecord("advanced-only", password, { advancedAiAllowed: true }),
    srv.createUserRecord("fixed-route", password, {
      advancedAiAllowed: false,
      allowedProxyRouteIds: ["route-a"],
    }),
    srv.createUserRecord("admin-routes", password, { isAdmin: true }),
  ];
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify({ users }, null, 2));
  srv.saveProxyRouteCatalog([
    {
      id: "route-a",
      name: "A",
      enabled: true,
      outbound: { type: "socks", server: "a.example", server_port: 1080 },
    },
    {
      id: "route-b",
      name: "B",
      enabled: true,
      outbound: { type: "socks", server: "b.example", server_port: 1080 },
    },
  ]);
  const bootstrap = { sender: {} };

  assert.deepStrictEqual(srv.proxyRoutesForUser("advanced-only", bootstrap), []);
  assert.deepStrictEqual(
    srv.proxyRoutesForUser("fixed-route", bootstrap).map((route) => route.id),
    ["route-a"],
  );
  assert.deepStrictEqual(
    srv.proxyRoutesForUser("admin-routes", bootstrap).map((route) => route.id),
    ["route-a", "route-b"],
  );
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
          advancedAiAllowed: true,
          allowedProxyRouteIds: ["internal-airport"],
          disabled: false,
        },
        {
          username: "normal-user",
          displayName: "Normal User",
          salt,
          passwordHash: srv.hashPassword(password, salt, 120000, "sha256"),
          iterations: 120000,
          digest: "sha256",
          disabled: false,
        },
        {
          username: "admin-user",
          displayName: "Admin User",
          salt,
          passwordHash: srv.hashPassword(password, salt, 120000, "sha256"),
          iterations: 120000,
          digest: "sha256",
          isAdmin: true,
          disabled: false,
        },
        {
          username: "demoted-admin",
          displayName: "Demoted Admin",
          salt,
          passwordHash: srv.hashPassword(password, salt, 120000, "sha256"),
          iterations: 120000,
          digest: "sha256",
          isAdmin: true,
          advancedAiAllowed: true,
          disabled: false,
        },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(
    process.env.CLIENT_BOOTSTRAP_FILE,
    JSON.stringify({
      sender: {
        proxy_server: "proxy.example",
        proxy_port: "443",
        proxy_uuid: "server-secret",
        socks_listen_port: "19872",
      },
      update: {},
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
  const loginBody = await login.json();
  const { token } = loginBody;
  assert.strictEqual(typeof loginBody.token, "string");
  assert.strictEqual(loginBody.username, "verify-user");
  assert.ok(loginBody.profile && typeof loginBody.profile === "object");
  assert.strictEqual(typeof loginBody.roomScope, "string");
  assert.ok(Array.isArray(loginBody.users));
  assert.ok(Array.isArray(loginBody.history));
  assert.strictEqual(loginBody.profile.advancedAiAllowed, true);
  let authHeaders = { Authorization: `Bearer ${token}` };

  const legacySocket = openJsonWebSocket(
    `${baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`,
  );
  t.after(() => legacySocket.ws.terminate());
  await legacySocket.opened;
  assert.strictEqual(legacySocket.ws.protocol, "", "旧客户端无需 WebSocket subprotocol");
  const legacySession = await legacySocket.next((message) => message.type === "session");
  assert.strictEqual(legacySession.username, "verify-user");
  assert.strictEqual(typeof legacySession.roomScope, "string");
  const legacyHistory = await legacySocket.next((message) => message.type === "history");
  assert.ok(Array.isArray(legacyHistory.messages));

  legacySocket.ws.send(JSON.stringify({ type: "chat", text: "legacy chat message" }));
  const legacyChat = await legacySocket.next(
    (message) => message.type === "chat" && message.text === "legacy chat message",
  );
  assert.strictEqual(legacyChat.from, "verify-user");
  assert.strictEqual(legacyChat.username, "verify-user");
  assert.strictEqual(legacyChat.scope, "subnet");
  assert.strictEqual(typeof legacyChat.id, "string");
  assert.strictEqual(typeof legacyChat.timestamp, "string");

  legacySocket.ws.send(JSON.stringify({ type: "history_sync", since: "" }));
  const legacyHistorySync = await legacySocket.next(
    (message) =>
      message.type === "history_sync" &&
      message.messages?.some((item) => item.id === legacyChat.id),
  );
  assert.ok(Array.isArray(legacyHistorySync.messages));
  assert.strictEqual(typeof legacyHistorySync.roomScope, "string");
  await new Promise((resolve) => {
    legacySocket.ws.once("close", resolve);
    legacySocket.ws.close();
  });

  for (const [username, allowed] of [
    ["normal-user", false],
    ["admin-user", true],
  ]) {
    const permissionLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.strictEqual(permissionLogin.status, 200);
    assert.strictEqual((await permissionLogin.json()).profile.advancedAiAllowed, allowed);
  }

  const profile = await fetch(`${baseUrl}/api/profile`, { headers: authHeaders });
  assert.strictEqual(profile.status, 200);
  assert.strictEqual((await profile.json()).profile.username, "verify-user");

  const bootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders });
  assert.strictEqual(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json();
  assert.strictEqual(typeof bootstrapBody.fetchedAt, "string");
  assert.ok(bootstrapBody.update && typeof bootstrapBody.update === "object");
  assert.deepStrictEqual(
    bootstrapBody.proxyRoutes.map((route) => route.id),
    ["internal-airport"],
  );
  assert.strictEqual(bootstrapBody.sender.proxy_server, "");
  assert.strictEqual(bootstrapBody.sender.proxy_port, "");
  assert.strictEqual(bootstrapBody.sender.proxy_uuid, "");

  const adminClientLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin-user", password }),
  });
  assert.strictEqual(adminClientLogin.status, 200);
  const adminClientToken = (await adminClientLogin.json()).token;
  const adminClientBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: { Authorization: `Bearer ${adminClientToken}` },
  });
  assert.strictEqual(adminClientBootstrap.status, 200);
  const adminClientBootstrapBody = await adminClientBootstrap.json();
  assert.ok(adminClientBootstrapBody.sender.proxy_server);
  assert.ok(adminClientBootstrapBody.sender.proxy_port);
  assert.ok(adminClientBootstrapBody.sender.proxy_uuid);
  assert.ok(adminClientBootstrapBody.proxyRoutes.some((route) => route.id === "internal-unified"));

  const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin-user", password }),
  });
  assert.strictEqual(adminLogin.status, 200);
  const adminToken = (await adminLogin.json()).token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  assert.strictEqual(
    (await fetch(`${baseUrl}/api/admin/translation-profiles`)).status,
    401,
    "托管翻译配置只允许管理员读取",
  );
  const saveTranslationProfiles = await fetch(`${baseUrl}/api/admin/translation-profiles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      defaultProfileId: "restricted-ai",
      profiles: [
        {
          id: "restricted-ai",
          name: "Restricted AI",
          type: "ai",
          baseUrl: "https://translation.example.com/v1",
          model: "gpt-5-mini",
          apiKey: "integration-secret-key",
          enabled: true,
          accessMode: "restricted",
          allowedUsernames: ["verify-user"],
          pricing: { currency: "USD", inputPerMillion: 1, outputPerMillion: 2 },
        },
      ],
    }),
  });
  assert.strictEqual(saveTranslationProfiles.status, 200);
  const savedTranslationCatalog = await saveTranslationProfiles.json();
  assert.strictEqual(savedTranslationCatalog.profiles[0].apiKeyConfigured, true);
  assert.strictEqual(
    JSON.stringify(savedTranslationCatalog).includes("integration-secret-key"),
    false,
  );
  assert.doesNotMatch(
    fs.readFileSync(process.env.TRANSLATION_PROFILES_FILE, "utf8"),
    /integration-secret-key/,
  );
  const userTranslationProfiles = await fetch(`${baseUrl}/api/translation/profiles`, {
    headers: authHeaders,
  });
  assert.strictEqual(userTranslationProfiles.status, 200);
  assert.deepStrictEqual(
    (await userTranslationProfiles.json()).profiles.map((profile) => profile.id),
    ["restricted-ai"],
  );
  const normalTranslationLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "normal-user", password }),
  });
  const normalTranslationToken = (await normalTranslationLogin.json()).token;
  const normalTranslationProfiles = await fetch(`${baseUrl}/api/translation/profiles`, {
    headers: { Authorization: `Bearer ${normalTranslationToken}` },
  });
  assert.deepStrictEqual((await normalTranslationProfiles.json()).profiles, []);
  const forbiddenTranslation = await fetch(`${baseUrl}/api/translation/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalTranslationToken}`,
    },
    body: JSON.stringify({
      profileId: "restricted-ai",
      text: "不得发往上游",
      target: "en",
      requestId: "forbidden-request-1",
    }),
  });
  assert.strictEqual(forbiddenTranslation.status, 400, "服务端必须拒绝未获授权的 profileId");
  assert.match(await forbiddenTranslation.text(), /不存在、未启用或尚未配置密钥/);
  const translationStats = await fetch(`${baseUrl}/api/admin/translation-usage`, {
    headers: adminHeaders,
  });
  assert.strictEqual(translationStats.status, 200);
  assert.strictEqual((await translationStats.json()).totals.requests, 0);

  const demotedLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demoted-admin", password }),
  });
  const demotedToken = (await demotedLogin.json()).token;
  const demote = await fetch(`${baseUrl}/api/admin/users/demoted-admin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ isAdmin: false }),
  });
  assert.strictEqual(demote.status, 200);
  const demotedBody = await demote.json();
  assert.strictEqual(demotedBody.user.isAdmin, false);
  assert.strictEqual(
    demotedBody.user.advancedAiAllowed,
    false,
    "管理员降级且未显式传高级权限时必须清掉隐式授权",
  );
  assert.strictEqual(
    (
      await fetch(`${baseUrl}/api/client/bootstrap`, {
        headers: { Authorization: `Bearer ${demotedToken}` },
      })
    ).status,
    401,
    "管理员降级必须撤销旧 token",
  );
  const catalogSocket = openJsonWebSocket(
    `${baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`,
  );
  t.after(() => catalogSocket.ws.terminate());
  await catalogSocket.opened;
  await catalogSocket.next((message) => message.type === "session");
  const catalogSocketClosed = new Promise((resolve) =>
    catalogSocket.ws.once("close", (code) => resolve(code)),
  );
  const routeCatalogPayload = {
    routes: [
      {
        id: "route-us",
        name: "US primary",
        enabled: true,
        outbound: { type: "socks", server: "us.example.com", server_port: 1080 },
        expected: { countryCode: "US" },
      },
      {
        id: "route-eu",
        name: "EU backup",
        enabled: true,
        outbound: { type: "socks", server: "eu.example.com", server_port: 1080 },
      },
    ],
  };
  const saveRoutes = await fetch(`${baseUrl}/api/admin/proxy-routes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify(routeCatalogPayload),
  });
  assert.strictEqual(saveRoutes.status, 200);
  assert.strictEqual((await saveRoutes.json()).routes.length, 2);
  assert.strictEqual(await catalogSocketClosed, 4002, "目录变化必须关闭旧授权 WebSocket");
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders })).status,
    401,
    "目录变化后旧 token 不得继续取得线路 bootstrap",
  );
  const staleSocket = new WebSocket(
    `${baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`,
  );
  t.after(() => staleSocket.terminate());
  const staleSocketOutcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("旧线路授权 WebSocket 未及时拒绝")), 3000);
    staleSocket.once("open", () => {
      clearTimeout(timer);
      resolve("opened");
    });
    staleSocket.once("error", () => {
      clearTimeout(timer);
      resolve("rejected");
    });
    staleSocket.once("close", () => {
      clearTimeout(timer);
      resolve("rejected");
    });
  });
  assert.strictEqual(staleSocketOutcome, "rejected", "旧 epoch token 不得重新建立 WebSocket");
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/users`, { headers: authHeaders })).status,
    200,
    "线路授权过期不应删除 token 或阻断无关 REST",
  );

  const catalogRelogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "verify-user", password }),
  });
  assert.strictEqual(catalogRelogin.status, 200);
  authHeaders = { Authorization: `Bearer ${(await catalogRelogin.json()).token}` };
  const saveSameRoutes = await fetch(`${baseUrl}/api/admin/proxy-routes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify(routeCatalogPayload),
  });
  assert.strictEqual(saveSameRoutes.status, 200);
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders })).status,
    200,
    "等值目录保存不得让现有线路授权过期",
  );

  const authorizeRoute = await fetch(`${baseUrl}/api/admin/users/verify-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ allowedProxyRouteIds: ["route-us"] }),
  });
  assert.strictEqual(authorizeRoute.status, 200);
  assert.deepStrictEqual((await authorizeRoute.json()).user.allowedProxyRouteIds, ["route-us"]);

  const revokedBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: authHeaders,
  });
  assert.strictEqual(revokedBootstrap.status, 401, "线路授权变化必须撤销旧 token");

  const relogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "verify-user", password }),
  });
  assert.strictEqual(relogin.status, 200);
  authHeaders = { Authorization: `Bearer ${(await relogin.json()).token}` };
  const liveSocket = openJsonWebSocket(
    `${baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(authHeaders.Authorization.slice(7))}`,
  );
  t.after(() => liveSocket.ws.terminate());
  await liveSocket.opened;
  await liveSocket.next((message) => message.type === "session");

  const sameAuthorization = await fetch(`${baseUrl}/api/admin/users/verify-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ allowedProxyRouteIds: ["route-us"] }),
  });
  assert.strictEqual(sameAuthorization.status, 200);
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders })).status,
    200,
    "等值权限更新不能撤销会话",
  );

  const socketClosed = new Promise((resolve) => liveSocket.ws.once("close", resolve));
  const revokeAdvanced = await fetch(`${baseUrl}/api/admin/users/verify-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ advancedAiAllowed: false }),
  });
  assert.strictEqual(revokeAdvanced.status, 200);
  await socketClosed;
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders })).status,
    401,
    "高级能力变化必须撤销旧 token 和 WebSocket",
  );

  const restoreAdvanced = await fetch(`${baseUrl}/api/admin/users/verify-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ advancedAiAllowed: true }),
  });
  assert.strictEqual(restoreAdvanced.status, 200);

  const secondRelogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "verify-user", password }),
  });
  assert.strictEqual(secondRelogin.status, 200);
  authHeaders = { Authorization: `Bearer ${(await secondRelogin.json()).token}` };

  const authorizedBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: authHeaders,
  });
  assert.strictEqual(authorizedBootstrap.status, 200);
  const authorizedBootstrapBody = await authorizedBootstrap.json();
  assert.deepStrictEqual(
    authorizedBootstrapBody.proxyRoutes.map((route) => route.id),
    ["route-us"],
  );

  const validCatalog = srv.loadProxyRouteCatalog();
  fs.unlinkSync(proxyRoutesBackupFile);
  fs.writeFileSync(process.env.PROXY_ROUTES_FILE, '{"version":1,"routes":[', "utf8");
  try {
    const degradedBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
      headers: authHeaders,
    });
    assert.strictEqual(
      degradedBootstrap.status,
      503,
      "旧客户端必须在非 2xx 处停止应用，不能把临时不可用误作权威空线路",
    );
    const degradedText = await degradedBootstrap.text();
    const degradedBody = JSON.parse(degradedText);
    assert.strictEqual(Object.hasOwn(degradedBody, "proxyRoutes"), false);
    assert.strictEqual(Object.hasOwn(degradedBody, "airport"), false);
    assert.strictEqual(Object.hasOwn(degradedBody, "sender"), false);
    assert.strictEqual(degradedBody.error, "proxy_routes_unavailable");
    assert.deepStrictEqual(degradedBody.capabilities.proxyRoutes, {
      available: false,
      authoritative: false,
      reason: "catalog_corrupt",
    });
    assert.doesNotMatch(degradedText, /SyntaxError|Unexpected|proxy_routes\.json/i);
  } finally {
    srv.saveProxyRouteCatalog(validCatalog.routes);
  }
  const healthReport = await fetch(`${baseUrl}/api/client/proxy-route-health`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      routeId: "route-us",
      ok: true,
      ip: "203.0.113.7",
      countryCode: "US",
      asn: "AS64500",
      checks: { httpCrossCheck: true, dnsSameRoute: true },
    }),
  });
  assert.strictEqual(healthReport.status, 200);
  const adminHealth = await fetch(`${baseUrl}/api/admin/proxy-route-health`, {
    headers: adminHeaders,
  });
  assert.strictEqual(adminHealth.status, 200);
  const reports = (await adminHealth.json()).reports;
  assert.strictEqual(reports[0].routeId, "route-us");
  assert.strictEqual(reports[0].username, "verify-user");

  const usage = await fetch(`${baseUrl}/api/gpt/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ count: 1, usageId: "usage-once-1" }),
  });
  assert.strictEqual(usage.status, 200);
  const usageBody = await usage.json();
  assert.strictEqual(usageBody.ok, true);
  assert.strictEqual(usageBody.service, "gpt");

  const duplicateUsage = await fetch(`${baseUrl}/api/gpt/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ count: 1, usageId: "usage-once-1" }),
  });
  assert.strictEqual(duplicateUsage.status, 200);
  assert.strictEqual((await duplicateUsage.json()).duplicate, true);

  const legacyUsage = await fetch(`${baseUrl}/api/gpt/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ count: 1 }),
  });
  assert.strictEqual(legacyUsage.status, 200);
  assert.strictEqual((await legacyUsage.json()).duplicate, false);

  const stats = await fetch(`${baseUrl}/api/gpt/stats`, { headers: authHeaders });
  assert.strictEqual(stats.status, 200);
  const statsBody = await stats.json();
  assert.strictEqual(statsBody.totalQueries, 2);
  assert.ok(Array.isArray(statsBody.users));

  const calendar = await fetch(`${baseUrl}/api/user-store/calendar`, { headers: authHeaders });
  assert.strictEqual(calendar.status, 200);
  assert.strictEqual((await calendar.json()).rev, 0);

  const publicUpdate = await fetch(`${baseUrl}/api/public/update`);
  assert.strictEqual(publicUpdate.status, 200);
  assert.strictEqual(typeof (await publicUpdate.json()).version, "string");

  const wrong = await fetch(`${baseUrl}/api/account/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.strictEqual(wrong.status, 401);

  const correct = await fetch(`${baseUrl}/api/account/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
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
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ baseRev: 0, data: privacyPayload }),
  });
  assert.strictEqual(savePrivacy.status, 200);
  const loadPrivacy = await fetch(`${baseUrl}/api/user-store/browser-privacy`, {
    headers: authHeaders,
  });
  assert.strictEqual(loadPrivacy.status, 200);
  assert.deepStrictEqual((await loadPrivacy.json()).data, privacyPayload);
});
