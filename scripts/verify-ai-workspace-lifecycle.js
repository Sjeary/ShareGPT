const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HOST_BOUNDS = Object.freeze({ x: 96, y: 96, width: 920, height: 560 });

function waitUntil(predicate, label, timeoutMs = 15_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
      } catch (error) {
        if (Date.now() - startedAt >= timeoutMs) return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }
      setTimeout(poll, 50);
    };
    void poll();
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

function fixtureDocument() {
  return `<!doctype html>
    <meta charset="utf-8">
    <title>ShareGPT lifecycle fixture</title>
    <style>
      html, body { margin: 0; min-height: 100%; background: #157a6e; color: white; }
      body { font: 18px system-ui; padding: 24px; }
    </style>
    <h1>AI lifecycle fixture</h1>
    <p id="location"></p>
    <form id="composer" data-testid="composer">
      <textarea id="prompt-textarea" aria-label="Prompt" style="width: 480px; height: 100px"></textarea>
      <button data-testid="send-button" type="submit">Send</button>
    </form>
    <script>
      (() => {
        const originalPath = location.pathname;
        const loadKey = 'fixture-loads:' + originalPath;
        const loads = Number(localStorage.getItem(loadKey) || 0) + 1;
        localStorage.setItem(loadKey, String(loads));
        const bootId = Math.random().toString(36).slice(2);
        window.__sharegptLifecycleFixture = { bootId, loads, originalPath };
        document.querySelector('#location').textContent = location.href;
        window.__composerState = {
          enterEvents: 0,
          requests: 0,
          responseStatuses: [],
          submits: 0,
          submittedTexts: [],
        };
        const form = document.querySelector('#composer');
        const editor = document.querySelector('#prompt-textarea');
        editor.addEventListener('keydown', (event) => {
          if (
            event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey ||
            event.shiftKey || event.repeat || event.isComposing
          ) return;
          window.__composerState.enterEvents += 1;
          event.preventDefault();
          form.requestSubmit();
        });
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const text = editor.value.trim();
          if (!text) return;
          window.__composerState.requests += 1;
          const response = await fetch(window.__conversationEndpoint || '/backend-api/conversation', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          window.__composerState.responseStatuses.push(response.status);
          if (!response.ok) return;
          window.__composerState.submits += 1;
          window.__composerState.submittedTexts.push(text);
          editor.value = '';
          editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward',
          }));
        });
      })();
    </script>`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createCertificate(directory) {
  const keyPath = path.join(directory, "fixture-key.pem");
  const certificatePath = path.join(directory, "fixture-cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      "/CN=chatgpt.com",
      "-addext",
      "subjectAltName=DNS:chatgpt.com,DNS:*.chatgpt.com",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`unable to create the local TLS certificate: ${result.stderr || result.error}`);
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certificatePath),
  };
}

async function startFixtureServers(directory) {
  const handler = (request, response) => {
    if (request.method === "POST" && request.url?.startsWith("/backend-api/conversation")) {
      const fixtureUrl = new URL(request.url, "https://chatgpt.com");
      const requestedStatus = Number(fixtureUrl.searchParams.get("status"));
      const status =
        Number.isInteger(requestedStatus) && requestedStatus >= 100 ? requestedStatus : 200;
      const complete = () => {
        response.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
      };
      const requestedDelay = Number(fixtureUrl.searchParams.get("delayMs"));
      if (Number.isFinite(requestedDelay) && requestedDelay > 0)
        setTimeout(complete, requestedDelay);
      else if (request.url.includes("delay=1")) setTimeout(complete, 500);
      else complete();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(fixtureDocument());
  };
  const httpServer = await listen(http.createServer(handler));
  const httpsServer = await listen(https.createServer(createCertificate(directory), handler));
  return { httpServer, httpsServer };
}

function parseSocksRequest(buffer) {
  if (buffer.length < 4 || buffer[0] !== 5 || buffer[1] !== 1) return null;
  const addressType = buffer[3];
  let offset = 4;
  let host = "";
  if (addressType === 1) {
    if (buffer.length < 10) return null;
    host = [...buffer.subarray(offset, offset + 4)].join(".");
    offset += 4;
  } else if (addressType === 3) {
    const size = buffer[offset];
    if (buffer.length < offset + 1 + size + 2) return null;
    host = buffer.subarray(offset + 1, offset + 1 + size).toString("utf8");
    offset += 1 + size;
  } else if (addressType === 4) {
    if (buffer.length < 22) return null;
    host = "::1";
    offset += 16;
  } else {
    return { invalid: true };
  }
  return { host, port: buffer.readUInt16BE(offset), consumed: offset + 2 };
}

async function startFixtureSocks({ httpPort, httpsPort }) {
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
        const consumed = 2 + buffer[1];
        if (buffer.length < consumed) return;
        buffer = buffer.subarray(consumed);
        client.write(Buffer.from([5, 0]));
        stage = "request";
      }
      if (stage !== "request") return;
      const request = parseSocksRequest(buffer);
      if (!request) return;
      if (request.invalid) {
        client.destroy();
        return;
      }
      server.requests.push({ host: request.host, port: request.port });
      const pending = buffer.subarray(request.consumed);
      buffer = Buffer.alloc(0);
      const fixturePort = request.port === 443 ? httpsPort : httpPort;
      upstream = net.connect({ host: "127.0.0.1", port: fixturePort }, () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        if (pending.length) upstream.write(pending);
        stage = "relay";
      });
      upstream.on("data", (data) => client.write(data));
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.end());
    });
    client.on("error", () => undefined);
    client.on("close", () => upstream?.destroy());
  });
  server.requests = [];
  await listen(server);
  return server;
}

