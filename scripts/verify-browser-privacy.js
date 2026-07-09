const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os");
const { app, BrowserWindow, session } = require("electron");
const { applyEnvironmentToWebContents, clearAiSessionData } = require("../src/main/browserPrivacy");

// 开发者自测：只访问 127.0.0.1，不打开 ChatGPT/Gemini/Claude，也不触发第三方风控。
// 验证真实 Chromium 中的时区、语言、地理位置、WebRTC 策略，以及清理后的各类网站存储。

function startFixtureServer() {
  let lastHeaders = {};
  const server = http.createServer((req, res) => {
    if (req.url === "/sw.js") {
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      res.end("self.addEventListener('fetch', () => {});");
      return;
    }
    lastHeaders = { ...req.headers };
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      "<!doctype html><meta charset='utf-8'><title>privacy verifier</title><p>local only</p>",
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
        headers: () => lastHeaders,
      });
    });
  });
}

function privateIpv4Addresses() {
  const values = [];
  for (const records of Object.values(os.networkInterfaces())) {
    for (const item of records || []) {
      if (item && item.family === "IPv4" && !item.internal) values.push(item.address);
    }
  }
  return values;
}

function withTimeout(promise, label, timeoutMs = 10_000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

async function inspectPage(webContents) {
  return webContents.executeJavaScript(`
    (async () => {
      const geo = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 5000);
        navigator.geolocation.getCurrentPosition(
          (position) => {
            clearTimeout(timer);
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            });
          },
          (error) => {
            clearTimeout(timer);
            resolve({ error: error.message || String(error.code) });
          },
        );
      });
      const candidates = [];
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('verify');
        pc.onicecandidate = (event) => {
          if (event.candidate?.candidate) candidates.push(event.candidate.candidate);
        };
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((resolve) => setTimeout(resolve, 1200));
        pc.close();
      } catch {}
      return {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        languages: navigator.languages,
        userAgent: navigator.userAgent,
        geo,
        candidates,
        cookie: document.cookie,
        localStorage: localStorage.getItem('privacy-verifier'),
        indexedDb: typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).map((item) => item.name).filter(Boolean)
          : [],
        caches: await caches.keys(),
        serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
      };
    })()
  `);
}

async function seedStorage(webContents) {
  await webContents.executeJavaScript(`
    (async () => {
      document.cookie = 'privacy-verifier=1; SameSite=Lax';
      localStorage.setItem('privacy-verifier', 'present');
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('privacy-verifier', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('items');
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
      const cache = await caches.open('privacy-verifier');
      await cache.put('/cached', new Response('cached'));
      const registration = await navigator.serviceWorker.register('/sw.js');
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 5000)),
      ]);
      await registration.update();
      return true;
    })()
  `);
}

async function createVerifierWindow(partition, targetSession, fixtureUrl) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  process.stdout.write("[verify] apply CDP environment overrides\n");
  await withTimeout(
    applyEnvironmentToWebContents({
      webContents: window.webContents,
      targetSession,
      privacySettings: {
        environment: {
          mode: "proxy",
          locale: "en-US",
          acceptLanguages: "en-US,en",
          timezone: "America/Los_Angeles",
          geolocationMode: "proxy",
          latitude: 34.0522,
          longitude: -118.2437,
          accuracy: 50000,
          sourceUpdatedAt: new Date().toISOString(),
        },
      },
      defaultUserAgent: app.userAgentFallback || targetSession.getUserAgent(),
      systemLanguages: app.getPreferredSystemLanguages(),
    }),
    "apply environment",
  );
  process.stdout.write("[verify] load local fixture\n");
  await withTimeout(window.loadURL(fixtureUrl), "load local fixture");
  return window;
}

