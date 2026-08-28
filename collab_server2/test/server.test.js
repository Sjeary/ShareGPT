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
const { WebSocket } = require("ws");

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
process.env.PROXY_ROUTES_FILE = path.join(tmpDir, "proxy_routes.json");
process.env.PROXY_ROUTE_HEALTH_FILE = path.join(tmpDir, "proxy_route_health.json");
process.env.RELEASES_DIR = path.join(tmpDir, "releases");
process.env.RELEASE_STORE = path.join(tmpDir, "release_shared");
process.env.SHARED_RELEASE_FILE = path.join(tmpDir, "release_shared", "release.json");
process.env.LOGIN_MAX_FAILS = "3"; // 测试用小阈值
process.env.LOGIN_LOCK_MS = "10000";

const srv = require("../server.js");

function createWebSocketProbe(url, protocols) {
  const socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  const buffered = [];
  const waiters = new Set();

  const settleWaiters = () => {
    for (const waiter of waiters) {
      const index = buffered.findIndex(waiter.predicate);
      if (index < 0) continue;
      const [message] = buffered.splice(index, 1);
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };

  socket.on("message", (raw) => {
    try {
      buffered.push(JSON.parse(String(raw)));
      settleWaiters();
    } catch {
      // Protocol tests only consume JSON application messages.
    }
  });

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket 连接超时: ${url}`)), 3000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const next = (predicate, label) =>
    new Promise((resolve, reject) => {
      const index = buffered.findIndex(predicate);
      if (index >= 0) {
        const [message] = buffered.splice(index, 1);
        resolve(message);
        return;
      }
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`等待 WebSocket 消息超时: ${label}`));
        }, 3000),
      };
      waiters.add(waiter);
    });

  return { socket, opened, next };
}

async function closeWebSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.close();
  await closed;
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

test("verifyPasswordAsync: 异步校验不会改变密码验证语义", async () => {
  const salt = "async-salt";
  const passwordHash = srv.hashPassword("correct-horse", salt, 120000, "sha256");
  const user = { passwordHash, salt, iterations: 120000, digest: "sha256" };
  assert.strictEqual(await srv.verifyPasswordAsync(user, "correct-horse"), true);
  assert.strictEqual(await srv.verifyPasswordAsync(user, "wrong"), false);
  assert.strictEqual(await srv.verifyPasswordAsync(null, "x"), false);
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

test("用户权限归一化只为缺失两个现代字段的历史记录保留 legacy 代理资格", () => {
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "allowed", advancedAiAllowed: true }).advancedAiAllowed,
    true,
  );
  const legacy = srv.normalizeUserRecord({ username: "legacy" });
  assert.strictEqual(legacy.advancedAiAllowed, false);
  assert.deepStrictEqual(legacy.allowedProxyRouteIds, []);
  assert.strictEqual(legacy.legacyProxyEntitled, true);
  assert.strictEqual(
    srv.normalizeUserRecord(legacy).legacyProxyEntitled,
    true,
    "持久化后的现代默认字段不得覆盖明确 legacy 标记",
  );
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "modern", advancedAiAllowed: false }).legacyProxyEntitled,
    false,
    "任一现代权限字段存在时不得推断为历史账号",
  );
  assert.strictEqual(
    srv.normalizeUserRecord({ username: "modern", allowedProxyRouteIds: [] })
      .legacyProxyEntitled,
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
      outbound: {
        type: "shadowsocks",
        server: "one.example.com",
        server_port: 443,
        method: "aes-128-gcm",
        password: "secret-one",
      },
      expected: { ip: "203.0.113.7", countryCode: "us" },
    },
    {
      id: "route-backup",
      name: "Backup",
      enabled: false,
      outbound: {
        type: "vmess",
        server: "two.example.com",
        server_port: 8443,
        uuid: "11111111-1111-4111-8111-111111111111",
      },
    },
  ];
  const saved = srv.saveProxyRouteCatalog(routes);
  assert.strictEqual(saved.routes.length, 2);
  assert.strictEqual(saved.routes[0].expected.countryCode, "US");
  assert.strictEqual(saved.routes[0].outbound.tag, undefined, "服务端必须接管 sing-box tag");
  assert.deepStrictEqual(srv.loadProxyRouteCatalog().routes, saved.routes);
  assert.throws(
    () => srv.saveProxyRouteCatalog([routes[0], routes[0]]),
    /routes\[1\]\.id.*不能重复/,
  );
});

test("代理线路保存按出站类型全量校验，并返回精确字段路径", () => {
  const catalogFile = process.env.PROXY_ROUTES_FILE;
  const before = fs.readFileSync(catalogFile, "utf-8");
  const validOutbounds = {
    socks: { type: "socks", server: "socks.example.com", server_port: 1080 },
    http: { type: "http", server: "http.example.com", server_port: 8080 },
    shadowsocks: {
      type: "shadowsocks",
      server: "ss.example.com",
      server_port: 443,
      method: "aes-128-gcm",
      password: "ss-password",
    },
    vmess: {
      type: "vmess",
      server: "vmess.example.com",
      server_port: 443,
      uuid: "22222222-2222-4222-8222-222222222222",
    },
    vless: {
      type: "vless",
      server: "vless.example.com",
      server_port: 443,
      uuid: "33333333-3333-4333-8333-333333333333",
    },
    trojan: {
      type: "trojan",
      server: "trojan.example.com",
      server_port: 443,
      password: "trojan-password",
    },
    hysteria2: {
      type: "hysteria2",
      server: "hy2.example.com",
      server_port: 443,
      password: "hy2-password",
    },
    tuic: {
      type: "tuic",
      server: "tuic.example.com",
      server_port: 443,
      uuid: "44444444-4444-4444-8444-444444444444",
      password: "tuic-password",
    },
  };
  const accepted = srv.saveProxyRouteCatalog(
    Object.entries(validOutbounds).map(([type, outbound]) => ({
      id: `valid-${type}`,
      enabled: false,
      outbound,
    })),
  );
  assert.strictEqual(accepted.routes.length, Object.keys(validOutbounds).length);
  srv.saveProxyRouteCatalog(JSON.parse(before).routes);
  const beforeInvalidSave = fs.readFileSync(catalogFile, "utf-8");
  const lastRequiredField = {
    socks: "server_port",
    http: "server_port",
    shadowsocks: "password",
    vmess: "uuid",
    vless: "uuid",
    trojan: "password",
    hysteria2: "password",
    tuic: "password",
  };
  for (const [type, requiredField] of Object.entries(lastRequiredField)) {
    const outbound = { ...validOutbounds[type] };
    delete outbound[requiredField];
    assert.throws(
      () => srv.saveProxyRouteCatalog([{ id: `missing-${type}`, outbound }]),
      new RegExp(`routes\\[0\\]\\.outbound\\.${requiredField}:`),
    );
  }
  assert.throws(
    () =>
      srv.saveProxyRouteCatalog([
        {
          id: "valid-socks",
          outbound: { type: "socks", server: "proxy.example.com", server_port: 1080 },
        },
        {
          id: "invalid-vmess",
          outbound: { type: "vmess", server: "vmess.example.com", server_port: 443 },
        },
      ]),
    /routes\[1\]\.outbound\.uuid: 不能为空字符串/,
  );
  assert.strictEqual(
    fs.readFileSync(catalogFile, "utf-8"),
    beforeInvalidSave,
    "任意一条线路非法时不得部分覆盖原目录",
  );
  assert.throws(
    () =>
      srv.saveProxyRouteCatalog([
        {
          id: "bad-port",
          outbound: { type: "http", server: "proxy.example.com", server_port: "8080" },
        },
      ]),
    /routes\[0\]\.outbound\.server_port: 必须是 1 到 65535 的整数/,
  );
  assert.throws(
    () =>
      srv.saveProxyRouteCatalog([
        {
          id: "unsupported",
          outbound: { type: "made-up", server: "proxy.example.com", server_port: 443 },
        },
      ]),
    /routes\[0\]\.outbound\.type: 不支持的 sing-box 出站类型/,
  );
});

test("代理线路备份创建失败时保存失败且主目录保持原样", () => {
  const catalogFile = process.env.PROXY_ROUTES_FILE;
  const before = fs.readFileSync(catalogFile, "utf-8");
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function patchedWriteFileSync(file, ...args) {
    if (String(file).includes(`${path.basename(catalogFile)}.backup-`)) {
      const error = new Error("backup unavailable");
      error.code = "EIO";
      throw error;
    }
    return originalWriteFileSync.call(this, file, ...args);
  };
  try {
    assert.throws(
      () =>
        srv.saveProxyRouteCatalog([
          {
            id: "must-not-commit",
            outbound: { type: "socks", server: "new.example.com", server_port: 1080 },
          },
        ]),
      /backup unavailable/,
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.strictEqual(fs.readFileSync(catalogFile, "utf-8"), before, "备份失败不得先改变主目录");
});

test("代理线路目录损坏后隔离主文件并恢复最近有效备份", () => {
  const catalogFile = process.env.PROXY_ROUTES_FILE;
  for (const name of fs.readdirSync(tmpDir)) {
    if (
      name.startsWith(`${path.basename(catalogFile)}.backup-`) ||
      name.startsWith(`${path.basename(catalogFile)}.corrupt-`)
    ) {
      fs.unlinkSync(path.join(tmpDir, name));
    }
  }
  const saved = srv.saveProxyRouteCatalog([
    {
      id: "recoverable-route",
      name: "Recoverable",
      enabled: true,
      outbound: { type: "socks", server: "recover.example.com", server_port: 1080 },
      expected: { ip: "203.0.113.20" },
    },
  ]);
  const invalidBackup = `${catalogFile}.backup-9999999999999-invalid`;
  fs.writeFileSync(invalidBackup, "not-json", "utf-8");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(invalidBackup, future, future);
  fs.writeFileSync(catalogFile, '{"version":1,"routes":[', "utf-8");
  const restored = srv.loadProxyRouteCatalog();
  assert.deepStrictEqual(restored, saved);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(catalogFile, "utf-8")), saved);
  assert.strictEqual(
    fs.readdirSync(tmpDir).filter((name) => name.startsWith("proxy_routes.json.corrupt-")).length,
    1,
  );
});

test("代理线路目录损坏且无有效备份时显式失败，权限错误不会被当作损坏", () => {
  const catalogFile = process.env.PROXY_ROUTES_FILE;
  for (const name of fs.readdirSync(tmpDir)) {
    if (
      name.startsWith(`${path.basename(catalogFile)}.backup-`) ||
      name.startsWith(`${path.basename(catalogFile)}.corrupt-`)
    ) {
      fs.unlinkSync(path.join(tmpDir, name));
    }
  }
  fs.writeFileSync(
    catalogFile,
    JSON.stringify({ version: 1, routes: [{ id: "broken" }] }),
    "utf-8",
  );
  assert.throws(() => srv.loadProxyRouteCatalog(), /线路目录已损坏并隔离，但没有可恢复的有效备份/);
  assert.strictEqual(fs.existsSync(catalogFile), false);
  assert.strictEqual(
    fs.readdirSync(tmpDir).filter((name) => name.startsWith("proxy_routes.json.corrupt-")).length,
    1,
  );

  const fallbackRoute = {
    id: "internal-airport",
    name: "US-LA-mac",
    enabled: true,
    outbound: { type: "socks", server: "legacy.example.com", server_port: 1080 },
    expected: { ip: "203.0.113.7" },
  };
  srv.saveProxyRouteCatalog([fallbackRoute]);
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(catalogFile)) {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    }
    return originalReadFileSync.call(this, file, ...args);
  };
  try {
    assert.throws(() => srv.loadProxyRouteCatalog(), /权限不足，EACCES/);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.strictEqual(fs.existsSync(catalogFile), true, "权限错误不得隔离或改名主目录");

  fs.unlinkSync(catalogFile);
  for (const name of fs.readdirSync(tmpDir)) {
    if (name.startsWith(`${path.basename(catalogFile)}.backup-`)) {
      fs.unlinkSync(path.join(tmpDir, name));
    }
  }
  fs.writeFileSync(
    process.env.AIRPORT_FILE,
    JSON.stringify({
      name: "Legacy airport",
      outbound: { type: "socks", server: "legacy.example.com", server_port: 1080 },
      updatedAt: "2026-08-20T00:00:00.000Z",
    }),
    "utf-8",
  );
  const legacyCatalog = srv.loadProxyRouteCatalog();
  assert.deepStrictEqual(
    legacyCatalog.routes.map((route) => route.id),
    ["internal-airport"],
    "主目录不存在时仍应兼容旧 airport.json",
  );
  srv.saveProxyRouteCatalog(legacyCatalog.routes);
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
      ],
    }),
    "utf8",
  );

  const openedSockets = new Set();
  await new Promise((resolve) => srv.server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of openedSockets) {
          if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        }
        srv.server.close(resolve);
      }),
  );
  const address = srv.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  fs.writeFileSync(
    process.env.CLIENT_BOOTSTRAP_FILE,
    JSON.stringify({
      sender: {
        proxy_server: "proxy.example.com",
        proxy_port: "443",
        proxy_uuid: "11111111-1111-4111-8111-111111111111",
        socks_listen_port: "1080",
        fallback_mode: "system_proxy",
        fallback_local_port: "",
        target_domains: "example.com",
      },
      update: {},
      extra: {},
    }),
    "utf8",
  );
  const legacyCatalog = srv.loadProxyRouteCatalog();
  srv.saveProxyRouteCatalog([
    ...legacyCatalog.routes,
    {
      id: "managed-new",
      name: "New managed route",
      enabled: true,
      outbound: { type: "socks", server: "new.example.com", server_port: 1080 },
      expected: { ip: "192.0.2.10" },
    },
  ]);

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
  assert.strictEqual(typeof token, "string");
  assert.ok(token.length > 0);
  assert.strictEqual(typeof loginBody.username, "string");
  assert.strictEqual(typeof loginBody.profile, "object");
  assert.strictEqual(typeof loginBody.profile.displayName, "string");
  assert.strictEqual(typeof loginBody.profile.avatar, "string");
  assert.strictEqual(typeof loginBody.roomScope, "string");
  assert.ok(Array.isArray(loginBody.users));
  assert.ok(Array.isArray(loginBody.history));
  assert.strictEqual(loginBody.profile.advancedAiAllowed, true);
  assert.deepStrictEqual(loginBody.capabilities, { websocketAuth: "subprotocol" });
  let authHeaders = { Authorization: `Bearer ${token}` };

  const wsBaseUrl = `ws://127.0.0.1:${address.port}/ws`;
  const legacySocket = createWebSocketProbe(`${wsBaseUrl}?token=${encodeURIComponent(token)}`);
  openedSockets.add(legacySocket.socket);
  await legacySocket.opened;
  assert.strictEqual(legacySocket.socket.protocol, "");
  const legacySession = await legacySocket.next((message) => message.type === "session", "session");
  assert.strictEqual(typeof legacySession.username, "string");
  assert.strictEqual(typeof legacySession.displayName, "string");
  assert.strictEqual(typeof legacySession.roomScope, "string");
  assert.strictEqual(typeof legacySession.timestamp, "string");
  const legacyHistory = await legacySocket.next((message) => message.type === "history", "history");
  assert.ok(Array.isArray(legacyHistory.messages));
  assert.strictEqual(typeof legacyHistory.roomScope, "string");

  legacySocket.socket.send(JSON.stringify({ type: "chat", text: "legacy subnet message" }));
  const legacyChat = await legacySocket.next(
    (message) => message.type === "chat" && message.text === "legacy subnet message",
    "legacy chat",
  );
  assert.strictEqual(typeof legacyChat.id, "string");
  assert.strictEqual(legacyChat.scope, "subnet");
  assert.strictEqual(legacyChat.from, "verify-user");
  assert.strictEqual(legacyChat.username, "verify-user");
  assert.strictEqual(typeof legacyChat.timestamp, "string");

  legacySocket.socket.send(JSON.stringify({ type: "history_sync", since: "" }));
  const legacySync = await legacySocket.next(
    (message) => message.type === "history_sync",
    "legacy history_sync",
  );
  assert.ok(Array.isArray(legacySync.messages));
  assert.ok(legacySync.messages.some((message) => message.text === "legacy subnet message"));
  assert.strictEqual(typeof legacySync.roomScope, "string");
  await closeWebSocket(legacySocket.socket);

  const modernSocket = createWebSocketProbe(wsBaseUrl, ["sharegpt", `sharegpt-auth.${token}`]);
  openedSockets.add(modernSocket.socket);
  await modernSocket.opened;
  assert.strictEqual(modernSocket.socket.protocol, "sharegpt");
  assert.strictEqual(
    (await modernSocket.next((message) => message.type === "session", "modern session")).username,
    "verify-user",
  );
  assert.ok(
    Array.isArray(
      (await modernSocket.next((message) => message.type === "history", "modern history")).messages,
    ),
  );
  await closeWebSocket(modernSocket.socket);

  let normalUserToken = "";
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
    const permissionBody = await permissionLogin.json();
    assert.strictEqual(permissionBody.profile.advancedAiAllowed, allowed);
    if (username === "normal-user") normalUserToken = permissionBody.token;
  }

  const migratedUsers = JSON.parse(fs.readFileSync(process.env.USERS_FILE, "utf8")).users;
  assert.strictEqual(
    migratedUsers.find((user) => user.username === "normal-user").legacyProxyEntitled,
    true,
    "旧 users.json 应持久化明确 legacy 代理资格",
  );
  assert.strictEqual(
    migratedUsers.find((user) => user.username === "verify-user").legacyProxyEntitled,
    false,
    "已有现代权限字段的账号不得被当成 legacy",
  );
  const legacyBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: { Authorization: `Bearer ${normalUserToken}` },
  });
  assert.strictEqual(legacyBootstrap.status, 200);
  const legacyBootstrapBody = await legacyBootstrap.json();
  assert.strictEqual(legacyBootstrapBody.authorization.advancedAiAllowed, false);
  assert.deepStrictEqual(legacyBootstrapBody.authorization.allowedProxyRouteIds, [
    "internal-unified",
    "internal-airport",
  ]);
  assert.deepStrictEqual(
    legacyBootstrapBody.proxyRoutes.map((route) => route.id),
    ["internal-unified", "internal-airport"],
    "legacy 资格只能保留两个历史内置出口，不能获得新 managed route",
  );
  assert.strictEqual(legacyBootstrapBody.airport?.name, "Legacy airport");

  const profile = await fetch(`${baseUrl}/api/profile`, { headers: authHeaders });
  assert.strictEqual(profile.status, 200);
  assert.strictEqual((await profile.json()).profile.username, "verify-user");

  const bootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, { headers: authHeaders });
  assert.strictEqual(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json();
  assert.strictEqual(typeof bootstrapBody.fetchedAt, "string");
  assert.ok(bootstrapBody.update && typeof bootstrapBody.update === "object");
  assert.deepStrictEqual(bootstrapBody.authorization, {
    username: "verify-user",
    isAdmin: false,
    advancedAiAllowed: true,
    allowedProxyRouteIds: ["internal-airport"],
  });
  assert.deepStrictEqual(
    bootstrapBody.proxyRoutes.map((route) => route.id),
    ["internal-airport"],
  );

  const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin-user", password }),
  });
  assert.strictEqual(adminLogin.status, 200);
  const adminLoginBody = await adminLogin.json();
  const adminToken = adminLoginBody.token;
  assert.strictEqual(adminLoginBody.profile.advancedAiAllowed, false);
  assert.strictEqual(adminLoginBody.profile.effectiveAdvancedAiAllowed, true);
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const legacyOldClientProfileSave = await fetch(
    `${baseUrl}/api/admin/users/normal-user`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders },
      body: JSON.stringify({
        displayName: "Normal User Legacy Save",
        password: "",
        avatar: "",
        bio: "v1.0.7 profile-only update",
        isAdmin: false,
        disabled: false,
        chatDisabled: false,
      }),
    },
  );
  assert.strictEqual(legacyOldClientProfileSave.status, 200);
  assert.strictEqual((await legacyOldClientProfileSave.json()).user.legacyProxyEntitled, true);
  assert.strictEqual(
    (
      await fetch(`${baseUrl}/api/client/bootstrap`, {
        headers: { Authorization: `Bearer ${normalUserToken}` },
      })
    ).status,
    200,
    "v1.0.7 管理端原始 payload 只改资料时不得清除 legacy 资格或注销会话",
  );
  const repeatedLegacyDefaults = await fetch(`${baseUrl}/api/admin/users/normal-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      displayName: "Normal User Renamed",
      isAdmin: false,
      advancedAiAllowed: false,
      allowedProxyRouteIds: [],
      disabled: false,
      chatDisabled: false,
    }),
  });
  assert.strictEqual(repeatedLegacyDefaults.status, 200);
  assert.strictEqual((await repeatedLegacyDefaults.json()).user.legacyProxyEntitled, true);
  const legacyBootstrapAfterOldSave = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: { Authorization: `Bearer ${normalUserToken}` },
  });
  assert.strictEqual(
    legacyBootstrapAfterOldSave.status,
    200,
    "重复提交等值现代默认字段不得清除 legacy 资格或注销会话",
  );
  assert.deepStrictEqual(
    (await legacyBootstrapAfterOldSave.json()).proxyRoutes.map((route) => route.id),
    ["internal-unified", "internal-airport"],
  );
  const applyModernProxyPolicy = await fetch(`${baseUrl}/api/admin/users/normal-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      advancedAiAllowed: true,
      allowedProxyRouteIds: ["managed-new"],
    }),
  });
  assert.strictEqual(applyModernProxyPolicy.status, 200);
  assert.strictEqual((await applyModernProxyPolicy.json()).user.legacyProxyEntitled, false);
  assert.strictEqual(
    (
      await fetch(`${baseUrl}/api/client/bootstrap`, {
        headers: { Authorization: `Bearer ${normalUserToken}` },
      })
    ).status,
    401,
    "真实现代权限变更仍必须注销旧会话",
  );
  const modernNormalLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "normal-user", password }),
  });
  assert.strictEqual(modernNormalLogin.status, 200);
  const modernNormalToken = (await modernNormalLogin.json()).token;
  const modernNormalBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: { Authorization: `Bearer ${modernNormalToken}` },
  });
  assert.strictEqual(modernNormalBootstrap.status, 200);
  const modernNormalBootstrapBody = await modernNormalBootstrap.json();
  assert.strictEqual(modernNormalBootstrapBody.authorization.advancedAiAllowed, true);
  assert.deepStrictEqual(
    modernNormalBootstrapBody.proxyRoutes.map((route) => route.id),
    ["managed-new"],
    "现代显式权限必须替代 legacy 内置出口资格",
  );
  const oldClientProfileSave = await fetch(`${baseUrl}/api/admin/users/verify-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      displayName: "Verify User Renamed",
      password: "",
      avatar: "",
      bio: "profile-only update",
      isAdmin: false,
      disabled: false,
      chatDisabled: false,
    }),
  });
  assert.strictEqual(oldClientProfileSave.status, 200);
  const profileOnlyUser = (await oldClientProfileSave.json()).user;
  assert.strictEqual(profileOnlyUser.advancedAiAllowed, true);
  assert.deepStrictEqual(profileOnlyUser.allowedProxyRouteIds, ["internal-airport"]);
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/users`, { headers: authHeaders })).status,
    200,
    "旧管理端的等值布尔字段不得注销被编辑用户",
  );

  const oldClientSelfSave = await fetch(`${baseUrl}/api/admin/users/admin-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      displayName: "Admin User Renamed",
      password,
      avatar: "",
      bio: "profile-only update",
      isAdmin: true,
      disabled: false,
      chatDisabled: false,
    }),
  });
  assert.strictEqual(oldClientSelfSave.status, 200);
  assert.strictEqual(
    (await fetch(`${baseUrl}/api/admin/users`, { headers: adminHeaders })).status,
    200,
    "管理员保存自身资料后管理 token 必须继续有效",
  );
  const selfDemotion = await fetch(`${baseUrl}/api/admin/users/admin-user`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ isAdmin: false }),
  });
  assert.strictEqual(selfDemotion.status, 400);
  assert.match(await selfDemotion.text(), /不能禁用自己|最后一个可用管理员/);
  const createTemporaryAdmin = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      username: "temporary-admin",
      password,
      isAdmin: true,
      advancedAiAllowed: false,
    }),
  });
  assert.strictEqual(createTemporaryAdmin.status, 200);
  const createdAdmin = (await createTemporaryAdmin.json()).user;
  assert.strictEqual(createdAdmin.advancedAiAllowed, false);
  assert.strictEqual(createdAdmin.effectiveAdvancedAiAllowed, true);
  const demoteTemporaryAdmin = await fetch(`${baseUrl}/api/admin/users/temporary-admin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({ isAdmin: false }),
  });
  assert.strictEqual(demoteTemporaryAdmin.status, 200);
  const demotedAdmin = (await demoteTemporaryAdmin.json()).user;
  assert.strictEqual(demotedAdmin.isAdmin, false);
  assert.strictEqual(demotedAdmin.advancedAiAllowed, false);
  assert.strictEqual(demotedAdmin.effectiveAdvancedAiAllowed, false);
  const rejectUnverifiableRoute = await fetch(`${baseUrl}/api/admin/proxy-routes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      routes: [
        {
          id: "route-without-identity",
          enabled: true,
          outbound: { type: "socks", server: "unknown.example.com", server_port: 1080 },
        },
      ],
    }),
  });
  assert.strictEqual(rejectUnverifiableRoute.status, 400);
  assert.match(await rejectUnverifiableRoute.text(), /预期出口 IP/);
  const saveRoutes = await fetch(`${baseUrl}/api/admin/proxy-routes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      routes: [
        {
          id: "route-us",
          name: "US primary",
          enabled: true,
          outbound: { type: "socks", server: "us.example.com", server_port: 1080 },
          expected: { ip: "203.0.113.7", countryCode: "US" },
        },
        {
          id: "route-eu",
          name: "EU backup",
          enabled: true,
          outbound: { type: "socks", server: "eu.example.com", server_port: 1080 },
          expected: { ip: "198.51.100.8", countryCode: "DE" },
        },
      ],
    }),
  });
  assert.strictEqual(saveRoutes.status, 200);
  assert.strictEqual((await saveRoutes.json()).routes.length, 2);

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
  assert.strictEqual(revokedBootstrap.status, 401);
  const relogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "verify-user", password }),
  });
  assert.strictEqual(relogin.status, 200);
  authHeaders = { Authorization: `Bearer ${(await relogin.json()).token}` };

  const authorizedBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
    headers: authHeaders,
  });
  assert.strictEqual(authorizedBootstrap.status, 200);
  const authorizedBootstrapBody = await authorizedBootstrap.json();
  assert.deepStrictEqual(
    authorizedBootstrapBody.proxyRoutes.map((route) => route.id),
    ["route-us"],
  );
  assert.deepStrictEqual(authorizedBootstrapBody.capabilities.proxyRoutes, {
    available: true,
    authoritative: true,
  });

  const catalogBeforeFailure = srv.loadProxyRouteCatalog();
  const catalogFile = process.env.PROXY_ROUTES_FILE;
  try {
    for (const name of fs.readdirSync(tmpDir)) {
      if (
        name.startsWith(`${path.basename(catalogFile)}.backup-`) ||
        name.startsWith(`${path.basename(catalogFile)}.corrupt-`)
      ) {
        fs.unlinkSync(path.join(tmpDir, name));
      }
    }
    fs.writeFileSync(catalogFile, '{"version":1,"routes":[', "utf-8");

    const degradedBootstrap = await fetch(`${baseUrl}/api/client/bootstrap`, {
      headers: authHeaders,
    });
    assert.strictEqual(degradedBootstrap.status, 200);
    const degradedBootstrapBody = await degradedBootstrap.json();

    assert.deepStrictEqual(degradedBootstrapBody.sender, {
      proxy_server: "proxy.example.com",
      proxy_port: "443",
      proxy_uuid: "11111111-1111-4111-8111-111111111111",
      proxy_expected_ip: "",
      proxy_expected_country: "",
      proxy_expected_asn: "",
      socks_listen_port: "1080",
      fallback_mode: "system_proxy",
      fallback_local_port: "",
      target_domains: "example.com",
    });
    assert.deepStrictEqual(degradedBootstrapBody.update, {
      version: "",
      notes: "",
      publishedAt: "",
      windows: { url: "", fileName: "" },
      macos: { url: "", fileName: "" },
    });
    assert.deepStrictEqual(degradedBootstrapBody.proxyRoutes, []);
    assert.strictEqual(degradedBootstrapBody.airport, null);
    assert.deepStrictEqual(degradedBootstrapBody.authorization, {
      username: "verify-user",
      isAdmin: false,
      advancedAiAllowed: false,
      allowedProxyRouteIds: [],
    });
    assert.deepStrictEqual(degradedBootstrapBody.capabilities.proxyRoutes, {
      available: false,
      authoritative: false,
    });
    assert.strictEqual(Object.hasOwn(degradedBootstrapBody, "error"), false);
    assert.strictEqual(JSON.stringify(degradedBootstrapBody).includes(tmpDir), false);
  } finally {
    srv.saveProxyRouteCatalog(catalogBeforeFailure.routes);
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
      checks: {
        httpCrossCheck: "passed",
        expectedIp: "passed",
        expectedCountry: "passed",
        dnsConfigured: "passed",
        ipv4EgressObserved: "passed",
        webRtcPolicyApplied: "not-checked",
      },
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
  assert.strictEqual(reports[0].ok, true);
  assert.strictEqual(reports[0].checks.httpCrossCheck, "passed");
  assert.strictEqual(reports[0].checks.webRtcPolicyApplied, "not-checked");

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
