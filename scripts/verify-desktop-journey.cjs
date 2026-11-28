const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { _electron, expect } = require("playwright/test");
const { dismissFirstRunGuides } = require("./lib/dismiss-first-run-guides.cjs");

const root = path.resolve(__dirname, "..");
const visible = process.argv.includes("--cloud-visible");
const performanceTrace = process.argv.includes("--performance");
if (
  visible &&
  (process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    !process.env.RUNNER_TEMP)
)
  throw new Error("Visible journeys require a disposable GitHub-hosted runner");
const runs = path.join(root, ".cache/desktop-journey");
fs.mkdirSync(runs, { recursive: true });
const run = fs.mkdtempSync(path.join(runs, "run-"));
const evidence = path.join(run, "evidence");
fs.mkdirSync(evidence);
// Isolate every server store before loading the real server implementation.
for (const key of [
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
  "INVITES_FILE",
])
  process.env[key] = path.join(run, key + ".json");
process.env.RELEASE_STORE = path.join(run, "releases");
process.env.DEV_TOKEN = "";
const { server, createUserRecord } = require("../collab_server2/server");
const password = "synthetic-journey-password";
fs.writeFileSync(
  process.env.USERS_FILE,
  JSON.stringify({
    users: [
      createUserRecord("journey-admin", password, { isAdmin: true }),
      createUserRecord("journey-member", password),
    ],
  }),
);
const result = {
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  platform: process.platform,
  arch: process.arch,
  visible,
  performanceTrace,
  steps: [],
  errors: [],
  sessions: [],
  limitations: [
    "Synthetic accounts and loopback server",
    "No real AI websites or installed package",
    "rAF timing is not physical display latency",
    "Review screenshots and traces even when assertions pass",
  ],
};
let app,
  page,
  base,
  tracing = false;