async function api(page, method, ...args) {
  return page.evaluate(({ methodName, methodArgs }) => window.api[methodName](...methodArgs), {
    methodName: method,
    methodArgs: args,
  });
}

async function appSnapshot(electronApp) {
  return electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    const describe = (contents) => ({
      id: contents.id,
      type: contents.getType(),
      url: contents.getURL(),
      destroyed: contents.isDestroyed(),
    });
    return {
      attached: (main?.contentView.children || []).map((view) => ({
        ...describe(view.webContents),
        visible: view.getVisible(),
        bounds: view.getBounds(),
      })),
      contents: webContents
        .getAllWebContents()
        .filter((contents) => /fixture\.invalid|chatgpt\.com/.test(contents.getURL()))
        .map(describe),
    };
  });
}

function visibleFixture(snapshot) {
  return snapshot.attached.filter(
    (item) => item.visible && /fixture\.invalid|chatgpt\.com/.test(item.url),
  );
}

async function fixtureState(electronApp, urlPattern, script = "window.__sharegptLifecycleFixture") {
  return electronApp.evaluate(
    async ({ webContents }, args) => {
      const matches = webContents
        .getAllWebContents()
        .filter(
          (candidate) =>
            !candidate.isDestroyed() &&
            !candidate.isCrashed() &&
            new RegExp(args.urlPattern).test(candidate.getURL()),
        )
        .sort((left, right) => right.id - left.id);
      for (const contents of matches) {
        try {
          return {
            webContentsId: contents.id,
            value: await contents.executeJavaScript(args.script),
          };
        } catch {}
      }
      return null;
    },
    { urlPattern, script },
  );
}

async function waitForFixture(electronApp, urlPattern, label) {
  return waitUntil(async () => {
    const state = await fixtureState(electronApp, urlPattern);
    return state?.value?.bootId ? state : null;
  }, label);
}

async function switchTab(page, kind, tabId) {
  return api(page, "switchAiView", kind, { tabId });
}

async function activateKind(page, kind) {
  return api(page, "setActiveAiKind", kind);
}

async function syncHost(page, kind, tabId) {
  return api(page, "syncAiViewHost", {
    kind,
    tabId,
    visible: true,
    bounds: HOST_BOUNDS,
  });
}

async function activateTab(page, kind, tabId) {
  await activateKind(page, kind);
  await switchTab(page, kind, tabId);
  await syncHost(page, kind, tabId);
}

async function ensureTab(page, { kind, tabId, url, socksPort, allowExternalBrowsing = false }) {
  await activateTab(page, kind, tabId);
  return api(page, "ensureAiWorkspace", {
    kind,
    tabId,
    host: "127.0.0.1",
    port: socksPort,
    homeUrl: url,
    lastUrl: url,
    allowExternalBrowsing,
  });
}

async function patchTranslation(page, principalId, patch) {
  const principal = await api(page, "getSettingsPrincipal");
  assert.equal(principal.principalId, principalId);
  const settings = await api(page, "loadSettings", {
    expectedPrincipalId: principal.principalId,
    expectedPrincipalGeneration: principal.generation,
  });
  return api(page, "patchSettings", {
    section: "translation",
    patch,
    expectedRevision: settings.settingsRevision,
    expectedPrincipalId: principalId,
    expectedPrincipalGeneration: principal.generation,
  });
}

async function composerTarget(page, tabId, kind = "gpt") {
  return api(page, "getAiComposerTarget", {
    kind,
    tabId,
    environmentId: "",
  });
}

async function emitFixtureWebContentsEvent(electronApp, urlPattern, eventName) {
  return electronApp.evaluate(
    ({ webContents }, { pattern, name }) => {
      const contents = webContents
        .getAllWebContents()
        .filter(
          (candidate) =>
            !candidate.isDestroyed() &&
            !candidate.isCrashed() &&
            new RegExp(pattern).test(candidate.getURL()),
        )
        .sort((left, right) => right.id - left.id)[0];
      if (!contents) throw new Error(`fixture webContents not found for ${pattern}`);
      contents.emit(name);
      return contents.id;
    },
    { pattern: urlPattern, name: eventName },
  );
}

