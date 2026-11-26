const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const {
  startFixtureServers,
  startFixtureSocks,
  closeServer,
  waitUntil,
  api,
  loginThroughForm,
  ensureTab,
  fixtureState,
  waitForFixture,
  sendTrustedEnter,
  sendTrustedClick,
} = require("./verify-ai-workspace-lifecycle");
const ROOT = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const temporaryRoot = fs.mkdtempSync(path.join(ROOT, ".cache/usage-e2e-"));
// Route every production server store before requiring its entry point.
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
  process.env[name] = path.join(temporaryRoot, name + ".json");
process.env.RELEASE_STORE = path.join(temporaryRoot, "release-store");
process.env.RELEASES_DIR = path.join(temporaryRoot, "releases");
process.env.SHAREGPT_TRANSLATION_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const { server, createUserRecord } = require("../collab_server2/server");
fs.writeFileSync(
  process.env.USERS_FILE,
  JSON.stringify({
    users: [
      createUserRecord("lifecycle-fixture", "fixture-password", { isAdmin: true }),
      createUserRecord("usage-other", "fixture-password", { isAdmin: true }),
    ],
  }),
);
const requests = [];
let failures = 0;
const productionHandler = server.listeners("request")[0];
server.removeListener("request", productionHandler);
server.on("request", (req, res) => {
  const usage = req.method === "POST" && /^\/api\/(gpt|gemini|claude)\/usage$/.test(req.url);
  const record = { url: req.url, method: req.method, status: null, id: "" };
  if (usage) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      record.id = JSON.parse(body).usageId;
    });
    requests.push(record);
  }
  res.on("finish", () => {
    record.status = res.statusCode;
  });
  if (usage && failures > 0) {
    failures--;
    req.resume();
    res.writeHead(503, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    res.end("fixture temporary failure");
    return;
  }
  productionHandler(req, res);
});
const definitions = {
  gpt: { host: "chatgpt.com", endpoint: "/backend-api/conversation", label: "ChatGPT" },
  claude: {
    host: "claude.ai",
    endpoint: "/api/organizations/org/chat_conversations/chat/completion",
    label: "Claude",
  },
  gemini: {
    host: "gemini.google.com",
    endpoint: "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    label: "Gemini",
  },
};
function events(kind) {
  const file =
    kind === "gpt" ? process.env.GPT_USAGE_FILE : path.join(temporaryRoot, kind + "_usage.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).events : [];
}
const count = (kind) => events(kind).reduce((sum, e) => sum + e.count, 0);
async function main() {
  let app, socks, ai, page;
  const evidence = [];
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    ai = await startFixtureServers(temporaryRoot);
    socks = await startFixtureSocks({
      httpPort: ai.httpServer.address().port,
      httpsPort: ai.httpsServer.address().port,
    });
    const socksPort = socks.address().port;
    const launchOptions = {
      args: [ROOT, "--ignore-certificate-errors"],
      cwd: ROOT,
      env: {
        ...process.env,
        SHAREGPT_BACKGROUND_TEST: "1",
        SHAREGPT_USER_DATA: path.join(temporaryRoot, "profile"),
      },
    };
    app = await electron.launch(launchOptions);
    page = await app.firstWindow();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__usageForeground = [];
      for (const win of BrowserWindow.getAllWindows()) {
        assertHidden(win);
        for (const event of ["show", "focus"])
          win.on(event, () => globalThis.__usageForeground.push(event));
      }
      function assertHidden(win) {
        if (win.isVisible() || win.isFocused() || win.isFocusable())
          throw new Error("Must remain hidden");
      }
    });
    await loginThroughForm(page, baseUrl);
    // Use existing account preferences to expose all three ordinary AI panels.
    await page.locator('[data-tour="nav-account"]').click();
    await page.locator("#ui-show-gemini").click();
    await waitUntil(async () => {
      const snapshot = await api(page, "getSettingsPrincipal");
      return (
        await api(page, "loadSettings", {
          expectedPrincipalId: snapshot.principalId,
          expectedPrincipalGeneration: snapshot.generation,
        })
      ).ui.showGemini;
    }, "Gemini preference persisted");
    await page.evaluate(() => {
      window.__usageEvents = [];
      window.api.onAiEvent((e) => {
        if (e.type === "accepted-send") window.__usageEvents.push(e);
      });
    });
    let sequence = 0;
    async function send(
      kind,
      { mutation = "none", status = 200, click = false, delay = 0, pending = false } = {},
    ) {
      await page.locator(`[data-tour="nav-${kind}"]`).click();
      const def = definitions[kind];
      const url = `https://${def.host}/usage-fixture/${++sequence}`;
      const tab = await api(page, "createAiView", kind, { lastUrl: url });
      await ensureTab(page, { kind, tabId: tab.activeTabId, url, socksPort });
      const pattern = def.host.replaceAll(".", "\\.") + "/usage-fixture/" + sequence + "$";
      await waitForFixture(app, pattern, "AI fixture loaded");
      await fixtureState(
        app,
        pattern,
        `(() => {
    window.__conversationEndpoint=${JSON.stringify(def.endpoint + "?status=" + status + "&delayMs=" + delay)};
    const editor=document.querySelector('#prompt-textarea');
    editor.value='synthetic question';editor.focus();
    document.querySelector('#composer').addEventListener('submit',()=>{
      if(${JSON.stringify(mutation)}==='remove')editor.remove();
      if(${JSON.stringify(mutation)}==='hide')editor.style.display='none';
    });return true;
   })()`,
      );
      const before = count(kind);
      if (click) await sendTrustedClick(app, pattern);
      else await sendTrustedEnter(app, pattern);
      if (pending) {
        await waitUntil(
          async () =>
            (await fixtureState(app, pattern, "window.__composerState.requests"))?.value === 1,
          "pending AI request started",
        );
        return;
      }
      await waitUntil(
        async () =>
          (await fixtureState(app, pattern, "window.__composerState.responseStatuses.length"))
            ?.value === 1,
        "AI response finished",
      );
      if (status === 200)
        await waitUntil(() => count(kind) === before + 1, `${kind} full-chain persisted increment`);
      else {
        await page.waitForTimeout(400);
        assert.equal(count(kind), before);
      }
      evidence.push({ kind, mutation, status, click, before, after: count(kind) });
      return tab.activeTabId;
    }
    async function assertUi(kind) {
      await page.locator('[data-tour="nav-stats"]').click();
      await page.getByRole("button", { name: definitions[kind].label, exact: true }).click();
      const total = page
        .locator('[data-slot="card"]')
        .filter({ hasText: "总查询数" })
        .locator(".tabular-nums");
      await waitUntil(
        async () => (await total.innerText()) === String(count(kind)),
        `${kind} visible statistics total`,
      );
      evidence.push({ kind, ui: Number(await total.innerText()), disk: count(kind) });
    }
    for (const kind of Object.keys(definitions)) {
      process.stdout.write(`[verify] ${kind}: real sends, persisted counts and statistics UI\n`);
      for (const mutation of ["none", "remove", "hide"])
        await send(kind, { mutation, click: mutation === "hide" });
      await send(kind, { status: 500 });
      await assertUi(kind);
    }
    // Actual reporting retry must keep the same usageId and persist only one event.
    process.stdout.write("[verify] retry and duplicate reporting\n");
    failures = 1;
    const requestStart = requests.length;
    await send("gpt");
    const retried = requests.slice(requestStart).filter((r) => r.method === "POST");
    assert.equal(retried.length, 2);
    assert.equal(retried[0].status, 503);
    assert.equal(retried[1].status, 200);
    assert.equal(retried[0].id, retried[1].id);
    assert.ok(retried[0].id);
    const latest = await page.evaluate(() => window.__usageEvents.at(-1));
    const beforeDuplicate = count("gpt");
    await app.evaluate(
      ({ BrowserWindow }, event) =>
        BrowserWindow.getAllWindows()[0].webContents.send("ai:event", event),
      latest,
    );
    await page.waitForTimeout(400);
    assert.equal(count("gpt"), beforeDuplicate);
    await assertUi("gpt");
    async function switchAccount(username) {
      await page.locator('[data-tour="nav-account"]').click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await loginThroughForm(page, baseUrl, { username, expectTour: false });
    }
    process.stdout.write("[verify] A/B/A and stale in-flight completion\n");
    const beforeSwitch = count("gpt");
    await send("gpt", { delay: 4000, pending: true });
    await switchAccount("usage-other");
    await app.evaluate(
      ({ BrowserWindow }, event) =>
        BrowserWindow.getAllWindows()[0].webContents.send("ai:event", event),
      latest,
    );
    await page.waitForTimeout(4200);
    assert.equal(
      count("gpt"),
      beforeSwitch,
      "old pending response and old-account event must not count for B",
    );
    await send("gpt");
    assert.equal(events("gpt").filter((e) => e.username === "usage-other").length, 1);
    await assertUi("gpt");
    await switchAccount("lifecycle-fixture");
    await send("gpt");
    assert.equal(events("gpt").filter((e) => e.username === "usage-other").length, 1);
    await assertUi("gpt");
    evidence.push({ accountSwitch: "A/B/A", oldPendingDiscarded: true, otherAccountEvents: 1 });
    assert.deepEqual(await app.evaluate(() => globalThis.__usageForeground), []);
    process.stdout.write("[verify] restart and statistics readback\n");
    const beforeRestart = Object.fromEntries(Object.keys(definitions).map((k) => [k, count(k)]));
    await app.close();
    app = await electron.launch(launchOptions);
    page = await app.firstWindow();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__usageForeground = [];
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isVisible() || win.isFocusable() || win.isFocused())
          throw new Error("Restart must remain hidden");
        for (const event of ["show", "focus"])
          win.on(event, () => globalThis.__usageForeground.push(event));
      }
    });
    await loginThroughForm(page, baseUrl, { expectTour: false });
    for (const kind of Object.keys(definitions)) await assertUi(kind);
    assert.deepEqual(
      Object.fromEntries(Object.keys(definitions).map((k) => [k, count(k)])),
      beforeRestart,
    );
    evidence.push({ restartRetained: true, counts: beforeRestart });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await app.evaluate(() => globalThis.__usageForeground), []);
    fs.writeFileSync(
      path.join(temporaryRoot, "result.json"),
      JSON.stringify({ evidence, requests, foreground: [], retryDeduplicated: true }, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: true,
        temporaryRoot,
        counts: Object.fromEntries(Object.keys(definitions).map((k) => [k, count(k)])),
        evidence,
        requests,
      }),
    );
  } catch (error) {
    if (page && !page.isClosed())
      fs.writeFileSync(
        path.join(temporaryRoot, "failure-ui.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "unavailable"),
      );
    console.error("Evidence directory:", temporaryRoot);
    console.error(
      JSON.stringify({
        requests,
        counts: Object.fromEntries(Object.keys(definitions).map((k) => [k, count(k)])),
      }),
    );
    throw error;
  } finally {
    await app?.close().catch(() => {});
    await Promise.all([
      closeServer(socks),
      closeServer(ai?.httpServer),
      closeServer(ai?.httpsServer),
      closeServer(server),
    ]);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