let session = 0;
let traceSession;
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function launch() {
  session++;
  const env = {
    ...process.env,
    SHAREGPT_USER_DATA: path.join(run, "profile"),
    SHAREGPT_BACKGROUND_TEST: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
  await app.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["file:", "data:"].includes(url.protocol) || url.hostname === "127.0.0.1"
      ? route.continue()
      : route.abort();
  });
  if (!performanceTrace)
    await app.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.evaluate(() => {
    window.journeyMetrics = { clicks: [], longTasks: [] };
    new PerformanceObserver((list) => {
      for (const task of list.getEntries())
        window.journeyMetrics.longTasks.push({ at: task.startTime, ms: task.duration });
    }).observe({ type: "longtask" });
    document.addEventListener(
      "click",
      (event) => {
        const at = performance.now();
        const item = { at, dispatchMs: at - event.timeStamp };
        window.journeyMetrics.clicks.push(item);
        requestAnimationFrame(() => {
          item.firstRafMs = performance.now() - at;
        });
      },
      true,
    );
  });
  await app.evaluate(
    async ({ BrowserWindow, app }, { show }) => {
      globalThis.journeyWindowEvents = [];
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isVisible()) throw new Error("Journey startup was not isolated and hidden");
        for (const event of ["show", "focus"])
          win.on(event, () => globalThis.journeyWindowEvents.push(event));
      }
      if (show) {
        if (process.platform === "darwin") app.setActivationPolicy("regular");
        const win = BrowserWindow.getAllWindows()[0];
        win.setFocusable(true);
        win.show();
        win.focus();
      }
    },
    { show: visible, performanceTrace },
  );
  if (performanceTrace) {
    traceSession = await app.context().newCDPSession(page);
    await traceSession.send("Tracing.start", {
      categories: "devtools.timeline,v8.execute,blink.user_timing",
      transferMode: "ReturnAsStream",
    });
  }
  tracing = performanceTrace;
}
async function close() {
  if (!app) return;
  const current = app;
  try {
    result.sessions.push(await page.evaluate(() => window.journeyMetrics));
    const events = await app.evaluate(() => globalThis.journeyWindowEvents);
    if (!visible) assert.deepEqual(events, [], "Local journey must remain hidden");
    if (!performanceTrace)
      await bounded(
        app.context().tracing.stop({ path: path.join(evidence, `actions-${session}.zip`) }),
        "Action trace export",
      );
    if (tracing) {
      await bounded(
        (async () => {
          const complete = new Promise((resolve) =>
            traceSession.once("Tracing.tracingComplete", resolve),
          );
          await traceSession.send("Tracing.end");
          const { stream } = await complete;
          const chunks = [];
          for (;;) {
            const chunk = await traceSession.send("IO.read", { handle: stream });
            chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
            if (chunk.eof) break;
          }
          await traceSession.send("IO.close", { handle: stream });
          fs.writeFileSync(path.join(evidence, `chromium-${session}.json`), Buffer.concat(chunks));
        })(),
        "Chromium trace export",
      );
    }
  } finally {
    tracing = false;
    app = null;
    await bounded(current.close(), "Application close").catch(() => current.process().kill());
  }
}
async function step(name, action) {
  const entry = { name, status: "running" };
  console.log(`Journey: ${name}`);
  result.steps.push(entry);
  const started = performance.now();
  try {
    await action();
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    throw error;
  } finally {
    entry.elapsedMs = performance.now() - started;
    if (!performanceTrace && page && !page.isClosed())
      await page
        .screenshot({
          path: path.join(evidence, `${String(result.steps.length).padStart(2, "0")}-${name}.png`),
          animations: "disabled",
        })
        .catch((error) => {
          entry.evidenceFailure = String(error);
          if (entry.status === "passed") {
            entry.status = "failed";
            throw error;
          }
        });
  }
}
const nav = (key) => page.locator(`[data-tour="nav-${key}"]`);
async function login(username) {
  const start = page.getByRole("button", { name: "开始设置", exact: true });
  if (await start.isVisible()) await start.click();
  const team = page.getByRole("button", { name: /连接团队/ });
  if (await team.isVisible()) await team.click();
  await page.locator("#account-server").fill(base);
  await page.locator("#account-username").fill(username);
  await page.locator("#account-password").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await nav("account").waitFor();
  await dismissFirstRunGuides(page, nav("account"));
}
async function settings() {
  await nav("account").click();
  await page.getByRole("tab", { name: /界面与通知/ }).click();
  await expect(page.getByRole("switch", { name: "消息弹窗", exact: true })).toBeVisible();
}
async function logout() {
  await nav("account").click();
  await page.getByRole("tab", { name: /账户与权限/ }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: /连接团队/ }).waitFor();
}
async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await launch();
  await step("admin-login", async () => {
    await page.getByRole("button", { name: "开始设置", exact: true }).waitFor();
    await login("journey-admin");
  });
  await step("settings-categories", async () => {
    await nav("account").click();
    for (const name of [
      "账户与权限",
      "界面与通知",
      "隐私与环境",
      "本机资料",
      "更新与反馈",
      "全部设置",
    ]) {
      const tab = page.getByRole("tab", { name: new RegExp(name) });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  });
  await step("save-notification", async () => {
    await settings();
    const toggle = page.getByRole("switch", { name: "消息弹窗", exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toBeEnabled();
  });
  await step("navigation-and-admin", async () => {
    for (const key of ["service", "chat", "account", "admin"]) await nav(key).click();
    await expect(page.getByText("团队总成员", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "成员与权限", exact: true }).click();
    await expect(page.getByText("journey-member", { exact: true }).first()).toBeVisible();
    await nav("account").click();
    await nav("admin").click();
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await expect(page.getByText("团队总成员", { exact: true })).toBeVisible();
    await expect(page.locator("#admin-verify-pwd")).toHaveCount(0);
  });
  await step("restart", async () => {
    await close();
    await launch();
  });
  await step("saved-setting-after-restart", async () => {
    // Password retention is off by default; reconnect explicitly after restart.
    await page.getByRole("button", { name: /连接团队/ }).waitFor();
    await login("journey-admin");
    await settings();
    await expect(page.getByRole("switch", { name: "消息弹窗", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
  await step("member-permissions-and-isolation", async () => {
    await logout();
    await login("journey-member");
    await expect(nav("admin")).toHaveCount(0);
    await settings();
    await expect(page.getByRole("switch", { name: "消息弹窗", exact: true })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
  await step("return-to-admin", async () => {
    await logout();
    await login("journey-admin");
    await settings();
    await expect(nav("admin")).toBeVisible();
    await expect(page.getByRole("switch", { name: "消息弹窗", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
  assert.deepEqual(result.errors, []);
}
main()
  .catch((error) => {
    console.error(error);
    result.failure = error.stack;
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await close();
    } catch (error) {
      result.cleanupFailure = String(error);
      process.exitCode = 1;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    result.performanceReview = visible
      ? "Review long tasks and Chromium traces; no physical-display claim"
      : "Hidden window: frame timings are not representative";
    fs.writeFileSync(path.join(evidence, "result.json"), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify(
        {
          evidence,
          steps: result.steps,
          failure: result.failure,
          performanceReview: result.performanceReview,
        },
        null,
        2,
      ),
    );
  });