async function writeComposer(page, tabId, text) {
  const target = await composerTarget(page, tabId);
  return api(page, "writeAiComposer", { target, text, send: false });
}

async function sendTrustedEnter(electronApp, urlPattern) {
  return electronApp.evaluate(({ webContents }, pattern) => {
    const contents = webContents
      .getAllWebContents()
      .filter(
        (candidate) =>
          !candidate.isDestroyed() &&
          !candidate.isCrashed() &&
          new RegExp(pattern).test(candidate.getURL()),
      )
      .sort((left, right) => right.id - left.id)[0];
    if (!contents) throw new Error("composer fixture webContents not found");
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    return contents.id;
  }, urlPattern);
}

async function sendTrustedClick(electronApp, urlPattern) {
  return electronApp.evaluate(async ({ webContents }, pattern) => {
    const contents = webContents
      .getAllWebContents()
      .filter(
        (candidate) =>
          !candidate.isDestroyed() &&
          !candidate.isCrashed() &&
          new RegExp(pattern).test(candidate.getURL()),
      )
      .sort((left, right) => right.id - left.id)[0];
    if (!contents) throw new Error("composer fixture webContents not found");
    const point = await contents.executeJavaScript(`(() => {
      const rect = document.querySelector('[data-testid="send-button"]').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    contents.focus();
    contents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    return contents.id;
  }, urlPattern);
}

async function sendTrustedEnterToPatterns(electronApp, urlPatterns) {
  return electronApp.evaluate(({ webContents }, patterns) => {
    return patterns.map((pattern) => {
      const contents = webContents
        .getAllWebContents()
        .filter(
          (candidate) =>
            !candidate.isDestroyed() &&
            !candidate.isCrashed() &&
            new RegExp(pattern).test(candidate.getURL()),
        )
        .sort((left, right) => right.id - left.id)[0];
      if (!contents) throw new Error(`composer fixture webContents not found for ${pattern}`);
      contents.focus();
      contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      return contents.id;
    });
  }, urlPatterns);
}

async function aiEvents(page, type, tabId) {
  return page.evaluate(
    ({ eventType, targetTabId }) =>
      (window.__lifecycleAiEvents || []).filter(
        (event) => event?.type === eventType && (!targetTabId || event?.tabId === targetTabId),
      ),
    { eventType: type, targetTabId: tabId },
  );
}

async function clearAiEvents(page) {
  await page.evaluate(() => {
    window.__lifecycleAiEvents = [];
  });
}

async function composerState(electronApp, urlPattern) {
  return (await fixtureState(electronApp, urlPattern, "window.__composerState"))?.value || null;
}

async function resetComposerState(electronApp, urlPattern) {
  return fixtureState(
    electronApp,
    urlPattern,
    `(() => {
      const editor = document.querySelector('#prompt-textarea');
      editor.value = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      window.__composerState.enterEvents = 0;
      window.__composerState.requests = 0;
      window.__composerState.responseStatuses = [];
      window.__composerState.submits = 0;
      window.__composerState.submittedTexts = [];
      return window.__composerState;
    })()`,
  );
}

async function waitForAiEvent(page, type, tabId, count, label) {
  return waitUntil(async () => {
    const events = await aiEvents(page, type, tabId);
    return events.length >= count ? events : null;
  }, label);
}

async function verifyProductionComposer({ electronApp, page, principalId, tabId }) {
  const urlPattern = "chatgpt\\.com/gpt/a";
  await activateTab(page, "gpt", tabId);
  await page.evaluate(() => {
    window.__disposeLifecycleAiEvents?.();
    window.__lifecycleAiEvents = [];
    window.__disposeLifecycleAiEvents = window.api.onAiEvent((event) => {
      window.__lifecycleAiEvents.push(event);
    });
  });

  process.stdout.write("[verify] production composer guard is off by default\n");
  const settingsPrincipal = await api(page, "getSettingsPrincipal");
  const defaultSettings = await api(page, "loadSettings", {
    expectedPrincipalId: settingsPrincipal.principalId,
    expectedPrincipalGeneration: settingsPrincipal.generation,
  });
  assert.notEqual(defaultSettings.translation?.confirmNonTargetSend, true);
  await patchTranslation(page, principalId, {
    confirmNonTargetSend: false,
    siteLanguage: "en",
  });
  await api(page, "syncAiComposerGuard");
  await resetComposerState(electronApp, urlPattern);
  await writeComposer(page, tabId, "默认关闭时直接发送中文");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.submits === 1,
    "guard-off composer send",
  );
  assert.equal((await aiEvents(page, "composer-confirmation", tabId)).length, 0);
  await waitForAiEvent(page, "accepted-send", tabId, 1, "guard-off accepted send");

  process.stdout.write("[verify] the same editor accepts two consecutive successful sends\n");
  await clearAiEvents(page);
  await resetComposerState(electronApp, urlPattern);
  await writeComposer(page, tabId, "first rapid send");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.submits === 1,
    "first rapid composer send",
  );
  await writeComposer(page, tabId, "second rapid send");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.submits === 2,
    "second rapid composer send",
  );
  const rapidAccepted = await waitForAiEvent(
    page,
    "accepted-send",
    tabId,
    2,
    "two rapid accepted sends",
  );
  assert.equal(new Set(rapidAccepted.map((event) => event.usageId)).size, 2);

  process.stdout.write("[verify] an old success cannot accept a newer failed gesture\n");
  await clearAiEvents(page);
  await resetComposerState(electronApp, urlPattern);
  await fixtureState(
    electronApp,
    urlPattern,
    "fetch('/backend-api/conversation').then((response) => response.status)",
  );
  await fixtureState(
    electronApp,
    urlPattern,
    "window.__conversationEndpoint = '/backend-api/conversation?status=500'",
  );
  await writeComposer(page, tabId, "this request must fail");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.responseStatuses.includes(500),
    "failed request after old success",
  );
  assert.equal((await aiEvents(page, "accepted-send", tabId)).length, 0);

  process.stdout.write("[verify] out-of-order success and failure settle by request id\n");
  await clearAiEvents(page);
  await resetComposerState(electronApp, urlPattern);
  await fixtureState(
    electronApp,
    urlPattern,
    "window.__conversationEndpoint = '/backend-api/conversation?delayMs=300&status=500'",
  );
  await writeComposer(page, tabId, "slow failed request");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.requests === 1,
    "slow failed request started",
  );
  await fixtureState(
    electronApp,
    urlPattern,
    "window.__conversationEndpoint = '/backend-api/conversation?delayMs=30'",
  );
  await writeComposer(page, tabId, "fast successful request");
  await sendTrustedEnter(electronApp, urlPattern);
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.responseStatuses.length === 2,
    "out-of-order requests completed",
  );
  const outOfOrderAccepted = await waitForAiEvent(
    page,
    "accepted-send",
    tabId,
    1,
    "out-of-order accepted send",
  );
  assert.equal(outOfOrderAccepted.length, 1);
  assert.deepEqual((await composerState(electronApp, urlPattern)).submittedTexts, [
    "fast successful request",
  ]);
  await fixtureState(
    electronApp,
    urlPattern,
    "window.__conversationEndpoint = '/backend-api/conversation'",
  );

  process.stdout.write("[verify] cancel and close consume production confirmations without send\n");
  await clearAiEvents(page);
  await resetComposerState(electronApp, urlPattern);
  await patchTranslation(page, principalId, {
    confirmNonTargetSend: true,
    siteLanguage: "en",
  });
  const guardSync = await api(page, "syncAiComposerGuard");
  assert.ok(guardSync.updated >= 1);

  await writeComposer(page, tabId, "取消这次中文发送");
  await sendTrustedEnter(electronApp, urlPattern);
  const cancelEvents = await waitForAiEvent(
    page,
    "composer-confirmation",
    tabId,
    1,
    "cancel confirmation",
  );
  assert.equal(cancelEvents.length, 1);
  assert.equal(cancelEvents[0].targetLanguage, "en");
  const cancelled = await api(page, "resolveAiComposerConfirmation", {
    requestId: cancelEvents[0].requestId,
    confirmed: false,
  });
  assert.deepEqual(cancelled, { ok: true, sent: false });
  assert.equal((await composerState(electronApp, urlPattern)).submits, 0);
  await assert.rejects(
    api(page, "resolveAiComposerConfirmation", {
      requestId: cancelEvents[0].requestId,
      confirmed: true,
    }),
    /发送确认已失效/,
  );

  await clearAiEvents(page);
  await writeComposer(page, tabId, "关闭这次中文提示");
  await sendTrustedEnter(electronApp, urlPattern);
  const closeEvents = await waitForAiEvent(
    page,
    "composer-confirmation",
    tabId,
    1,
    "close confirmation",
  );
  assert.equal(closeEvents.length, 1);
  const closed = await api(page, "resolveAiComposerConfirmation", {
    requestId: closeEvents[0].requestId,
    confirmed: false,
  });
  assert.deepEqual(closed, { ok: true, sent: false });
  assert.equal((await composerState(electronApp, urlPattern)).submits, 0);
  await assert.rejects(
    api(page, "resolveAiComposerConfirmation", {
      requestId: closeEvents[0].requestId,
      confirmed: false,
    }),
    /发送确认已失效/,
  );

  process.stdout.write("[verify] confirmed replay sends once and emits one accepted usage id\n");
  await clearAiEvents(page);
  await writeComposer(page, tabId, "确认后只发送一次");
  await sendTrustedEnter(electronApp, urlPattern);
  const confirmedEvents = await waitForAiEvent(
    page,
    "composer-confirmation",
    tabId,
    1,
    "confirmed composer request",
  );
  assert.equal(confirmedEvents.length, 1);
  const confirmed = await api(page, "resolveAiComposerConfirmation", {
    requestId: confirmedEvents[0].requestId,
    confirmed: true,
  });
  assert.deepEqual(confirmed, { ok: true, sent: true });
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.submits === 1,
    "confirmed composer submission",
  );
  const accepted = await waitForAiEvent(page, "accepted-send", tabId, 1, "confirmed accepted-send");
  assert.equal(accepted.length, 1);
  assert.equal(new Set(accepted.map((event) => event.usageId)).size, 1);
  assert.deepEqual((await composerState(electronApp, urlPattern)).submittedTexts, [
    "确认后只发送一次",
  ]);
  await assert.rejects(
    api(page, "resolveAiComposerConfirmation", {
      requestId: confirmedEvents[0].requestId,
      confirmed: true,
    }),
    /发送确认已失效/,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await composerState(electronApp, urlPattern)).submits, 1);
  assert.equal((await aiEvents(page, "accepted-send", tabId)).length, 1);

  process.stdout.write("[verify] trusted click confirmation replays and submits exactly once\n");
  await clearAiEvents(page);
  await resetComposerState(electronApp, urlPattern);
  await writeComposer(page, tabId, "点击确认只发送一次");
  await sendTrustedClick(electronApp, urlPattern);
  const clickEvents = await waitForAiEvent(
    page,
    "composer-confirmation",
    tabId,
    1,
    "click composer request",
  );
  assert.equal(clickEvents[0].requestId.length > 0, true);
  const clickConfirmed = await api(page, "resolveAiComposerConfirmation", {
    requestId: clickEvents[0].requestId,
    confirmed: true,
  });
  assert.deepEqual(clickConfirmed, { ok: true, sent: true });
  await waitUntil(
    async () => (await composerState(electronApp, urlPattern))?.submits === 1,
    "click confirmation submission",
  );
  const clickAccepted = await waitForAiEvent(
    page,
    "accepted-send",
    tabId,
    1,
    "click accepted-send",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(clickAccepted.length, 1);
  assert.equal((await composerState(electronApp, urlPattern)).submits, 1);
  assert.equal((await aiEvents(page, "accepted-send", tabId)).length, 1);

  process.stdout.write("[verify] SPA navigation invalidates the pending production confirmation\n");
  await clearAiEvents(page);
  await writeComposer(page, tabId, "页面变化后不能再确认");
  await sendTrustedEnter(electronApp, urlPattern);
  const staleEvents = await waitForAiEvent(
    page,
    "composer-confirmation",
    tabId,
    1,
    "pre-SPA confirmation",
  );
  await fixtureState(
    electronApp,
    urlPattern,
    "history.pushState({}, '', '/composer-spa'); location.href",
  );
  await waitForAiEvent(
    page,
    "composer-confirmation-invalidated",
    tabId,
    1,
    "SPA confirmation invalidation",
  );
  await assert.rejects(
    api(page, "resolveAiComposerConfirmation", {
      requestId: staleEvents[0].requestId,
      confirmed: true,
    }),
    /发送确认已失效/,
  );
  assert.equal((await composerState(electronApp, "chatgpt\\.com/composer-spa")).submits, 1);
  assert.equal((await aiEvents(page, "accepted-send", tabId)).length, 0);
}

async function verifyConcurrentTabUsage({ electronApp, page, principalId, gptAId, gptBId }) {
  const gptAPattern = "chatgpt\\.com/composer-spa";
  const gptBPattern = "chatgpt\\.com/conversation/42";
  await patchTranslation(page, principalId, {
    confirmNonTargetSend: false,
    siteLanguage: "en",
  });
  await api(page, "syncAiComposerGuard");
  await clearAiEvents(page);

  await activateTab(page, "gpt", gptAId);
  await resetComposerState(electronApp, gptAPattern);
  await writeComposer(page, gptAId, "simultaneous send from A");
  await activateTab(page, "gpt", gptBId);
  await resetComposerState(electronApp, gptBPattern);
  await writeComposer(page, gptBId, "simultaneous send from B");

  process.stdout.write("[verify] two GPT tabs send with distinct accepted usage ids\n");
  const contentsIds = await sendTrustedEnterToPatterns(electronApp, [gptAPattern, gptBPattern]);
  assert.equal(new Set(contentsIds).size, 2);
  await waitUntil(
    async () =>
      (await composerState(electronApp, gptAPattern))?.submits === 1 &&
      (await composerState(electronApp, gptBPattern))?.submits === 1,
    "simultaneous GPT tab submissions",
  );
  const [acceptedA, acceptedB] = await Promise.all([
    waitForAiEvent(page, "accepted-send", gptAId, 1, "GPT A simultaneous accepted-send"),
    waitForAiEvent(page, "accepted-send", gptBId, 1, "GPT B simultaneous accepted-send"),
  ]);
  assert.equal(acceptedA.length, 1);
  assert.equal(acceptedB.length, 1);
  assert.notEqual(acceptedA[0].usageId, acceptedB[0].usageId);
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-app-lifecycle-"));
  const userData = path.join(temporaryRoot, "user-data");
  const { httpServer, httpsServer } = await startFixtureServers(temporaryRoot);
  const socksServer = await startFixtureSocks({
    httpPort: httpServer.address().port,
    httpsPort: httpsServer.address().port,
  });
  const socksPort = socksServer.address().port;
  const gptAUrl = "https://chatgpt.com/gpt/a";
  const gptBUrl = "https://chatgpt.com/gpt/b";
  const claudeUrl = "http://fixture.invalid/claude/a";
  let electronApp = null;

  try {
    electronApp = await electron.launch({
      args: [ROOT, "--ignore-certificate-errors"],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: userData, SHAREGPT_LOG_LEVEL: "warn" },
    });
    const page = await electronApp.firstWindow();
    await page.waitForFunction(() => Boolean(window.api?.createAiView));
    const principal = await api(page, "activateSettingsPrincipal", {
      serverUrl: `http://127.0.0.1:${httpServer.address().port}`,
      username: "lifecycle-fixture",
    });
    assert.ok(principal.principalId);

    process.stdout.write(
      "[verify] create GPT and Claude tabs through the production IPC registry\n",
    );
    const gptA = await api(page, "createAiView", "gpt", { lastUrl: gptAUrl });
    const gptB = await api(page, "createAiView", "gpt", { lastUrl: gptBUrl });
    const claude = await api(page, "createAiView", "claude", {
      lastUrl: claudeUrl,
      allowExternalBrowsing: true,
    });
    const gptAId = gptA.activeTabId;
    const gptBId = gptB.activeTabId;
    const claudeId = claude.activeTabId;
    assert.ok(gptAId && gptBId && claudeId);
    assert.notEqual(gptAId, gptBId);

    await ensureTab(page, { kind: "gpt", tabId: gptAId, url: gptAUrl, socksPort });
    const firstGptA = await waitForFixture(electronApp, "chatgpt\\.com/gpt/a", "GPT A load").catch(
      async (error) => {
        error.message += `\n${JSON.stringify(
          {
            socksRequests: socksServer.requests,
            app: await appSnapshot(electronApp),
            tabs: await api(page, "listAiViews", "gpt"),
          },
          null,
          2,
        )}`;
        throw error;
      },
    );
    await fixtureState(
      electronApp,
      "chatgpt\\.com/gpt/a",
      "localStorage.setItem('workspace-identity:gpt-a', 'GPT-A'); window.__sharegptLifecycleFixture",
    );

    await ensureTab(page, { kind: "gpt", tabId: gptBId, url: gptBUrl, socksPort });
    const firstGptB = await waitForFixture(electronApp, "chatgpt\\.com/gpt/b", "GPT B load");
    await fixtureState(
      electronApp,
      "chatgpt\\.com/gpt/b",
      "localStorage.setItem('workspace-identity:gpt-b', 'GPT-B'); window.__sharegptLifecycleFixture",
    );

    await ensureTab(page, {
      kind: "claude",
      tabId: claudeId,
      url: claudeUrl,
      socksPort,
      allowExternalBrowsing: true,
    });
    const firstClaude = await waitForFixture(
      electronApp,
      "fixture\\.invalid/claude/a",
      "Claude load",
    );
    await fixtureState(
      electronApp,
      "fixture\\.invalid/claude/a",
      "localStorage.setItem('workspace-identity:claude', 'CLAUDE'); window.__sharegptLifecycleFixture",
    );

    process.stdout.write("[verify] Claude loading pulse keeps the ready composer document\n");
    const claudeTargetBeforePulse = await composerTarget(page, claudeId, "claude");
    await emitFixtureWebContentsEvent(
      electronApp,
      "fixture\\.invalid/claude/a",
      "did-start-loading",
    );
    const claudeTargetAfterPulse = await composerTarget(page, claudeId, "claude");
    assert.deepEqual(claudeTargetAfterPulse, claudeTargetBeforePulse);
    await emitFixtureWebContentsEvent(
      electronApp,
      "fixture\\.invalid/claude/a",
      "did-stop-loading",
    );

    process.stdout.write("[verify] GPT / Claude / ordinary navigation detaches without reload\n");
    for (let index = 0; index < 12; index += 1) {
      await activateTab(page, "gpt", gptAId);
      await activateTab(page, "claude", claudeId);
      await activateKind(page, "");
    }
    assert.equal(visibleFixture(await appSnapshot(electronApp)).length, 0);
    assert.deepEqual(
      await fixtureState(electronApp, "chatgpt\\.com/gpt/a", "window.__sharegptLifecycleFixture"),
      firstGptA,
    );
    assert.deepEqual(
      await fixtureState(
        electronApp,
        "fixture\\.invalid/claude/a",
        "window.__sharegptLifecycleFixture",
      ),
      firstClaude,
    );

    process.stdout.write("[verify] SPA URL remains authoritative across production tab switches\n");
    await activateTab(page, "gpt", gptBId);
    const spaState = await fixtureState(
      electronApp,
      "chatgpt\\.com/gpt/b",
      `history.pushState({}, '', '/conversation/42'); ({
        fixture: window.__sharegptLifecycleFixture,
        url: location.href,
        identity: localStorage.getItem('workspace-identity:gpt-b')
      })`,
    );
    assert.match(spaState.value.url, /\/conversation\/42$/);
    await waitUntil(async () => {
      const listed = await api(page, "listAiViews", "gpt");
      return listed.tabs.find((tab) => tab.id === gptBId)?.url.endsWith("/conversation/42");
    }, "SPA state propagation");
    await activateTab(page, "gpt", gptAId);
    await activateTab(page, "gpt", gptBId);
    const spaAfterSwitch = await fixtureState(
      electronApp,
      "conversation/42",
      `({
      fixture: window.__sharegptLifecycleFixture,
      url: location.href,
      identity: localStorage.getItem('workspace-identity:gpt-b')
    })`,
    );
    assert.equal(spaAfterSwitch.webContentsId, firstGptB.webContentsId);
    assert.deepEqual(spaAfterSwitch.value.fixture, firstGptB.value);
    assert.equal(spaAfterSwitch.value.identity, "GPT-B");

    process.stdout.write("[verify] stale host payload cannot replace the active production tab\n");
    const visibleBeforeStaleHost = visibleFixture(await appSnapshot(electronApp));
    assert.equal(await syncHost(page, "gpt", gptAId), false);
    assert.deepEqual(visibleFixture(await appSnapshot(electronApp)), visibleBeforeStaleHost);

    process.stdout.write(
      "[verify] 100 rapid tab switches use the production last-intent reconciler\n",
    );
    const rapidTabResults = await page.evaluate(
      async ({ a, b }) =>
        Promise.all(
          Array.from({ length: 100 }, (_, index) =>
            window.api.switchAiView("gpt", { tabId: index % 2 === 0 ? a : b }),
          ),
        ),
      { a: gptAId, b: gptBId },
    );
    assert.equal(rapidTabResults.length, 100);
    await waitUntil(async () => {
      const listed = await api(page, "listAiViews", "gpt");
      const visible = visibleFixture(await appSnapshot(electronApp));
      return (
        listed.activeTabId === gptBId &&
        visible.length === 1 &&
        /conversation\/42/.test(visible[0].url)
      );
    }, "last rapid tab intent");

    process.stdout.write(
      "[verify] 100 GPT / Claude / ordinary intents leave only the final target\n",
    );
    await page.evaluate(async () => {
      const requests = Array.from({ length: 99 }, (_, index) =>
        window.api.setActiveAiKind(index % 3 === 0 ? "gpt" : index % 3 === 1 ? "claude" : ""),
      );
      requests.push(window.api.setActiveAiKind("claude"));
      await Promise.all(requests);
    });
    await waitUntil(async () => {
      const visible = visibleFixture(await appSnapshot(electronApp));
      return visible.length === 1 && /fixture\.invalid\/claude\/a/.test(visible[0].url);
    }, "last cross-kind intent");
    await activateKind(page, "");
    await waitUntil(
      async () => visibleFixture(await appSnapshot(electronApp)).length === 0,
      "ordinary navigation detach",
    );

    process.stdout.write("[verify] suspend and wake signals reconcile the latest logical target\n");
    await activateTab(page, "gpt", gptAId);
    await electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
    const suspendedTarget = visibleFixture(await appSnapshot(electronApp));
    assert.equal(suspendedTarget.length, 1);
    assert.match(suspendedTarget[0].url, /chatgpt\.com\/gpt\/a/);
    await activateTab(page, "claude", claudeId);
    await waitUntil(
      async () => visibleFixture(await appSnapshot(electronApp)).length === 0,
      "suspended target switch",
    );
    await electronApp.evaluate(({ powerMonitor }) => {
      powerMonitor.emit("resume");
      powerMonitor.emit("unlock-screen");
      powerMonitor.emit("user-did-become-active");
    });
    await waitUntil(async () => {
      const visible = visibleFixture(await appSnapshot(electronApp));
      return visible.length === 1 && /fixture\.invalid\/claude\/a/.test(visible[0].url);
    }, "wake reconcile");
    assert.deepEqual(
      await fixtureState(
        electronApp,
        "fixture\\.invalid/claude/a",
        "window.__sharegptLifecycleFixture",
      ),
      firstClaude,
    );

    process.stdout.write("[verify] active renderer crash is rebuilt by production appFactory\n");
    await activateTab(page, "gpt", gptBId);
    const beforeCrash = await fixtureState(
      electronApp,
      "conversation/42",
      `({
      fixture: window.__sharegptLifecycleFixture,
      identity: localStorage.getItem('workspace-identity:gpt-b'),
      url: location.href
    })`,
    );
    assert.equal(beforeCrash.value.identity, "GPT-B");
    const crashedId = await electronApp.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find(
          (candidate) =>
            !candidate.isDestroyed() && candidate.getURL().includes("/conversation/42"),
        );
      if (!contents) throw new Error("active GPT fixture webContents not found");
      const id = contents.id;
      contents.forcefullyCrashRenderer();
      return id;
    });
    assert.equal(crashedId, beforeCrash.webContentsId);
    const recovered = await waitUntil(
      async () => {
        const state = await fixtureState(
          electronApp,
          "conversation/42",
          `({
        fixture: window.__sharegptLifecycleFixture,
        identity: localStorage.getItem('workspace-identity:gpt-b'),
        url: location.href
      })`,
        );
        return state && state.webContentsId !== crashedId && state.value?.fixture?.bootId
          ? state
          : null;
      },
      "renderer crash recovery",
      20_000,
    );
    assert.equal(recovered.value.identity, "GPT-B");
    assert.match(recovered.value.url, /\/conversation\/42$/);
    assert.notEqual(recovered.value.fixture.bootId, beforeCrash.value.fixture.bootId);
    const gptAfterCrash = await api(page, "listAiViews", "gpt");
    const recoveredTab = gptAfterCrash.tabs.find((tab) => tab.id === gptBId);
    assert.equal(recoveredTab.rendererAlive, true);
    assert.ok(recoveredTab.rendererExit?.reason);
    const finalVisible = visibleFixture(await appSnapshot(electronApp));
    assert.equal(finalVisible.length, 1);
    assert.equal(finalVisible[0].id, recovered.webContentsId);

    assert.equal(
      (
        await fixtureState(
          electronApp,
          "chatgpt\\.com/gpt/a",
          "localStorage.getItem('workspace-identity:gpt-a')",
        )
      ).value,
      "GPT-A",
    );
    assert.equal(
      (
        await fixtureState(
          electronApp,
          "fixture\\.invalid/claude/a",
          "localStorage.getItem('workspace-identity:claude')",
        )
      ).value,
      "CLAUDE",
    );
    await verifyProductionComposer({
      electronApp,
      page,
      principalId: principal.principalId,
      tabId: gptAId,
    });
    await verifyConcurrentTabUsage({
      electronApp,
      page,
      principalId: principal.principalId,
      gptAId,
      gptBId,
    });

    process.stdout.write("[verify] delayed A events and usage are discarded after activating B\n");
    await clearAiEvents(page);
    const oldA = await fixtureState(
      electronApp,
      "chatgpt\\.com/composer-spa",
      `(() => {
        window.__conversationEndpoint = '/backend-api/conversation?delay=1';
        const editor = document.querySelector('#prompt-textarea');
        editor.value = 'delayed request before account switch';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return window.__composerState;
      })()`,
    );
    assert.ok(oldA?.webContentsId);
    await electronApp.evaluate(({ webContents }, id) => {
      globalThis.__shareGptStaleLifecycleContents = webContents.fromId(id);
    }, oldA.webContentsId);
    await sendTrustedEnter(electronApp, "chatgpt\\.com/composer-spa");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const principalB = await api(page, "activateSettingsPrincipal", {
      serverUrl: `http://127.0.0.1:${httpServer.address().port}`,
      username: "lifecycle-fixture-b",
    });
    await electronApp.evaluate(() => {
      globalThis.__shareGptStaleLifecycleContents?.emit(
        "did-navigate-in-page",
        {},
        "https://chatgpt.com/c/stale-from-a",
      );
      delete globalThis.__shareGptStaleLifecycleContents;
    });
    await new Promise((resolve) => setTimeout(resolve, 650));
    const leakedEvents = await page.evaluate(() => window.__lifecycleAiEvents || []);
    assert.equal(
      leakedEvents.some((event) => event?.principalId === principalB.principalId),
      false,
    );
    assert.equal(
      leakedEvents.some((event) => event?.type === "accepted-send"),
      false,
    );
    const settingsB = await api(page, "loadSettings", {
      expectedPrincipalId: principalB.principalId,
      expectedPrincipalGeneration: principalB.generation,
    });
    assert.notEqual(settingsB.gpt.last_url, "https://chatgpt.com/c/stale-from-a");
    process.stdout.write("[verify] real appFactory AI workspace lifecycle passed\n");
  } finally {
    await electronApp?.close().catch(() => undefined);
    await Promise.all([
      closeServer(socksServer),
      closeServer(httpServer),
      closeServer(httpsServer),
    ]);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
