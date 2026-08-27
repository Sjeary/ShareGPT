const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { _electron: electron } = require("playwright");
const { principalIdFor: principalId } = require("../src/main/principal");

// Full desktop smoke test for the advanced AI review fixes. It uses a temporary
// user-data directory and loopback-only services, so real account cookies and routes stay untouched.
const ROOT = path.resolve(__dirname, "..");
const USERNAME = "ai-review-verifier";
const SECOND_ADVANCED_USERNAME = "ai-review-verifier-b";
const BASIC_USERNAME = "ai-review-basic";
const PASSWORD = "correct-password";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function passwordRecord(username, advanced) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 120000;
  return {
    username,
    displayName: advanced ? "AI Review Verifier" : "Basic Verifier",
    salt,
    passwordHash: crypto.pbkdf2Sync(PASSWORD, salt, iterations, 32, "sha256").toString("hex"),
    iterations,
    digest: "sha256",
    disabled: false,
    isAdmin: false,
    advancedAiAllowed: advanced,
    allowedProxyRouteIds: advanced ? ["route-a", "route-b"] : [],
  };
}

async function waitForHealth(baseUrl, child, output, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`collaboration server exited\n${output.join("")}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Server may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`collaboration server did not become healthy\n${output.join("")}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function startLoopbackSocks() {
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage = "greeting";
    let upstream = null;
    client.on("data", (chunk) => {
      if (stage === "relay") {
        upstream?.write(chunk);
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting") {
        if (buffer.length < 2) return;
        const length = 2 + buffer[1];
        if (buffer.length < length) return;
        buffer = buffer.subarray(length);
        client.write(Buffer.from([5, 0]));
        stage = "request";
      }
      if (stage !== "request" || buffer.length < 4) return;
      const atyp = buffer[3];
      let host = "";
      let offset = 4;
      if (atyp === 1) {
        if (buffer.length < 10) return;
        host = [...buffer.subarray(offset, offset + 4)].join(".");
        offset += 4;
      } else if (atyp === 3) {
        const size = buffer[offset];
        if (buffer.length < offset + 1 + size + 2) return;
        host = buffer.subarray(offset + 1, offset + 1 + size).toString("utf8");
        offset += 1 + size;
      } else if (atyp === 4) {
        if (buffer.length < 22) return;
        host = "::1";
        offset += 16;
      } else {
        client.destroy();
        return;
      }
      const port = buffer.readUInt16BE(offset);
      const remaining = buffer.subarray(offset + 2);
      buffer = Buffer.alloc(0);
      upstream = net.connect({ host, port }, () => {
        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (remaining.length) upstream.write(remaining);
        stage = "relay";
      });
      upstream.on("data", (data) => client.write(data));
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.end());
    });
    client.on("error", () => undefined);
    client.on("close", () => upstream?.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function startFixtureServer(state) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url.startsWith("/page")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html>
          <title>Local verification page</title>
          <h1>Local verification page</h1>
          <p id="selection-source" style="display:inline-block;font-size:18px">Automatic selection translation sample</p>
          <form id="composer-form">
            <textarea id="prompt-textarea" aria-label="Prompt"></textarea>
            <button type="button" data-testid="send-button" aria-label="Send">Send</button>
          </form>
          <script>
            window.composerEvents = { enters: 0, clicks: 0 };
            document.querySelector('#prompt-textarea').addEventListener('keydown', (event) => {
              if (event.key === 'Enter' && event.isTrusted) window.composerEvents.enters += 1;
            });
            document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
              window.composerEvents.clicks += 1;
            });
          </script>`,
      );
      return;
    }
    if (request.method === "POST" && ["/translate", "/slow/translate"].includes(request.url)) {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const send = () => {
          if (response.destroyed) return;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              translatedText:
                payload.target === "en" ? "[EN] translated output" : `[ZH] ${payload.q || ""}`,
            }),
          );
        };
        if (request.url === "/slow/translate") {
          state.slowStarted += 1;
          response.on("close", () => {
            if (!response.writableEnded) state.slowAborted += 1;
          });
          setTimeout(send, 4000);
        } else {
          send();
        }
      });
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function login(window, baseUrl, username) {
  await window.locator("#account-server").waitFor({ state: "visible" });
  await window.locator("#account-server").fill(baseUrl);
  await window.locator("#account-username").fill(username);
  await window.locator("#account-password").fill(PASSWORD);
  await window.getByRole("button", { name: "登录", exact: true }).click();
  await window.locator('[data-tour="nav-account"]').waitFor({ state: "visible" });
  const skip = window.getByRole("button", { name: "跳过", exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function patchSection(window, section, patch) {
  return window.evaluate(
    async ({ sectionName, sectionPatch }) => {
      const { principalId } = await window.api.getSettingsPrincipal();
      return window.api.patchSettings({
        section: sectionName,
        patch: sectionPatch,
        expectedPrincipalId: principalId,
      });
    },
    { sectionName: section, sectionPatch: patch },
  );
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition timed out");
}

async function zoomSnapshot(electronApp) {
  return electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    return {
      shell: main?.webContents.getZoomLevel(),
      contents: webContents
        .getAllWebContents()
        .filter((item) => !item.isDestroyed() && item.getType() !== "backgroundPage")
        .map((item) => ({ type: item.getType(), url: item.getURL(), zoom: item.getZoomLevel() })),
    };
  });
}

async function sendZoomShortcut(electronApp, keyCode) {
  await electronApp.evaluate(({ BrowserWindow }, key) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: ["meta"] });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers: ["meta"] });
  }, keyCode);
}

async function partitionStorage(electronApp, partition, fixtureUrl, writeValue) {
  return electronApp.evaluate(
    async ({ BrowserWindow }, args) => {
      const probe = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: args.partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await probe.loadURL(`${args.fixtureUrl}/page`);
        return await probe.webContents.executeJavaScript(
          args.writeValue
            ? `localStorage.setItem("principal-marker", ${JSON.stringify(args.writeValue)}); document.cookie = "principal-marker=${encodeURIComponent(args.writeValue)}; SameSite=Lax"; ({ local: localStorage.getItem("principal-marker"), cookie: document.cookie })`
            : `({ local: localStorage.getItem("principal-marker"), cookie: document.cookie })`,
          true,
        );
      } finally {
        probe.destroy();
      }
    },
    { partition, fixtureUrl, writeValue },
  );
}

async function composerFixtureAction(electronApp, fixtureUrl, action, value = "") {
  return electronApp.evaluate(
    async ({ webContents }, args) => {
      const expectedPartition =
        /^persist:sharegpt-(?:ai-)?[a-f0-9]{64}-claude(?:-env-claude-one)?$/;
      const isExpectedWorkspace = (contents) => {
        if (contents.isDestroyed()) return false;
        const identity = contents.__shareGptAiWorkspace;
        const url = String(contents.getURL());
        return (
          identity?.kind === "claude" &&
          (identity?.environmentId === "" || identity?.environmentId === "env-claude-one") &&
          expectedPartition.test(identity?.partition || "") &&
          identity?.isCurrent?.() === true &&
          !url.startsWith("data:") &&
          !url.startsWith("file:") &&
          !url.startsWith("devtools:")
        );
      };
      let target = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            isExpectedWorkspace(contents) &&
            String(contents.getURL()).startsWith(`${args.fixtureUrl}/page`),
        );
      if (!target && args.action === "prepare") {
        const candidates = webContents.getAllWebContents().filter(isExpectedWorkspace);
        target =
          candidates.find((contents) => contents.isFocused()) ||
          candidates.find((contents) => !contents.getURL());
        if (target) await target.loadURL(`${args.fixtureUrl}/page`);
      }
      if (!target) {
        const urls = webContents
          .getAllWebContents()
          .filter((contents) => !contents.isDestroyed())
          .map((contents) => {
            const identity = contents.__shareGptAiWorkspace;
            return `${contents.getType()}:${identity?.partition || "unowned"}:${identity?.isCurrent?.() === true}:${contents.getURL()}`;
          });
        throw new Error(`composer fixture webContents not found: ${urls.join(", ")}`);
      }
      if (args.action === "prepare") return target.getURL();
      if (args.action === "forge") {
        return target.executeJavaScript(
          `console.log('__SHAREGPT_COMPOSER_GUARD__' + JSON.stringify({ text: 'forged-old' }));
           console.log('__SHAREGPT_COMPOSER_GUARD_V2__:' + 'A'.repeat(43) + ':' + JSON.stringify({ text: 'forged-new' }));`,
          true,
        );
      }
      if (args.action === "reset-state") {
        return target.executeJavaScript(`window.composerEvents = { enters: 0, clicks: 0 }`, true);
      }
      if (args.action === "click" || args.action === "click-synthetic") {
        const bounds = await target.executeJavaScript(
          `(() => {
            const editor = document.querySelector('#prompt-textarea');
            editor.focus();
            editor.value = ${JSON.stringify(args.value)};
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            const button = document.querySelector('[data-testid="send-button"]');
            const rect = button.getBoundingClientRect();
            return { x: Math.floor(rect.left + rect.width / 2), y: Math.floor(rect.top + rect.height / 2) };
          })()`,
          true,
        );
        if (args.action === "click-synthetic") {
          return target.executeJavaScript(
            `document.querySelector('[data-testid="send-button"]').click(); window.composerEvents`,
            true,
          );
        }
        target.focus();
        target.sendInputEvent({
          type: "mouseDown",
          x: bounds.x,
          y: bounds.y,
          button: "left",
          clickCount: 1,
        });
        target.sendInputEvent({
          type: "mouseUp",
          x: bounds.x,
          y: bounds.y,
          button: "left",
          clickCount: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        return target.executeJavaScript(`window.composerEvents`, true);
      }
      if (args.action === "focus") {
        target.focus();
        return target.executeJavaScript(
          `(() => {
            const editor = document.querySelector('#prompt-textarea');
            editor.focus();
            return document.activeElement === editor;
          })()`,
          true,
        );
      }
      if (args.action === "navigate") {
        return target.executeJavaScript(`location.href = '/page?navigated=1'`, true);
      }
      if (args.action === "guard-state") {
        return target.executeJavaScriptInIsolatedWorld(
          1001,
          [
            {
              code: `(() => {
                const documentState = globalThis.__shareGptComposerDocument;
                const guard = globalThis.__shareGptComposerGuard;
                const selection = globalThis.__shareGptSelectionTranslation;
                return {
                  ready: Boolean(
                    documentState?.nonce &&
                    documentState?.url === String(globalThis.location?.href || '') &&
                    guard?.enabled &&
                    guard?.marker?.startsWith('__SHAREGPT_COMPOSER_GUARD_V2__:')
                  ),
                  documentNonce: Boolean(documentState?.nonce),
                  documentUrl: String(documentState?.url || ''),
                  currentUrl: String(globalThis.location?.href || ''),
                  listenersInstalled: Boolean(documentState?.listenersInstalled),
                  guardInstalled: Boolean(guard?.installed),
                  guardEnabled: Boolean(guard?.enabled),
                  markerPresent: Boolean(guard?.marker),
                  selectionEnabled: Boolean(selection?.enabled),
                };
              })()`,
            },
          ],
          false,
        );
      }
      if (args.action === "probe-enter-gate-security") {
        const runIsolated = (code) =>
          target.executeJavaScriptInIsolatedWorld(1001, [{ code }], false);
        return runIsolated(`(() => {
          const state = globalThis.__shareGptComposerDocument;
          const editor = document.querySelector('#prompt-textarea');
          const token = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
          editor.value = 'enter gate probe';
          editor.focus();
          const ok = state?.armEnterGate?.({
            token,
            nonce: state.nonce,
            url: state.url,
            editor,
            expectedText: 'enter gate probe',
            ttlMs: 1000,
          });
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          }));
          const outcome = { ...state?.enterGateOutcome };
          state?.invalidateEnterGate?.('test-cleanup');
          return { ok, outcome };
        })()`);
      }
      if (args.action === "select-text-synthetic") {
        return target.executeJavaScript(`(() => {
          const source = document.querySelector('#selection-source');
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          source.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            button: 0,
            isPrimary: true,
          }));
          return selection.toString();
        })()`);
      }
      if (args.action === "select-text-trusted") {
        const bounds = await target.executeJavaScript(`(() => {
          getSelection()?.removeAllRanges();
          const rect = document.querySelector('#selection-source').getBoundingClientRect();
          return {
            startX: Math.floor(rect.left + 2),
            endX: Math.floor(rect.right - 2),
            y: Math.floor(rect.top + rect.height / 2),
          };
        })()`);
        target.focus();
        target.sendInputEvent({
          type: "mouseDown",
          x: bounds.startX,
          y: bounds.y,
          button: "left",
          clickCount: 1,
        });
        target.sendInputEvent({
          type: "mouseMove",
          x: bounds.endX,
          y: bounds.y,
          button: "left",
        });
        target.sendInputEvent({
          type: "mouseUp",
          x: bounds.endX,
          y: bounds.y,
          button: "left",
          clickCount: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        return target.executeJavaScript(`getSelection()?.toString() || ''`, true);
      }
      return target.executeJavaScript(`window.composerEvents`, true);
    },
    { fixtureUrl, action, value },
  );
}

async function main() {
  const keepOpen = process.env.SHAREGPT_KEEP_TEST_APP === "1";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-ai-review-ui-"));
  const userDataDir = path.join(tempDir, "user-data");
  const fixtureState = { slowStarted: 0, slowAborted: 0 };
  const [socksServer, fixtureServer] = await Promise.all([
    startLoopbackSocks(),
    startFixtureServer(fixtureState),
  ]);
  const socksPort = socksServer.address().port;
  const fixturePort = fixtureServer.address().port;
  const collabPort = await reservePort();
  const senderPort = await reservePort();
  const baseUrl = `http://127.0.0.1:${collabPort}`;
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`;

  const usersFile = path.join(tempDir, "users.json");
  fs.writeFileSync(
    usersFile,
    JSON.stringify(
      {
        users: [
          passwordRecord(USERNAME, true),
          passwordRecord(SECOND_ADVANCED_USERNAME, true),
          passwordRecord(BASIC_USERNAME, false),
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(tempDir, "proxy_routes.json"),
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        routes: ["a", "b"].map((suffix) => ({
          id: `route-${suffix}`,
          name: suffix === "a" ? "Review route A" : "Review route B",
          enabled: true,
          outbound: { type: "socks", server: "127.0.0.1", server_port: socksPort },
          expected: {},
        })),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(tempDir, "client_bootstrap.json"),
    JSON.stringify({
      sender: {
        proxy_server: "127.0.0.1",
        proxy_port: String(socksPort),
        proxy_uuid: "11111111-1111-4111-8111-111111111111",
        fallback_mode: "direct",
      },
    }),
  );

  const serverOutput = [];
  const collab = spawn(process.execPath, [path.join(ROOT, "collab_server2/server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(collabPort),
      USERS_FILE: usersFile,
      GPT_USAGE_FILE: path.join(tempDir, "gpt_usage.json"),
      CHAT_HISTORY_FILE: path.join(tempDir, "chat_history.json"),
      CLIENT_BOOTSTRAP_FILE: path.join(tempDir, "client_bootstrap.json"),
      CALENDARS_FILE: path.join(tempDir, "calendars.json"),
      USER_STORES_FILE: path.join(tempDir, "user_stores.json"),
      FOCUS_FILE: path.join(tempDir, "focus_stats.json"),
      RELEASES_DIR: path.join(tempDir, "releases"),
      PROXY_ROUTES_FILE: path.join(tempDir, "proxy_routes.json"),
      PROXY_ROUTE_HEALTH_FILE: path.join(tempDir, "proxy_route_health.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  collab.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  collab.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  let electronApp;
  const results = [];
  try {
    await waitForHealth(baseUrl, collab, serverOutput);
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: {
        ...process.env,
        SHAREGPT_USER_DATA: userDataDir,
        SHAREGPT_COMPOSER_CONFIRM_TTL_MS: "1500",
      },
    });
    const blockedRequests = [];
    await electronApp.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
      if (["file:", "data:", "devtools:"].includes(url.protocol) || loopback) {
        await route.continue();
      } else {
        blockedRequests.push(url.toString());
        await route.abort("blockedbyclient");
      }
    });

    const window = await electronApp.firstWindow();
    const pageErrors = [];
    window.on("pageerror", (error) => pageErrors.push(error.message));
    await window.locator("#account-server").waitFor({ state: "visible" });
    const loginBox = await window.getByRole("button", { name: "登录", exact: true }).boundingBox();
    assert.ok(
      loginBox && loginBox.y + loginBox.height <= (await window.evaluate(() => innerHeight)),
    );
    results.push("login action is visible without scrolling");

    await login(window, baseUrl, USERNAME);
    const now = new Date().toISOString();
    await patchSection(window, "advancedAi", {
      version: 1,
      enabled: true,
      environments: [
        { id: "env-gpt-one", kind: "gpt", name: "GPT one", routeId: "route-a", createdAt: now },
        { id: "env-gpt-two", kind: "gpt", name: "GPT two", routeId: "route-a", createdAt: now },
        { id: "env-gpt-three", kind: "gpt", name: "GPT three", routeId: "route-a", createdAt: now },
        {
          id: "env-claude-one",
          kind: "claude",
          name: "Claude one",
          routeId: "route-b",
          createdAt: now,
        },
      ],
      activeByKind: { gpt: "env-gpt-one", gemini: "", claude: "env-claude-one" },
    });
    await patchSection(window, "translation", {
      provider: "ai",
      ai: {
        baseUrl: "http://notes-a.example/v1",
        apiKey: "alice-notes-key",
        model: "gpt-5.5",
        effort: "medium",
      },
    });
    await window.reload();
    await login(window, baseUrl, USERNAME);
    const advancedLoginState = await window.evaluate(async () => window.api.loadSettings());
    assert.strictEqual(advancedLoginState.advancedAi.enabled, true);
    assert.strictEqual(advancedLoginState.translation.ai.apiKey, "alice-notes-key");
    assert.deepStrictEqual(
      advancedLoginState.sender.authorized_proxy_route_ids,
      ["route-a", "route-b"],
      `authoritative route sync failed; server=${serverOutput.join("")}`,
    );
    assert.deepStrictEqual(
      advancedLoginState.sender.managed_proxy_routes.map((route) => route.id),
      ["route-a", "route-b"],
    );
    await window.locator('[data-tour="nav-notes"]').click();
    await window.getByTitle("今日笔记").click();
    await window.getByRole("button", { name: "AI", exact: true }).click();
    await window.getByTitle("AI 设置").click();
    const notesEndpointInput = window.getByLabel("接口地址");
    const notesApiKeyInput = window.getByLabel("API Key");
    await notesEndpointInput.waitFor();
    assert.strictEqual(await notesApiKeyInput.inputValue(), "alice-notes-key");
    await window.getByRole("status").filter({ hasText: "明文" }).waitFor();
    await notesEndpointInput.fill("https://notes.example/v1");
    assert.strictEqual(await window.getByRole("status").filter({ hasText: "明文" }).count(), 0);
    await notesEndpointInput.fill("http://127.0.0.1:8080/v1");
    assert.strictEqual(await window.getByRole("status").filter({ hasText: "明文" }).count(), 0);
    await notesEndpointInput.fill("http://notes.example/v1");
    await window.getByRole("status").filter({ hasText: "明文" }).waitFor();
    results.push("Notes AI HTTP warning is visible while HTTPS and loopback stay unflagged");

    await window.locator('[data-tour="nav-gpt"]').click();
    await window.getByRole("button", { name: "管理环境与线路" }).click();
    await window.getByText("ChatGPT 环境", { exact: true }).waitFor();
    assert.strictEqual(await window.getByLabel("环境名称").count(), 3);
    assert.strictEqual(await window.getByLabel("内置网络线路").count(), 3);
    assert.deepStrictEqual(
      await window.getByLabel("当前 AI 环境").locator("option").allTextContents(),
      ["GPT one", "GPT two", "GPT three"],
    );
    await window.getByLabel("环境名称").first().fill("GPT primary");
    await window.getByLabel("环境名称").first().press("Enter");
    await window.getByLabel("内置网络线路").first().selectOption("route-b");
    await window.getByRole("button", { name: "新建", exact: true }).click();
    await window.getByPlaceholder("ChatGPT 新环境名称").fill("GPT disposable");
    await window.getByLabel("新环境内置网络线路").selectOption("route-a");
    await window.getByRole("button", { name: "完成", exact: true }).click();
    await window.getByLabel("环境名称").nth(3).waitFor();
    window.once("dialog", (dialog) => dialog.accept());
    await window.getByTitle("删除环境").last().click();
    await waitUntil(async () => (await window.getByLabel("环境名称").count()) === 3);
    const advanced = await window.evaluate(
      async () => (await window.api.loadSettings()).advancedAi,
    );
    assert.strictEqual(
      advanced.environments.find((item) => item.id === "env-gpt-one").name,
      "GPT primary",
    );
    assert.strictEqual(
      advanced.environments.find((item) => item.id === "env-gpt-one").routeId,
      "route-b",
    );
    assert.strictEqual(advanced.environments.filter((item) => item.kind === "gpt").length, 3);
    results.push("advanced environment create/edit/route/delete persists correctly");

    await patchSection(window, "advancedAi", { ...advanced, enabled: false });
    await patchSection(window, "translation", {
      provider: "offline",
      sourceLanguage: "en",
      targetLanguage: "zh",
      offline: { baseUrl: fixtureUrl },
    });
    await window.reload();
    await login(window, baseUrl, USERNAME);
    await window.evaluate(
      ({ listenPort }) =>
        window.api.startSender({
          socks_listen_port: String(listenPort),
          fallback_mode: "direct",
          proxy_mode: "unified",
          target_domains: "chatgpt.com\nopenai.com\nclaude.ai\nanthropic.com",
        }),
      { listenPort: senderPort, upstreamPort: socksPort },
    );

    await window.locator('[data-tour="nav-chat"]').click();
    const collapseSidebarButton = window.getByRole("button", { name: "收起侧栏" });
    if (await collapseSidebarButton.isVisible()) await collapseSidebarButton.click();
    await window.getByRole("button", { name: "展开侧栏" }).waitFor();

    const gptNav = window.locator('[data-tour="nav-gpt"]');
    await gptNav.hover();
    const shellTooltip = window.locator('[data-slot="tooltip-content"]');
    await shellTooltip.waitFor();
    const shellTooltipAppearance = await shellTooltip.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        foreground: style.color,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        boxShadow: style.boxShadow,
        height: style.height,
      };
    });

    await gptNav.click();
    await window.getByRole("tab").first().waitFor({ state: "visible", timeout: 10_000 });
    await window.locator('[data-tour="nav-chat"]').hover();
    await waitUntil(() =>
      electronApp.evaluate(async ({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        const tooltip = main?.contentView.children.find((view) =>
          view.webContents?.getURL().includes("window.setTooltip"),
        );
        if (!tooltip?.getVisible()) return false;
        return (
          (await tooltip.webContents.executeJavaScript(
            'document.getElementById("tip-label")?.textContent',
          )) === "协作聊天"
        );
      }),
    );
    const nativeTooltipAppearance = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = main?.contentView.children.find((view) =>
        view.webContents?.getURL().includes("window.setTooltip"),
      );
      return tooltip
        ? await tooltip.webContents.executeJavaScript(`(() => {
            const style = getComputedStyle(document.getElementById("tip"));
            return {
              background: style.backgroundColor,
              foreground: style.color,
              borderRadius: style.borderRadius,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              boxShadow: style.boxShadow,
              height: style.height,
            };
          })()`)
        : null;
    });
    assert.deepStrictEqual(nativeTooltipAppearance, shellTooltipAppearance);
    const nativeTooltipArrow = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = main?.contentView.children.find((view) =>
        view.webContents?.getURL().includes("window.setTooltip"),
      );
      return tooltip
        ? await tooltip.webContents.executeJavaScript(`(() => {
            const tip = document.getElementById("tip");
            const arrow = getComputedStyle(tip, "::before");
            return {
              overflow: getComputedStyle(tip).overflow,
              background: arrow.backgroundColor,
              width: arrow.width,
              height: arrow.height,
            };
          })()`)
        : null;
    });
    assert.deepStrictEqual(nativeTooltipArrow, {
      overflow: "visible",
      background: nativeTooltipAppearance.background,
      width: "10px",
      height: "10px",
    });

    await window.evaluate(() =>
      window.api.setNavTooltip({
        visible: true,
        label: "Tooltip bounds verification",
        side: "right",
        palette: { background: "#f0f4f7", foreground: "#0e1621" },
        bounds: { x: -500, y: -500, width: 5000, height: 5000 },
      }),
    );
    const tooltipBoundsSnapshot = await electronApp.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = main?.contentView.children.find((view) =>
        view.webContents?.getURL().includes("window.setTooltip"),
      );
      return {
        bounds: tooltip?.getBounds(),
        contentBounds: main?.getContentBounds(),
        visible: tooltip?.getVisible(),
      };
    });
    assert.strictEqual(tooltipBoundsSnapshot.visible, true);
    assert.ok(tooltipBoundsSnapshot.bounds && tooltipBoundsSnapshot.contentBounds);
    assert.ok(tooltipBoundsSnapshot.bounds.x >= 0 && tooltipBoundsSnapshot.bounds.y >= 0);
    assert.ok(
      tooltipBoundsSnapshot.bounds.width <= 320 && tooltipBoundsSnapshot.bounds.height <= 96,
    );
    assert.ok(
      tooltipBoundsSnapshot.bounds.x + tooltipBoundsSnapshot.bounds.width <=
        tooltipBoundsSnapshot.contentBounds.width,
    );
    assert.ok(
      tooltipBoundsSnapshot.bounds.y + tooltipBoundsSnapshot.bounds.height <=
        tooltipBoundsSnapshot.contentBounds.height,
    );
    const tooltipOriginalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const [width, height] = main.getSize();
      main.setSize(width > 900 ? width - 24 : width + 24, height);
      return { width, height };
    });
    await waitUntil(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        const tooltip = main?.contentView.children.find((view) =>
          view.webContents?.getURL().includes("window.setTooltip"),
        );
        return tooltip?.getVisible() === false;
      }),
    );
    const tooltipHidden = await electronApp.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = main?.contentView.children.find((view) =>
        view.webContents?.getURL().includes("window.setTooltip"),
      );
      return tooltip ? { bounds: tooltip.getBounds(), visible: tooltip.getVisible() } : null;
    });
    assert.deepStrictEqual(tooltipHidden, {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      visible: false,
    });
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      main.setSize(size.width, size.height);
    }, tooltipOriginalSize);
    results.push("real hover path keeps native AI navigation tooltip equal to the shell tooltip");

    const firstTab = window.getByRole("tab").first();
    assert.strictEqual(await firstTab.getAttribute("aria-selected"), "true");
    await window.getByLabel("新建标签页").click();
    await window.getByRole("tab").nth(1).waitFor();
    await firstTab.focus();
    await firstTab.press("ArrowRight");
    assert.strictEqual(await window.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
    await window.getByRole("tab").nth(1).press("Home");
    assert.strictEqual(await firstTab.getAttribute("aria-selected"), "true");
    results.push("tab ARIA and keyboard navigation work");

    await window.getByLabel("打开翻译侧栏").click();
    const translationPanel = window.getByRole("complementary", { name: "翻译侧栏" });
    await translationPanel.waitFor();
    assert.match(await translationPanel.textContent(), /本机.*127\.0\.0\.1/);
    await window.getByLabel("待翻译内容").fill("hello isolation");
    await window.getByRole("button", { name: "翻译", exact: true }).click();
    await window.getByText("[ZH] hello isolation", { exact: true }).waitFor();
    results.push("offline translation stays in the isolated ShareGPT sidebar");

    await translationPanel.getByRole("button", { name: "中文提问", exact: true }).click();
    await translationPanel.getByLabel("中文提问内容").fill("只属于第一个标签页");
    await window.getByRole("tab").nth(1).click();
    await translationPanel.getByRole("button", { name: "中文提问", exact: true }).click();
    assert.strictEqual(await translationPanel.getByLabel("中文提问内容").inputValue(), "");
    await firstTab.click();
    await translationPanel.getByRole("button", { name: "阅读翻译", exact: true }).click();
    results.push("outgoing translation drafts cannot cross AI tabs");

    await translationPanel.getByLabel("翻译设置").click();
    await translationPanel.getByLabel("本地翻译服务地址").fill(`${fixtureUrl}/slow`);
    await translationPanel.getByRole("button", { name: "保存设置", exact: true }).click();
    await translationPanel.getByLabel("本地翻译服务地址").waitFor({ state: "hidden" });
    await window.getByLabel("待翻译内容").fill("cancel me");
    await window.getByRole("button", { name: "翻译", exact: true }).click();
    await waitUntil(() => fixtureState.slowStarted > 0);
    await window.getByLabel("新建标签页").click();
    await waitUntil(() => fixtureState.slowAborted > 0);
    assert.strictEqual(await window.getByText("[ZH] cancel me", { exact: true }).count(), 0);
    results.push("tab switch aborts translation and blocks stale results");

    const initialZoom = await zoomSnapshot(electronApp);
    await sendZoomShortcut(electronApp, "-");
    await window.waitForTimeout(350);
    const zoomedOut = await zoomSnapshot(electronApp);
    assert.ok(
      zoomedOut.shell < initialZoom.shell,
      `zoom shortcut did not reduce shell zoom: ${JSON.stringify({ initialZoom, zoomedOut })}`,
    );
    assert.ok(
      zoomedOut.contents.every(
        (item) => item.type !== "browserView" || item.zoom === zoomedOut.shell,
      ),
    );
    await sendZoomShortcut(electronApp, "=");
    await sendZoomShortcut(electronApp, "0");
    await window.waitForTimeout(350);
    const resetZoom = await zoomSnapshot(electronApp);
    assert.strictEqual(resetZoom.shell, 0);
    results.push("Cmd +/-/0 keeps shell and embedded views on one zoom level");

    for (const [width, height] of [
      [860, 620],
      [1024, 640],
      [1440, 900],
    ]) {
      await electronApp.evaluate(
        ({ BrowserWindow }, size) => {
          const mainWindow = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.isDestroyed(),
          );
          mainWindow.setSize(size.width, size.height);
          mainWindow.center();
        },
        { width, height },
      );
      await window.waitForTimeout(300);
      const layout = await window.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      assert.ok(
        layout.scrollWidth <= layout.width + 1,
        `${width}x${height} has horizontal overflow`,
      );
      await window.screenshot({ path: path.join(tempDir, `layout-${width}x${height}.png`) });
    }
    results.push("responsive window matrix has no outer horizontal overflow");

    await window.getByLabel("隐藏侧栏").click();
    await window.getByLabel("隐藏顶部信息栏").click();
    assert.strictEqual(await window.getByLabel("显示侧栏").count(), 1);
    assert.strictEqual(await window.getByLabel("显示顶部信息栏").count(), 1);
    await window.keyboard.press("Escape");
    await window.getByLabel("隐藏侧栏").waitFor();
    await window.getByLabel("隐藏顶部信息栏").waitFor();
    results.push("sidebar/header hide controls and Escape restoration work");

    await window.locator('[data-tour="nav-claude"]').click();
    await window.getByLabel("打开网页").waitFor();
    assert.strictEqual(await window.getByTestId("claude-address-input").count(), 0);
    await window.getByLabel("打开网页").click();
    await window.getByTestId("claude-address-input").fill(`${fixtureUrl}/page`);
    await window.getByLabel("在新标签页打开").click();
    await window.waitForTimeout(600);
    assert.strictEqual(await window.getByTestId("claude-address-input").count(), 0);
    results.push("Claude address field is opt-in and opens a separate internal tab");

    await composerFixtureAction(electronApp, fixtureUrl, "prepare");
    await waitUntil(
      () =>
        composerFixtureAction(electronApp, fixtureUrl, "state")
          .then(() => true)
          .catch(() => false),
      10_000,
    );

    const outgoingSlowStarted = fixtureState.slowStarted;
    const outgoingSlowAborted = fixtureState.slowAborted;
    await window.getByLabel("打开翻译侧栏").click();
    const claudeTranslationPanel = window.getByRole("complementary", { name: "翻译侧栏" });
    await claudeTranslationPanel.getByRole("button", { name: "中文提问", exact: true }).click();
    await claudeTranslationPanel.getByLabel("中文提问内容").fill("导航后不能发送");
    await claudeTranslationPanel.getByRole("button", { name: "翻译并发送" }).click();
    await waitUntil(() => fixtureState.slowStarted > outgoingSlowStarted);
    await composerFixtureAction(electronApp, fixtureUrl, "navigate");
    await waitUntil(() => fixtureState.slowAborted > outgoingSlowAborted);
    await window.waitForTimeout(250);
    assert.deepStrictEqual(await composerFixtureAction(electronApp, fixtureUrl, "state"), {
      enters: 0,
      clicks: 0,
    });
    assert.strictEqual(await window.getByText("已翻译并发送", { exact: true }).count(), 0);
    await claudeTranslationPanel.getByLabel("关闭翻译侧栏").click();
    results.push("main-frame navigation aborts deferred outgoing translation before write or send");

    let guardState = null;
    try {
      await waitUntil(async () => {
        guardState = await composerFixtureAction(electronApp, fixtureUrl, "guard-state");
        return guardState?.ready === true;
      });
    } catch (error) {
      throw new Error(
        `composer guard did not recover after navigation: ${JSON.stringify(guardState)}`,
        {
          cause: error,
        },
      );
    }

    assert.strictEqual(guardState?.selectionEnabled, false);
    await composerFixtureAction(electronApp, fixtureUrl, "select-text-synthetic");
    await window.waitForTimeout(650);
    assert.strictEqual(await window.getByRole("complementary", { name: "翻译侧栏" }).count(), 0);

    await window.getByLabel("打开翻译侧栏").click();
    await claudeTranslationPanel.getByLabel("翻译设置").click();
    await claudeTranslationPanel.getByLabel("本地翻译服务地址").fill(fixtureUrl);
    await claudeTranslationPanel.getByLabel("选中网页文字后自动翻译").click();
    await claudeTranslationPanel.getByRole("button", { name: "保存设置", exact: true }).click();
    await claudeTranslationPanel.getByLabel("本地翻译服务地址").waitFor({ state: "hidden" });
    await claudeTranslationPanel.getByLabel("关闭翻译侧栏").click();
    await waitUntil(async () => {
      guardState = await composerFixtureAction(electronApp, fixtureUrl, "guard-state");
      return guardState?.ready === true && guardState?.selectionEnabled === false;
    });

    await composerFixtureAction(electronApp, fixtureUrl, "select-text-synthetic");
    await window.waitForTimeout(650);
    assert.strictEqual(await window.getByRole("complementary", { name: "翻译侧栏" }).count(), 0);
    const trustedSelection = String(
      await composerFixtureAction(electronApp, fixtureUrl, "select-text-trusted"),
    ).trim();
    assert.match(trustedSelection, /selection translation/);
    await window.waitForTimeout(650);
    assert.strictEqual(await window.getByRole("complementary", { name: "翻译侧栏" }).count(), 0);
    results.push("automatic selection translation stays disabled on external AI pages");

    const enterGateSecurity = await composerFixtureAction(
      electronApp,
      fixtureUrl,
      "probe-enter-gate-security",
    );
    assert.strictEqual(enterGateSecurity.ok, true);
    assert.strictEqual(enterGateSecurity.outcome?.status, "pending");
    assert.strictEqual((await composerFixtureAction(electronApp, fixtureUrl, "state")).enters, 0);
    results.push("page-generated Enter cannot consume the native Enter gate");

    await composerFixtureAction(electronApp, fixtureUrl, "forge");
    await composerFixtureAction(
      electronApp,
      fixtureUrl,
      "click-synthetic",
      "页面脚本不能借用发送确认",
    );
    await window.waitForTimeout(250);
    assert.strictEqual(await window.getByRole("button", { name: "仍然发送" }).count(), 0);
    await composerFixtureAction(electronApp, fixtureUrl, "reset-state");
    assert.deepStrictEqual(await composerFixtureAction(electronApp, fixtureUrl, "state"), {
      enters: 0,
      clicks: 0,
    });
    results.push(
      "forged markers and page-generated clicks cannot borrow authenticated confirmation",
    );

    await composerFixtureAction(electronApp, fixtureUrl, "click", "第一条真实确认");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();
    await window.getByRole("button", { name: "仍然发送" }).click();
    await waitUntil(async () => {
      const state = await composerFixtureAction(electronApp, fixtureUrl, "state");
      return state.enters === 1;
    });
    assert.strictEqual((await composerFixtureAction(electronApp, fixtureUrl, "state")).clicks, 0);
    results.push("authenticated composer confirmation replays exactly one Enter");

    await composerFixtureAction(electronApp, fixtureUrl, "click", "等待确认过期");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();
    await window.getByRole("button", { name: "仍然发送" }).waitFor({
      state: "hidden",
      timeout: 5000,
    });
    assert.strictEqual((await composerFixtureAction(electronApp, fixtureUrl, "state")).enters, 1);
    results.push("expired composer confirmation is invalidated without sending");

    await composerFixtureAction(electronApp, fixtureUrl, "click", "导航前待确认");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();
    await composerFixtureAction(electronApp, fixtureUrl, "navigate");
    await window.getByRole("button", { name: "仍然发送" }).waitFor({ state: "hidden" });
    results.push("main-frame navigation invalidates composer confirmation");

    await window.waitForTimeout(500);
    await composerFixtureAction(electronApp, fixtureUrl, "click", "关闭前待确认");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();
    await window.getByLabel("关闭 Local verification page").click();
    await window.getByRole("button", { name: "仍然发送" }).waitFor({ state: "hidden" });
    results.push("workspace close invalidates composer confirmation");

    await window.getByLabel("打开网页").click();
    await window.getByTestId("claude-address-input").fill(`${fixtureUrl}/page`);
    await window.getByLabel("在新标签页打开").click();
    await composerFixtureAction(electronApp, fixtureUrl, "prepare");
    await waitUntil(
      () =>
        composerFixtureAction(electronApp, fixtureUrl, "state")
          .then(() => true)
          .catch(() => false),
      10_000,
    );
    await composerFixtureAction(electronApp, fixtureUrl, "click", "切账号前待确认");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();

    const alicePrincipal = principalId(baseUrl, USERNAME);
    const alicePartition = `persist:sharegpt-ai-${alicePrincipal}-gpt-env-gpt-one`;
    const aliceMarker = await partitionStorage(
      electronApp,
      alicePartition,
      fixtureUrl,
      "alice-only",
    );
    assert.strictEqual(aliceMarker.local, "alice-only");
    assert.match(aliceMarker.cookie, /principal-marker=alice-only/);

    await window.locator('[data-tour="nav-account"]').click();
    await window.getByRole("button", { name: "退出登录", exact: true }).click();
    await window.locator("#account-server").waitFor({ state: "visible" });
    await login(window, baseUrl, SECOND_ADVANCED_USERNAME);
    assert.strictEqual(await window.getByRole("button", { name: "仍然发送" }).count(), 0);
    results.push("principal switch invalidates composer confirmation");
    const bobInitial = await window.evaluate(async () => window.api.loadSettings());
    assert.deepStrictEqual(bobInitial.advancedAi.environments, []);
    assert.strictEqual(bobInitial.translation.api.baseUrl, "");
    assert.strictEqual(bobInitial.translation.ai.apiKey, "");
    assert.strictEqual(bobInitial.translation.autoTranslateSelection, false);
    await window.locator('[data-tour="nav-notes"]').click();
    await window.getByTitle("今日笔记").click();
    await window.getByRole("button", { name: "AI", exact: true }).click();
    const bobNotesApiKeyInput = window.getByLabel("API Key");
    await bobNotesApiKeyInput.waitFor();
    assert.strictEqual(await bobNotesApiKeyInput.inputValue(), "");
    results.push("Notes AI runtime drops the previous principal provider on A-to-B switch");
    await window.locator('[data-tour="nav-account"]').click();
    await patchSection(window, "advancedAi", {
      version: 1,
      enabled: true,
      environments: [
        { id: "env-bob", kind: "gpt", name: "Bob only", routeId: "route-a", createdAt: now },
      ],
      activeByKind: { gpt: "env-bob", gemini: "", claude: "" },
    });
    await patchSection(window, "translation", {
      provider: "api",
      api: { baseUrl: `${fixtureUrl}/bob`, apiKey: "" },
    });
    const bobPrincipal = principalId(baseUrl, SECOND_ADVANCED_USERNAME);
    const bobPartition = `persist:sharegpt-ai-${bobPrincipal}-gpt-env-bob`;
    const bobMarker = await partitionStorage(electronApp, bobPartition, fixtureUrl);
    assert.strictEqual(bobMarker.local, null);
    assert.doesNotMatch(bobMarker.cookie, /principal-marker/);
    await window.locator('[data-tour="nav-account"]').click();
    await window.getByRole("button", { name: "退出登录", exact: true }).click();
    await login(window, baseUrl, USERNAME);
    const aliceAgain = await window.evaluate(async () => window.api.loadSettings());
    assert.ok(aliceAgain.advancedAi.environments.some((item) => item.id === "env-gpt-one"));
    assert.ok(!aliceAgain.advancedAi.environments.some((item) => item.id === "env-bob"));
    assert.notStrictEqual(aliceAgain.translation.api.baseUrl, `${fixtureUrl}/bob`);
    assert.strictEqual(aliceAgain.translation.ai.apiKey, "alice-notes-key");
    assert.strictEqual(aliceAgain.translation.autoTranslateSelection, true);
    const restoredAliceMarker = await partitionStorage(electronApp, alicePartition, fixtureUrl);
    assert.strictEqual(restoredAliceMarker.local, "alice-only");
    assert.match(restoredAliceMarker.cookie, /principal-marker=alice-only/);
    results.push(
      "two advanced principals isolate environments, translation, cookies and local storage",
    );

    await patchSection(window, "advancedAi", { ...aliceAgain.advancedAi, enabled: true });
    const staleError = await window.evaluate(async () => {
      await window.api.closeAllAiWorkspaces();
      await window.api.activateAiEnvironment({
        kind: "gpt",
        environmentId: "env-gpt-one",
        generation: 5000,
      });
      await window.api.activateAiEnvironment({
        kind: "gpt",
        environmentId: "env-gpt-two",
        generation: 5001,
      });
      try {
        await window.api.ensureAiWorkspace({
          kind: "gpt",
          environmentId: "env-gpt-one",
          generation: 5000,
          tabId: "stale-a",
          host: "127.0.0.1",
          port: "1",
        });
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(staleError, /已失效/);
    const staleWorkspaceCount = await electronApp.evaluate(
      ({ session, webContents }, partition) => {
        const targetSession = session.fromPartition(partition);
        return webContents
          .getAllWebContents()
          .filter((contents) => !contents.isDestroyed() && contents.session === targetSession)
          .length;
      },
      alicePartition,
    );
    assert.strictEqual(staleWorkspaceCount, 0);
    results.push("stale generation is rejected before recreating the old workspace");

    await window.locator('[data-tour="nav-account"]').click();
    await window.getByRole("button", { name: "退出登录", exact: true }).click();
    await window.locator("#account-server").waitFor({ state: "visible" });
    await login(window, baseUrl, BASIC_USERNAME);
    await patchSection(window, "translation", {
      provider: "offline",
      sourceLanguage: "en",
      targetLanguage: "zh",
      siteLanguage: "en",
      autoTranslateSelection: true,
      offline: { baseUrl: fixtureUrl },
    });
    await window.reload();
    await login(window, baseUrl, BASIC_USERNAME);
    const basicSenderPort = await reservePort();
    await window.evaluate(
      ({ listenPort }) =>
        window.api.startSender({
          socks_listen_port: String(listenPort),
          fallback_mode: "direct",
          proxy_mode: "unified",
          target_domains: "claude.ai\nanthropic.com",
        }),
      { listenPort: basicSenderPort, upstreamPort: socksPort },
    );
    await window.locator('[data-tour="nav-claude"]').click();
    assert.strictEqual(await window.getByLabel("打开翻译侧栏").count(), 1);
    assert.strictEqual(await window.getByLabel(/管理环境与线路|新建 AI 环境/).count(), 0);
    await window.getByLabel("打开网页").click();
    await window.getByTestId("claude-address-input").fill(`${fixtureUrl}/page`);
    await window.getByLabel("在新标签页打开").click();
    await composerFixtureAction(electronApp, fixtureUrl, "prepare");
    let basicGuardState = null;
    await waitUntil(async () => {
      basicGuardState = await composerFixtureAction(electronApp, fixtureUrl, "guard-state");
      return basicGuardState?.ready === true && basicGuardState?.selectionEnabled === false;
    });

    await window.getByLabel("打开翻译侧栏").click();
    const basicTranslationPanel = window.getByRole("complementary", { name: "翻译侧栏" });
    await basicTranslationPanel.getByLabel("待翻译内容").fill("basic translation");
    await basicTranslationPanel.getByRole("button", { name: "翻译", exact: true }).click();
    await window.getByText("[ZH] basic translation", { exact: true }).waitFor();
    assert.strictEqual(await composerFixtureAction(electronApp, fixtureUrl, "focus"), true);
    await basicTranslationPanel.getByRole("button", { name: "中文提问", exact: true }).click();
    await basicTranslationPanel.getByLabel("中文提问内容").fill("普通账号翻译发送");
    await basicTranslationPanel.getByRole("button", { name: "翻译并发送" }).click();
    try {
      await waitUntil(async () => {
        const state = await composerFixtureAction(electronApp, fixtureUrl, "state");
        return state.enters === 1;
      });
    } catch (error) {
      const state = await composerFixtureAction(electronApp, fixtureUrl, "state");
      const panelText = await basicTranslationPanel.textContent();
      const feedbackText = await window.locator("body").textContent();
      throw new Error(
        `basic translated send failed: state=${JSON.stringify(state)} panel=${JSON.stringify(panelText)} main=${JSON.stringify(feedbackText)}`,
        { cause: error },
      );
    }
    await basicTranslationPanel.getByLabel("关闭翻译侧栏").click();

    await composerFixtureAction(electronApp, fixtureUrl, "click", "普通账号直接发送保护");
    await window.getByRole("button", { name: "仍然发送" }).waitFor();
    await window.getByRole("button", { name: "仍然发送" }).click();
    await waitUntil(async () => {
      const state = await composerFixtureAction(electronApp, fixtureUrl, "state");
      return state.enters === 2;
    });
    assert.strictEqual((await composerFixtureAction(electronApp, fixtureUrl, "state")).clicks, 0);
    const basicSettings = await window.evaluate(async () => window.api.loadSettings());
    assert.deepStrictEqual(basicSettings.sender.managed_proxy_routes, []);
    assert.deepStrictEqual(basicSettings.sender.authorized_proxy_route_ids, []);
    const forgedAirportError = await window.evaluate(async () => {
      try {
        await window.api.startSender({
          socks_listen_port: "18888",
          fallback_mode: "direct",
          proxy_mode: "airport",
          airport_name: "forged",
          airport_outbound: { type: "socks", server: "127.0.0.1", server_port: 9 },
          authorized_proxy_route_ids: ["internal-airport"],
          target_domains: "claude.ai",
        });
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(forgedAirportError, /未获授权使用机场节点/);
    await patchSection(window, "advancedAi", {
      version: 1,
      enabled: true,
      environments: [
        { id: "forged-basic-env", kind: "claude", name: "forged", routeId: "route-a" },
      ],
      activeByKind: { gpt: "", gemini: "", claude: "forged-basic-env" },
    });
    const forgedEnvironmentError = await window.evaluate(async () => {
      try {
        await window.api.activateAiEnvironment({
          kind: "claude",
          environmentId: "forged-basic-env",
          generation: 9001,
        });
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(forgedEnvironmentError, /未获授权使用高级 AI 环境/);
    const basicStatus = await window.evaluate(async () => window.api.getStatus());
    assert.strictEqual(basicStatus.senderRunning, true);
    assert.deepStrictEqual(basicStatus.aiProxyRoutes, []);
    results.push(
      "basic account can translate, fill/send and use direct-send protection without advanced controls or route authorization",
    );

    await window.evaluate(async () => window.api.clearSettingsPrincipal());
    const clearedPrincipalStatus = await window.evaluate(async () => window.api.getStatus());
    assert.strictEqual(clearedPrincipalStatus.senderRunning, false);
    assert.deepStrictEqual(clearedPrincipalStatus.aiProxyRoutes, []);
    results.push(
      "main-process principal clear stops sender without renderer lifecycle cooperation",
    );

    assert.deepStrictEqual(pageErrors, [], `renderer page errors: ${pageErrors.join("\n")}`);
    assert.ok(
      blockedRequests.length > 0,
      "expected remote AI requests to be blocked by the test harness",
    );
    const summary = {
      ok: true,
      tempDir,
      userDataDir,
      blockedRemoteRequests: blockedRequests.length,
      checks: results,
      screenshots: fs.readdirSync(tempDir).filter((name) => name.endsWith(".png")),
      keptOpen: keepOpen,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (keepOpen) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows().find(
          (candidate) => !candidate.isDestroyed(),
        );
        mainWindow.setSize(1280, 800);
        mainWindow.center();
        mainWindow.show();
        mainWindow.focus();
      });
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } finally {
    await electronApp?.close().catch(() => undefined);
    await stopChild(collab);
    await Promise.all([closeServer(socksServer), closeServer(fixtureServer)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
