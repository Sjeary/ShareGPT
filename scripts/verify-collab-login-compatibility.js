const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PASSWORD = "correct-password";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function websocketFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  if (body.length >= 65536) throw new Error("fixture WebSocket payload is too large");
  const header =
    body.length < 126
      ? Buffer.from([0x80 | opcode, body.length])
      : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([header, body]);
}

function websocketCloseFrame(code, reason) {
  const text = Buffer.from(reason);
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return websocketFrame(0x8, payload);
}

function websocketClientPayload(frame) {
  if (frame.length < 2) return null;
  let length = frame[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (frame.length < 4) return null;
    length = frame.readUInt16BE(2);
    offset = 4;
  }
  const masked = Boolean(frame[1] & 0x80);
  if (!masked || frame.length < offset + 4 + length) return null;
  const mask = frame.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(frame.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return payload;
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for fixture lifecycle event");
}

function countEvents(events, type, username) {
  return events.filter((event) => event.type === type && event.username === username).length;
}

function unavailableBootstrap() {
  return {
    sender: {},
    update: {},
    proxyRoutes: [],
    capabilities: { proxyRoutes: { available: false, authoritative: false } },
  };
}

function managedRouteBootstrap(id, name = id) {
  return {
    sender: {},
    update: {},
    proxyRoutes: [
      {
        id,
        name,
        kind: "managed",
        outbound: { type: "socks", server: `${id}.example`, server_port: 1080 },
      },
    ],
    capabilities: { proxyRoutes: { available: true, authoritative: true } },
  };
}

function legacyAdminBootstrap() {
  return {
    sender: {
      proxy_server: "proxy.example",
      proxy_port: "443",
      proxy_uuid: "fixture-uuid",
      socks_listen_port: "19872",
    },
    airport: {
      name: "Legacy airport",
      outbound: { type: "socks", server: "airport.example", server_port: 1080 },
    },
    update: {},
  };
}

async function createFixtureServer() {
  const events = [];
  const tokens = new Map();
  const sockets = new Set();
  const socketUsers = new Map();
  const bootstrapCounts = new Map();
  let tokenSequence = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = JSON.parse((await readBody(request)) || "{}");
      events.push({ type: "login", username: body.username });
      if (body.password !== PASSWORD) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        response.end("密码错误");
        return;
      }
      const token =
        body.username === "same-token-double-revocation"
          ? "fixture-reused-token"
          : `fixture-token-${++tokenSequence}`;
      tokens.set(token, body.username);
      json(response, 200, {
        token,
        username: body.username,
        profile: {
          displayName: body.username,
          isAdmin: [
            "legacy-admin",
            "silent-relogin-legacy-admin",
            "authorization-persist-failure",
          ].includes(body.username),
        },
        history: [],
        users: [],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/client/bootstrap") {
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const username = tokens.get(token) || "";
      events.push({ type: "bootstrap", username });
      const bootstrapCount = (bootstrapCounts.get(username) || 0) + 1;
      bootstrapCounts.set(username, bootstrapCount);
      if (username === "same-token-double-revocation") {
        if (bootstrapCount === 1) {
          json(response, 200, managedRouteBootstrap("route-before-revocation"));
        } else if (bootstrapCount === 2) {
          json(response, 200, managedRouteBootstrap("route-after-first-relogin"));
        } else {
          json(response, 200, unavailableBootstrap());
        }
        return;
      }
      if (username === "authorization-persist-failure") {
        json(response, 200, bootstrapCount === 1 ? legacyAdminBootstrap() : unavailableBootstrap());
        return;
      }
      if (username === "bootstrap-500") {
        json(response, 500, { error: "fixture bootstrap failure" });
        return;
      }
      if (username === "server-503") {
        json(response, 503, {
          error: "proxy_routes_unavailable",
          capabilities: { proxyRoutes: { available: false, authoritative: false } },
        });
        return;
      }
      if (username === "bootstrap-timeout") {
        request.on("close", () => {
          if (!response.writableEnded) response.destroy();
        });
        return;
      }
      if (["unavailable", "silent-relogin-unavailable"].includes(username)) {
        json(response, 200, unavailableBootstrap());
        return;
      }
      if (["legacy-admin", "silent-relogin-legacy-admin"].includes(username)) {
        json(response, 200, legacyAdminBootstrap());
        return;
      }
      if (username === "legacy-routes") {
        json(response, 200, {
          sender: {},
          update: {},
          proxyRoutes: [
            {
              id: "route-legacy",
              name: "Legacy route",
              kind: "managed",
              outbound: { type: "socks", server: "legacy.example", server_port: 1080 },
            },
          ],
        });
        return;
      }
      if (username === "modern-routes") {
        json(response, 200, {
          sender: {},
          update: {},
          proxyRoutes: [
            {
              id: "route-modern",
              name: "Modern route",
              kind: "managed",
              outbound: { type: "socks", server: "modern.example", server_port: 1080 },
            },
          ],
          capabilities: { proxyRoutes: { available: true, authoritative: true } },
        });
        return;
      }
      // v1.0.x additive response: collaboration config exists, the later route catalogue does not.
      json(response, 200, { sender: {}, update: {} });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      events.push({ type: "logout", username: tokens.get(token) || "" });
      tokens.delete(token);
      json(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const username = tokens.get(url.searchParams.get("token")) || "";
    const key = String(request.headers["sec-websocket-key"] || "");
    if (url.pathname !== "/ws" || !username || !key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );
    sockets.add(socket);
    socketUsers.set(socket, username);
    const forgetSocket = () => {
      sockets.delete(socket);
      socketUsers.delete(socket);
    };
    socket.once("close", forgetSocket);
    socket.on("error", forgetSocket);
    socket.on("data", (frame) => {
      if ((frame[0] & 0x0f) !== 0x8 || socket.destroyed) return;
      const payload = websocketClientPayload(frame);
      socket.end(websocketFrame(0x8, payload || Buffer.alloc(0)));
    });
    const connectionCount = events.filter(
      (event) => event.type === "ws" && event.username === username,
    ).length;
    events.push({ type: "ws", username });
    socket.write(
      websocketFrame(
        0x1,
        JSON.stringify({ type: "session", username, roomScope: "fixture", users: [] }),
      ),
    );
    if (username.startsWith("silent-relogin-") && connectionCount === 0) {
      setTimeout(() => {
        if (!socket.destroyed) socket.end(websocketCloseFrame(4002, "fixture restart"));
      }, 100);
    }
  });
  await listen(server);
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    events,
    closeUserSocket(username, reason = "fixture authorization revoked") {
      const socket = [...sockets]
        .reverse()
        .find((candidate) => socketUsers.get(candidate) === username && !candidate.destroyed);
      if (!socket) return false;
      events.push({ type: "fixture-close", username });
      socket.end(websocketCloseFrame(4002, reason));
      return true;
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

async function installPrincipalClearDelay(electronApp, delayMs) {
  await electronApp.evaluate(({ ipcMain }, delay) => {
    const handlers = ipcMain._invokeHandlers;
    if (!(handlers instanceof Map))
      throw new Error("Electron ipcMain invoke handler map unavailable");
    const original = handlers.get("settings:principal-clear");
    if (typeof original !== "function") throw new Error("settings:principal-clear handler missing");
    ipcMain.removeHandler("settings:principal-clear");
    let delayed = false;
    ipcMain.handle("settings:principal-clear", async (event, ...args) => {
      if (!delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return original(event, ...args);
    });
  }, delayMs);
}

async function installAuthorizationPersistenceFailure(electronApp) {
  await electronApp.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    if (!(handlers instanceof Map))
      throw new Error("Electron ipcMain invoke handler map unavailable");
    const patchHandler = handlers.get("settings:patch");
    const stopHandler = handlers.get("sender:stop");
    if (typeof patchHandler !== "function" || typeof stopHandler !== "function") {
      throw new Error("settings:patch or sender:stop handler missing");
    }
    globalThis.__sharegptCollabCompatibilityIpc = {
      patchFailures: 0,
      stopCalls: 0,
      authorizationPatches: [],
    };
    ipcMain.removeHandler("settings:patch");
    ipcMain.handle("settings:patch", async (event, payload) => {
      const isAuthorizationInvalidation =
        payload?.section === "sender" &&
        Array.isArray(payload?.patch?.authorized_proxy_route_ids) &&
        payload.patch.authorized_proxy_route_ids.length === 0;
      if (
        isAuthorizationInvalidation &&
        globalThis.__sharegptCollabCompatibilityIpc.patchFailures === 0
      ) {
        globalThis.__sharegptCollabCompatibilityIpc.patchFailures += 1;
        globalThis.__sharegptCollabCompatibilityIpc.authorizationPatches.push({ failed: true });
        throw new Error("fixture settings persistence failure");
      }
      const result = await patchHandler(event, payload);
      if (isAuthorizationInvalidation) {
        globalThis.__sharegptCollabCompatibilityIpc.authorizationPatches.push({
          failed: false,
          returnedAuthorizedIds: result?.sender?.authorized_proxy_route_ids,
        });
      }
      return result;
    });
    ipcMain.removeHandler("sender:stop");
    ipcMain.handle("sender:stop", (event, ...args) => {
      globalThis.__sharegptCollabCompatibilityIpc.stopCalls += 1;
      return stopHandler(event, ...args);
    });
  });
}

async function readAuthorizationFailureMetrics(electronApp) {
  return electronApp.evaluate(() => globalThis.__sharegptCollabCompatibilityIpc);
}

async function loginThroughForm(window, baseUrl, username, password = PASSWORD) {
  await window.locator("#account-server").waitFor({ state: "visible" });
  await window.locator("#account-server").fill(baseUrl);
  await window.locator("#account-username").fill(username);
  await window.locator("#account-password").fill(password);
  await window.getByRole("button", { name: "登录", exact: true }).click();
  await window.getByRole("button", { name: /账户/ }).waitFor({ state: "visible" });
}

async function dismissFirstRunGuides(window) {
  const skipTour = window.getByRole("button", { name: "跳过", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const closeGuide = window.getByRole("button", { name: "关闭引导", exact: true });
  if (await closeGuide.isVisible().catch(() => false)) await closeGuide.click();
}

async function launchCase({
  baseUrl,
  events,
  username,
  password = PASSWORD,
  mode = "all",
  waitForSilentRelogin = false,
  exercise,
}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-login-compat-"));
  const args = mode === "all" ? [ROOT] : [ROOT, `--mode=${mode}`];
  const electronApp = await electron.launch({
    args,
    cwd: ROOT,
    env: { ...process.env, SHAREGPT_USER_DATA: userDataDir },
  });
  const blockedRequests = [];
  try {
    await electronApp.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const allowed =
        url.protocol === "file:" ||
        url.protocol === "data:" ||
        ((url.protocol === "http:" || url.protocol === "ws:") && url.hostname === "127.0.0.1");
      if (allowed) return route.continue();
      blockedRequests.push(url.toString());
      return route.abort("blockedbyclient");
    });

    const window = await electronApp.firstWindow();
    await window.locator("#account-server").waitFor({ state: "visible" });
    await window.locator("#account-server").fill(baseUrl);
    await window.locator("#account-username").fill(username);
    await window.locator("#account-password").fill(password);
    await window.getByRole("button", { name: "登录", exact: true }).click();

    if (password !== PASSWORD) {
      await window.getByText("密码错误", { exact: true }).waitFor({ state: "visible" });
      const principal = await window.evaluate(() => window.api.getSettingsPrincipal());
      return { authed: false, principal, blockedRequests };
    }

    await window.getByRole("button", { name: /账户/ }).waitFor({ state: "visible" });
    if (waitForSilentRelogin) {
      await waitFor(
        () =>
          events.filter((event) => event.type === "login" && event.username === username).length >=
            2 &&
          events.filter((event) => event.type === "ws" && event.username === username).length >= 2,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        events.filter((event) => event.type === "ws" && event.username === username).length,
        2,
        "silent relogin must replace the socket exactly once",
      );
    }
    if (exercise) await dismissFirstRunGuides(window);
    const exerciseResult = exercise
      ? await exercise({ electronApp, window, userDataDir })
      : undefined;
    const state = await window.evaluate(async () => {
      const principal = await window.api.getSettingsPrincipal();
      const settings = await window.api.loadSettings({
        expectedPrincipalId: principal.principalId,
        expectedPrincipalGeneration: principal.generation,
      });
      return {
        mode: await window.api.getMode(),
        principal,
        authorizedProxyRouteIds: settings.sender?.authorized_proxy_route_ids,
        managedProxyRouteIds: (settings.sender?.managed_proxy_routes || []).map(
          (route) => route.id,
        ),
      };
    });
    return { authed: true, ...state, exerciseResult, blockedRequests };
  } finally {
    await electronApp.close().catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function verifyPrincipalInvalidationRace(fixture) {
  const username = "principal-invalidation-race";
  const before = fixture.events.length;
  const result = await launchCase({
    baseUrl: fixture.baseUrl,
    events: fixture.events,
    username,
    exercise: async ({ electronApp, window }) => {
      await installPrincipalClearDelay(electronApp, 2400);
      assert.equal(
        fixture.closeUserSocket(username, "fixture principal transition race"),
        true,
        "the first collaboration socket must exist",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.locator('[data-tour="nav-account"]').click();
      await window.locator('button:has-text("退出登录")').click();
      await window.locator("#account-server").waitFor({ state: "visible", timeout: 8000 });

      await loginThroughForm(window, fixture.baseUrl, username);
      await waitFor(
        () =>
          countEvents(fixture.events, "login", username) >= 2 &&
          countEvents(fixture.events, "ws", username) >= 2,
      );
      assert.equal(
        fixture.closeUserSocket(username, "fixture second authorization revocation"),
        true,
        "the second collaboration socket must exist",
      );
      await waitFor(
        () =>
          countEvents(fixture.events, "login", username) >= 3 &&
          countEvents(fixture.events, "ws", username) >= 3,
        12000,
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(
        countEvents(fixture.events, "ws", username),
        3,
        "a snapshot failure before inFlight must not block the next silent relogin or duplicate WS",
      );
      return {
        loginCount: countEvents(fixture.events, "login", username),
        wsCount: countEvents(fixture.events, "ws", username),
      };
    },
  });
  const events = fixture.events.slice(before);
  assert.equal(result.authed, true, "principal race recovery must finish signed in");
  assert.equal(countEvents(events, "logout", username), 1, "the explicit logout must reach server");
  assert.deepEqual(result.exerciseResult, { loginCount: 3, wsCount: 3 });
  assert.deepEqual(result.blockedRequests, []);
  return events;
}

async function verifyAuthorizationPersistenceFailure(fixture) {
  const username = "authorization-persist-failure";
  const before = fixture.events.length;
  const result = await launchCase({
    baseUrl: fixture.baseUrl,
    events: fixture.events,
    username,
    exercise: async ({ electronApp, window }) => {
      await window.locator('[data-tour="nav-gpt"]').click();
      await window.getByTitle("新建 AI 环境").click();
      await window.getByText("新建第一个独立环境", { exact: true }).click();
      await window.getByRole("button", { name: "完成", exact: true }).click();
      await window.locator('select[aria-label="当前 AI 环境"]').waitFor({ state: "visible" });

      await installAuthorizationPersistenceFailure(electronApp);
      assert.equal(
        fixture.closeUserSocket(username, "fixture persistence failure revocation"),
        true,
        "the collaboration socket must exist before authorization revocation",
      );
      await waitFor(
        () =>
          countEvents(fixture.events, "login", username) >= 2 &&
          countEvents(fixture.events, "ws", username) >= 2,
        12000,
      );
      const metrics = await readAuthorizationFailureMetrics(electronApp);
      const diskAuthorization = await window.evaluate(async () => {
        const principal = await window.api.getSettingsPrincipal();
        const settings = await window.api.loadSettings({
          expectedPrincipalId: principal.principalId,
          expectedPrincipalGeneration: principal.generation,
        });
        return {
          authorizedIds: settings.sender?.authorized_proxy_route_ids,
          managedIds: (settings.sender?.managed_proxy_routes || []).map((route) => route.id),
        };
      });
      const routeUi = await window
        .locator('select[aria-label="内置网络线路"]')
        .evaluate((select) => ({
          value: select.value,
          disabled: select.disabled,
          options: [...select.options].map((option) => ({
            value: option.value,
            text: option.text,
          })),
        }));
      const pageText = (await window.locator("body").innerText())
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.includes("线路") ||
            line.includes("环境") ||
            line.includes("ChatGPT") ||
            line.includes("登录"),
        )
        .slice(0, 40);
      const diagnostics = {
        environmentRouteId: routeUi.value,
        routeUi,
        returnedAuthorizationIds:
          metrics.authorizationPatches.at(-1)?.returnedAuthorizedIds ?? null,
        diskAuthorization,
        pageText,
        metrics,
        loginCount: countEvents(fixture.events, "login", username),
        wsCount: countEvents(fixture.events, "ws", username),
      };
      const failClosedVisible = await window
        .getByText("没有可用的内置线路", { exact: true })
        .isVisible()
        .catch(() => false);
      if (!failClosedVisible) {
        throw new Error(`authorization fail-closed diagnostics: ${JSON.stringify(diagnostics)}`);
      }
      assert.equal(routeUi.disabled, true, "the route selector must be disabled after revocation");
      assert.equal(routeUi.value, "", "the revoked environment must not retain an effective route");
      assert.equal(
        routeUi.options.some((option) => option.value === "internal-airport"),
        false,
        "a retained managed route must not remain selectable after authorization is empty",
      );
      assert.deepEqual(diskAuthorization, {
        authorizedIds: [],
        managedIds: ["internal-airport"],
      });
      assert.deepEqual(metrics, {
        patchFailures: 1,
        stopCalls: 2,
        authorizationPatches: [{ failed: true }, { failed: false, returnedAuthorizedIds: [] }],
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(
        countEvents(fixture.events, "ws", username),
        2,
        "persistence failure recovery must create exactly one replacement WS",
      );
      return metrics;
    },
  });
  const events = fixture.events.slice(before);
  assert.equal(result.authed, true, "chat login must survive authorization persistence failure");
  assert.deepEqual(
    result.authorizedProxyRouteIds,
    [],
    "the retrying invalidation must persist the fail-closed authorization after the injected first failure",
  );
  assert.deepEqual(result.managedProxyRouteIds, ["internal-airport"]);
  assert.equal(
    events.some((event) => event.type === "logout"),
    false,
    "authorization persistence failure must not discard the valid chat token",
  );
  assert.deepEqual(result.exerciseResult, {
    patchFailures: 1,
    stopCalls: 2,
    authorizationPatches: [{ failed: true }, { failed: false, returnedAuthorizedIds: [] }],
  });
  assert.deepEqual(result.blockedRequests, []);
  return events;
}

async function verifySameTokenDoubleRevocation(fixture) {
  const username = "same-token-double-revocation";
  const before = fixture.events.length;
  const result = await launchCase({
    baseUrl: fixture.baseUrl,
    events: fixture.events,
    username,
    exercise: async ({ window }) => {
      assert.equal(fixture.closeUserSocket(username, "fixture first 4002"), true);
      await waitFor(
        () =>
          countEvents(fixture.events, "login", username) >= 2 &&
          countEvents(fixture.events, "ws", username) >= 2,
        12000,
      );
      const afterFirst = await window.evaluate(async () => {
        const principal = await window.api.getSettingsPrincipal();
        const settings = await window.api.loadSettings({
          expectedPrincipalId: principal.principalId,
          expectedPrincipalGeneration: principal.generation,
        });
        return settings.sender?.authorized_proxy_route_ids;
      });
      assert.deepEqual(afterFirst, ["route-after-first-relogin"]);

      assert.equal(fixture.closeUserSocket(username, "fixture second 4002"), true);
      await waitFor(
        () =>
          countEvents(fixture.events, "login", username) >= 3 &&
          countEvents(fixture.events, "ws", username) >= 3,
        12000,
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(
        countEvents(fixture.events, "ws", username),
        3,
        "two same-token 4002 cycles must produce exactly two replacement sockets",
      );
      return {
        loginCount: countEvents(fixture.events, "login", username),
        wsCount: countEvents(fixture.events, "ws", username),
        afterFirst,
      };
    },
  });
  const events = fixture.events.slice(before);
  assert.equal(result.authed, true, "same-token recovery must remain signed in");
  assert.deepEqual(result.authorizedProxyRouteIds, []);
  assert.deepEqual(result.managedProxyRouteIds, ["route-after-first-relogin"]);
  assert.equal(countEvents(events, "bootstrap", username), 3);
  assert.equal(
    events.some((event) => event.type === "logout"),
    false,
    "same-token recovery must not discard the reused valid token",
  );
  assert.deepEqual(result.exerciseResult, {
    loginCount: 3,
    wsCount: 3,
    afterFirst: ["route-after-first-relogin"],
  });
  assert.deepEqual(result.blockedRequests, []);
  return events;
}

async function main() {
  const fixture = await createFixtureServer();
  try {
    const cases = [
      { username: "legacy-admin", expectedRoutes: ["internal-unified", "internal-airport"] },
      { username: "legacy-routes", expectedRoutes: ["route-legacy"] },
      { username: "modern-routes", expectedRoutes: ["route-modern"] },
      { username: "legacy-missing-routes", expectedRoutes: [] },
      { username: "unavailable", expectedRoutes: [] },
      { username: "bootstrap-500", expectedRoutes: [] },
      { username: "server-503", expectedRoutes: [] },
      { username: "bootstrap-timeout", expectedRoutes: [] },
      { username: "receiver-stop-reject", mode: "receiver", expectedRoutes: [] },
      {
        username: "silent-relogin-legacy-admin",
        expectedRoutes: ["internal-unified", "internal-airport"],
        waitForSilentRelogin: true,
      },
      {
        username: "silent-relogin-unavailable",
        expectedRoutes: [],
        waitForSilentRelogin: true,
      },
    ];
    const results = [];
    for (const scenario of cases) {
      const before = fixture.events.length;
      const result = await launchCase({
        baseUrl: fixture.baseUrl,
        events: fixture.events,
        ...scenario,
      });
      const events = fixture.events.slice(before);
      assert.equal(result.authed, true, `${scenario.username} must remain signed in`);
      assert.notEqual(result.principal.principalId, "local-device");
      assert.deepEqual(result.authorizedProxyRouteIds, scenario.expectedRoutes);
      assert.deepEqual(
        result.managedProxyRouteIds,
        scenario.expectedRoutes.filter((routeId) => routeId !== "internal-unified"),
      );
      assert.equal(
        events.some((event) => event.type === "logout"),
        false,
        `${scenario.username} must not discard a valid collaboration token`,
      );
      if (scenario.mode) assert.equal(result.mode, scenario.mode);
      assert.deepEqual(result.blockedRequests, []);
      results.push({ scenario: scenario.username, mode: result.mode, events });
    }

    const principalInvalidationRace = await verifyPrincipalInvalidationRace(fixture);
    const authorizationPersistenceFailure = await verifyAuthorizationPersistenceFailure(fixture);
    const sameTokenDoubleRevocation = await verifySameTokenDoubleRevocation(fixture);

    const beforeInvalid = fixture.events.length;
    const invalid = await launchCase({
      baseUrl: fixture.baseUrl,
      events: fixture.events,
      username: "invalid-credentials",
      password: "wrong-password",
    });
    const invalidEvents = fixture.events.slice(beforeInvalid);
    assert.equal(invalid.authed, false);
    assert.equal(invalid.principal.principalId, "local-device");
    assert.equal(
      invalidEvents.some((event) => event.type === "bootstrap"),
      false,
    );
    assert.deepEqual(invalid.blockedRequests, []);

    const legacyLogin = await fetch(`${fixture.baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "server-503", password: PASSWORD }),
    });
    const legacyToken = (await legacyLogin.json()).token;
    const legacyCachedSettings = {
      authorizedProxyRouteIds: ["internal-unified", "internal-airport"],
      managedProxyRouteIds: ["internal-airport"],
    };
    const legacyResponse = await fetch(`${fixture.baseUrl}/api/client/bootstrap`, {
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    let legacyApplied = false;
    if (legacyResponse.ok) {
      legacyApplied = true;
      const payload = await legacyResponse.json();
      legacyCachedSettings.authorizedProxyRouteIds = (payload.proxyRoutes || []).map(
        (route) => route.id,
      );
    }
    assert.equal(legacyResponse.status, 503);
    assert.equal(legacyApplied, false);
    assert.deepEqual(legacyCachedSettings, {
      authorizedProxyRouteIds: ["internal-unified", "internal-airport"],
      managedProxyRouteIds: ["internal-airport"],
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          results,
          invalidCredentialsRejected: true,
          legacyClientPreservedCachedRoutesOn503: true,
          principalInvalidationRace,
          authorizationPersistenceFailure,
          sameTokenDoubleRevocation,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