async function main() {
  await app.whenReady();
  // 保留一个与目标分区无关的隐藏窗口，避免关闭测试视图后 Electron 自动退出。
  const keeperWindow = new BrowserWindow({ show: false });
  const fixture = await startFixtureServer();
  const partition = `browser-privacy-verifier-${Date.now()}`;
  const targetSession = session.fromPartition(partition, { cache: true });
  let allowGeolocation = true;
  targetSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "geolocation" && allowGeolocation);
  });
  targetSession.setPermissionCheckHandler(
    (_contents, permission) => permission === "geolocation" && allowGeolocation,
  );

  let firstWindow;
  let secondWindow;
  let controlWindow;
  try {
    process.stdout.write("[verify] create local Chromium view\n");
    firstWindow = await withTimeout(
      createVerifierWindow(partition, targetSession, fixture.url),
      "create verifier window",
    );
    process.stdout.write("[verify] seed isolated browser storage\n");
    await withTimeout(seedStorage(firstWindow.webContents), "seed browser storage");
    process.stdout.write("[verify] inspect environment and storage\n");
    const before = await withTimeout(inspectPage(firstWindow.webContents), "inspect environment");
    const webRtcPolicy = firstWindow.webContents.getWebRTCIPHandlingPolicy();
    const headers = fixture.headers();
    const localIps = privateIpv4Addresses();

    assert.strictEqual(before.timezone, "America/Los_Angeles");
    assert.strictEqual(before.language, "en-US");
    assert.match(String(headers["accept-language"] || ""), /^en-US/);
    assert.strictEqual(before.geo.latitude, 34.0522);
    assert.strictEqual(before.geo.longitude, -118.2437);
    assert.strictEqual(webRtcPolicy, "disable_non_proxied_udp");
    for (const candidate of before.candidates) {
      for (const ip of localIps) {
        assert.ok(!candidate.includes(ip), `WebRTC candidate leaked local IP ${ip}`);
      }
    }
    assert.match(before.cookie, /privacy-verifier=1/);
    assert.strictEqual(before.localStorage, "present");
    assert.ok(before.indexedDb.includes("privacy-verifier"));
    assert.ok(before.caches.includes("privacy-verifier"));
    assert.ok(before.serviceWorkers >= 1);

    // 第二个非持久分区充当“另一个 AI 服务”，证明清理目标分区不会串到其它服务。
    const controlPartition = `browser-privacy-control-${Date.now()}`;
    const controlSession = session.fromPartition(controlPartition, { cache: true });
    controlSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    controlSession.setPermissionCheckHandler(() => false);
    controlWindow = await createVerifierWindow(controlPartition, controlSession, fixture.url);
    await seedStorage(controlWindow.webContents);

    const firstWebContents = firstWindow.webContents;
    const destroyed = new Promise((resolve) => firstWebContents.once("destroyed", resolve));
    firstWindow.close();
    await withTimeout(destroyed, "destroy first verifier window");
    firstWindow = null;
    process.stdout.write("[verify] clear session data\n");
    await withTimeout(
      clearAiSessionData(targetSession, {
        onStep: (step) => process.stdout.write(`[verify] clear step: ${step}\n`),
      }),
      "clear session data",
      20_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    process.stdout.write("[verify] reopen and verify deletion\n");
    secondWindow = await withTimeout(
      createVerifierWindow(partition, targetSession, fixture.url),
      "recreate verifier window",
    );
    const after = await withTimeout(inspectPage(secondWindow.webContents), "inspect cleared data");
    assert.strictEqual(after.cookie, "");
    assert.strictEqual(after.localStorage, null);
    assert.ok(!after.indexedDb.includes("privacy-verifier"));
    assert.ok(!after.caches.includes("privacy-verifier"));
    assert.strictEqual(after.serviceWorkers, 0);

    const controlAfter = await withTimeout(
      inspectPage(controlWindow.webContents),
      "inspect untouched control partition",
    );
    assert.match(controlAfter.cookie, /privacy-verifier=1/);
    assert.strictEqual(controlAfter.localStorage, "present");
    assert.ok(controlAfter.indexedDb.includes("privacy-verifier"));

    // 用户选择“不提供地理位置”时，权限层必须直接拒绝，不能回落到真实系统位置。
    allowGeolocation = false;
    await applyEnvironmentToWebContents({
      webContents: secondWindow.webContents,
      targetSession,
      privacySettings: {
        environment: {
          mode: "system",
          locale: "en-US",
          acceptLanguages: "en-US,en",
          timezone: "America/Los_Angeles",
          geolocationMode: "disabled",
        },
      },
      defaultUserAgent: app.userAgentFallback || targetSession.getUserAgent(),
      systemLanguages: app.getPreferredSystemLanguages(),
    });
    const withoutGeolocation = await withTimeout(
      inspectPage(secondWindow.webContents),
      "inspect disabled geolocation",
    );
    assert.ok(withoutGeolocation.geo.error, "禁用后不应返回任何地理位置");
    assert.strictEqual(
      withoutGeolocation.timezone,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "跟随系统时应清除先前的时区覆盖",
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          fixture: "127.0.0.1 only",
          environment: {
            timezone: before.timezone,
            language: before.language,
            acceptLanguage: headers["accept-language"],
            geolocation: before.geo,
            webRtcPolicy,
            leakedLocalIp: false,
          },
          cleared: {
            cookies: true,
            localStorage: true,
            indexedDB: true,
            cacheStorage: true,
            serviceWorkers: true,
            otherPartitionUntouched: true,
          },
          geolocationDisabled: true,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (firstWindow && !firstWindow.isDestroyed()) firstWindow.close();
    if (secondWindow && !secondWindow.isDestroyed()) secondWindow.close();
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.close();
    if (!keeperWindow.isDestroyed()) keeperWindow.close();
    fixture.server.closeAllConnections?.();
    await new Promise((resolve) => fixture.server.close(resolve));
    app.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
