const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SERVER_ROOT = path.resolve(process.env.SHAREGPT_TEST_SERVER_ROOT || ROOT);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-legacy-protocol-"));
const dataFiles = {
  USERS_FILE: "users.json",
  SERVER_IDENTITY_FILE: "server_identity.json",
  GPT_USAGE_FILE: "gpt_usage.json",
  CHAT_HISTORY_FILE: "chat_history.json",
  CLIENT_BOOTSTRAP_FILE: "client_bootstrap.json",
  USER_STORES_FILE: "user_stores.json",
  CALENDARS_FILE: "calendars.json",
  FOCUS_FILE: "focus.json",
  FEEDBACK_FILE: "feedback.json",
  PROXY_MISSING_FILE: "proxy_missing.json",
  AIRPORT_FILE: "airport.json",
  PROXY_ROUTES_FILE: "proxy_routes.json",
  PROXY_ROUTE_HEALTH_FILE: "proxy_health.json",
  RELEASES_DIR: "releases",
  RELEASE_STORE: "release_shared",
  SHARED_RELEASE_FILE: "release_shared/release.json",
  TRANSLATION_PROFILES_FILE: "translation_profiles.json",
  TRANSLATION_USAGE_FILE: "translation_usage.json",
};
for (const [key, name] of Object.entries(dataFiles)) process.env[key] = path.join(directory, name);
process.env.DEV_TOKEN = "";
process.env.SHAREGPT_TRANSLATION_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
const serverRequire = createRequire(path.join(SERVER_ROOT, "collab_server2/server.js"));
const WebSocket = serverRequire("ws");
const server = serverRequire("./server.js");
const sockets = [];
const requests = [];
const legacy = {};
const fixture = fs.readFileSync(path.join(__dirname, "fixtures/legacy-sharegpt-v1.0.9.ts"), "utf8");
vm.runInNewContext(
  ts.transpileModule(fixture, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: legacy,
    WebSocket,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      if (String(url).endsWith("/api/login")) {
        const payload = JSON.parse(options.body);
        // Record field names only. Tokens, passwords and private identities never enter output.
        requests.push({ endpoint: "login", fields: Object.keys(payload).sort() });
      }
      return fetch(url, options);
    },
  },
);

function openSocket(url) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const received = [];
  const waiters = new Set();
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    received.push(message);
    for (const wake of waiters) wake();
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const next = (predicate) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error("legacy message timeout"));
      }, 8000);
      const check = () => {
        const match = received.find(predicate);
        if (!match) return;
        clearTimeout(timeout);
        waiters.delete(check);
        resolve(match);
      };
      waiters.add(check);
      check();
    });
  return { socket, opened, next };
}

async function run() {
  const password = "synthetic-compatibility-password";
  const users = ["legacy-alice", "legacy-bob"].map((username) =>
    server.createUserRecord(username, password, {
      allowedProxyRouteIds: ["internal-unified", "internal-airport"],
    }),
  );
  fs.writeFileSync(process.env.USERS_FILE, JSON.stringify({ users }));
  fs.writeFileSync(
    process.env.CLIENT_BOOTSTRAP_FILE,
    JSON.stringify({
      sender: {
        proxy_server: "proxy.example.test",
        proxy_port: "443",
        proxy_uuid: "synthetic-route-credential",
        socks_listen_port: "1080",
        target_domains: "chatgpt.com,claude.ai",
      },
      update: {},
    }),
  );
  server.saveProxyRouteCatalog([
    {
      id: "internal-airport",
      name: "Test alternate route",
      enabled: true,
      outbound: { type: "socks", server: "alternate.example.test", server_port: 1080 },
    },
  ]);
  await new Promise((resolve, reject) => {
    server.server.once("error", reject);
    server.server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.server.address().port}`;
  const client = {
    name: "ShareGPT",
    version: "1.0.9",
    platform: "win32",
    arch: "x64",
    mode: "sender",
  };
  const alice = await legacy.legacyLogin(baseUrl, "legacy-alice", password, client);
  const bob = await legacy.legacyLogin(baseUrl, "legacy-bob", password, client);
  assert.equal(alice.username, "legacy-alice");
  assert.equal(
    alice.identity,
    undefined,
    "old login has no identityNonce and needs no identity response",
  );
  assert.equal(
    requests.every((entry) => entry.fields.join(",") === "client,password,username"),
    true,
  );
  const bootstrap = legacy.normalizeBootstrapPayload(
    await legacy.fetchBootstrapRaw(baseUrl, alice.token),
  );
  assert.equal(legacy.hasCompleteSenderBootstrap(bootstrap.sender), true);
  assert.equal(bootstrap.sender.proxy_server, "proxy.example.test");
  assert.equal(bootstrap.sender.proxy_uuid, "synthetic-route-credential");
  const routeIds = Array.from(bootstrap.proxyRoutes, (route) => route.id).sort();
  assert.deepEqual(routeIds, ["internal-airport", "internal-unified"]);
  assert.equal(
    bootstrap.proxyRoutes.find((route) => route.id === "internal-airport").outbound.server,
    "alternate.example.test",
  );
  const first = openSocket(legacy.toWsUrl(baseUrl, alice.token));
  const second = openSocket(legacy.toWsUrl(baseUrl, bob.token));
  await Promise.all([first.opened, second.opened]);
  assert.equal(first.socket.protocol, "");
  const session = await first.next((message) => message.type === "session");
  assert.equal(session.username, alice.username);
  const history = await first.next((message) => message.type === "history");
  assert.ok(Array.isArray(history.messages));
  assert.equal(
    legacy.bindLegacySend(first.socket)({ text: "legacy public message", scope: "subnet", to: "" }),
    true,
  );
  const delivered = legacy.normalizeChatMessage(
    await second.next(
      (message) => message.type === "chat" && message.text === "legacy public message",
    ),
  );
  assert.equal(delivered.from, "legacy-alice");
  assert.equal(delivered.scope, "subnet");
  assert.ok(delivered.id);
  assert.equal(
    legacy.bindLegacySend(second.socket)({
      text: "legacy private reply",
      scope: "private",
      to: "legacy-alice",
    }),
    true,
  );
  const reply = legacy.normalizeChatMessage(
    await first.next(
      (message) => message.type === "chat" && message.text === "legacy private reply",
    ),
  );
  assert.equal(reply.from, "legacy-bob");
  assert.equal(reply.to, "legacy-alice");
  assert.equal(reply.scope, "private");
  console.log(
    JSON.stringify(
      {
        ok: true,
        legacyVersion: "1.0.9",
        legacySource: legacy.SOURCE_PROVENANCE,
        loginWithoutNewFields: requests,
        routes: routeIds,
        publicMessageDelivered: true,
        privateReplyDelivered: true,
        evidenceScope:
          "Frozen old production request, response normalization and send functions over real HTTP/WebSocket; not a packaged legacy UI run",
      },
      null,
      2,
    ),
  );
}

const watchdog = setTimeout(() => {
  console.error("legacy compatibility test exceeded 30 seconds");
  process.exitCode = 1;
  sockets.forEach((socket) => socket.terminate());
  server.server.close();
}, 30000);
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(watchdog);
    sockets.forEach((socket) => socket.terminate());
    server.server.closeAllConnections();
    await new Promise((resolve) => server.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
