const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { _electron: electron } = require("playwright");

// UI 集成自测：启动临时协作服务器和隔离的 Electron 用户目录，所有允许的网络请求都只能
// 指向 127.0.0.1。测试不会创建 AI 网页标签，因此不会访问 ChatGPT、Gemini 或 Claude。

const ROOT = path.resolve(__dirname, "..");
const USERNAME = "privacy-ui-verifier";
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

function makeUserStore() {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 120000;
  return {
    users: [
      {
        username: USERNAME,
        displayName: "Privacy UI Verifier",
        salt,
        passwordHash: crypto.pbkdf2Sync(PASSWORD, salt, iterations, 32, "sha256").toString("hex"),
        iterations,
        digest: "sha256",
        disabled: false,
        isAdmin: false,
      },
    ],
  };
}

async function waitForHealth(baseUrl, child, output, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`local collaboration server exited early\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may not have bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`local collaboration server did not become healthy\n${output.join("")}`);
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

async function waitForSyncedPrivacy(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const store = JSON.parse(fs.readFileSync(file, "utf8"));
      const data = store?.stores?.[USERNAME]?.["browser-privacy"]?.data;
      if (data?.environment) return data;
    } catch {
      // The first cloud-sync write may still be in flight.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("browser privacy settings were not synced to the local test server");
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-privacy-ui-"));
  const userDataDir = path.join(tempDir, "user-data");
  const screenshotPath = path.join(tempDir, "browser-privacy-account.png");
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const usersFile = path.join(tempDir, "users.json");
  fs.writeFileSync(usersFile, JSON.stringify(makeUserStore(), null, 2), "utf8");

  const serverOutput = [];
  const collab = spawn(process.execPath, [path.join(ROOT, "collab_server2/server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      USERS_FILE: usersFile,
      GPT_USAGE_FILE: path.join(tempDir, "gpt_usage.json"),
      CHAT_HISTORY_FILE: path.join(tempDir, "chat_history.json"),
      CLIENT_BOOTSTRAP_FILE: path.join(tempDir, "client_bootstrap.json"),
      CALENDARS_FILE: path.join(tempDir, "calendars.json"),
      USER_STORES_FILE: path.join(tempDir, "user_stores.json"),
      FOCUS_FILE: path.join(tempDir, "focus_stats.json"),
      RELEASES_DIR: path.join(tempDir, "releases"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  collab.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  collab.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  let electronApp;
  try {
    await waitForHealth(baseUrl, collab, serverOutput);
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: {
        ...process.env,
        SHAREGPT_USER_DATA: userDataDir,
      },
    });

    const blockedRequests = [];
    await electronApp.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const localHttp =
        (url.protocol === "http:" || url.protocol === "ws:") && url.hostname === "127.0.0.1";
      if (url.protocol === "file:" || url.protocol === "data:" || localHttp) {
        await route.continue();
        return;
      }
      blockedRequests.push(url.toString());
      await route.abort("blockedbyclient");
    });

    const window = await electronApp.firstWindow();
    const pageErrors = [];
    window.on("pageerror", (error) => pageErrors.push(error.message));
    await window.locator("#account-server").waitFor({ state: "visible" });
    await window.locator("#account-server").fill(baseUrl);
    await window.locator("#account-username").fill(USERNAME);
    await window.locator("#account-password").fill(PASSWORD);
    await window.getByRole("button", { name: "登录", exact: true }).click();
    await window.getByRole("button", { name: /账户/ }).waitFor({ state: "visible" });
    const skipTour = window.getByRole("button", { name: "跳过", exact: true });
    if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
    await window.getByRole("button", { name: /账户/ }).click();
    await window.getByText("网页隐私与环境", { exact: true }).waitFor({ state: "visible" });

    const providerClearButtons = window.getByRole("button", { name: "清除", exact: true });
    assert.strictEqual(
      await providerClearButtons.count(),
      3,
      "must expose one clear action per provider",
    );
    const providerRebuildButtons = window.getByRole("button", {
      name: "重建资料环境",
      exact: true,
    });
    assert.strictEqual(
      await providerRebuildButtons.count(),
      3,
      "must expose one profile rebuild action per provider",
    );
    await window.getByText("稳定指纹标准化", { exact: true }).waitFor({ state: "visible" });
    await window.getByText("网页可见信息表盘", { exact: true }).waitFor({ state: "attached" });
    assert.strictEqual(
      await window.getByRole("button", { name: /全部.*清除|清除.*全部/ }).count(),
      0,
      "must not expose a clear-all action",
    );
    await window.locator("#browser-environment-mode").selectOption("us");
    await window.locator("#browser-us-timezone").selectOption("America/Los_Angeles");
    await window.locator("#browser-environment-mode").selectOption("system");

    const claudeRow = window
      .getByText("只清除 Claude 网页分区", { exact: false })
      .locator("..")
      .locator("..");
    assert.match((await claudeRow.textContent()) || "", /从未清除/);
    await claudeRow.getByRole("button", { name: "清除", exact: true }).click();
    const dialog = window.getByRole("dialog");
    await dialog.getByText("清除 Claude 网页数据", { exact: true }).waitFor();
    await dialog.locator("#browser-clear-password").fill("wrong-password");
    await dialog.getByRole("button", { name: "验证密码并清除", exact: true }).click();
    await window.waitForTimeout(1000);
    const wrongPasswordToasts = await window.locator("[data-sonner-toast]").allTextContents();
    assert.ok(
      wrongPasswordToasts.some((text) => text.includes("密码错误")),
      `wrong password was not rejected as expected; toasts=${JSON.stringify(wrongPasswordToasts)}; server=${serverOutput.join("")}`,
    );
    assert.match((await claudeRow.textContent()) || "", /从未清除/);

    await dialog.locator("#browser-clear-password").fill(PASSWORD);
    await dialog.getByRole("button", { name: "验证密码并清除", exact: true }).click();
    await window.getByText(/Claude 的 Cookie、登录状态和本地网页记录已清除/).waitFor();
    await dialog.waitFor({ state: "hidden" });
    assert.doesNotMatch((await claudeRow.textContent()) || "", /从未清除/);

    await claudeRow.getByRole("button", { name: "重建资料环境", exact: true }).click();
    await dialog.getByText("重建 Claude 浏览器资料环境", { exact: true }).waitFor();
    await dialog.locator("#browser-clear-password").fill(PASSWORD);
    await dialog.getByRole("button", { name: "验证密码并重建", exact: true }).click();
    await window.getByText(/Claude 已切换到全新的浏览器资料环境/).waitFor();
    await dialog.waitFor({ state: "hidden" });

    const syncedPrivacy = await waitForSyncedPrivacy(path.join(tempDir, "user_stores.json"));
    const localOnlyFields = [
      "sourceIp",
      "sourceUpdatedAt",
      "latitude",
      "longitude",
      "accuracy",
      "countryCode",
      "country",
      "region",
      "city",
    ];
    for (const field of localOnlyFields) {
      assert.strictEqual(
        Object.hasOwn(syncedPrivacy.environment, field),
        false,
        `${field} must stay on the device`,
      );
    }
    assert.strictEqual(Object.hasOwn(syncedPrivacy, "lastClearedAt"), false);
    assert.strictEqual(typeof syncedPrivacy.fingerprint, "object");
    assert.strictEqual(Object.hasOwn(syncedPrivacy, "localProfiles"), false);
    assert.strictEqual(Object.hasOwn(syncedPrivacy, "audit"), false);

    await window.screenshot({ path: screenshotPath, fullPage: true });
    assert.deepStrictEqual(pageErrors, [], `renderer page errors: ${pageErrors.join("; ")}`);
    assert.ok(
      blockedRequests.every((url) => !/claude\.ai|chatgpt\.com|gemini\.google\.com/i.test(url)),
      `an AI website was requested: ${blockedRequests.join(", ")}`,
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          version: "1.0.6",
          fixture: baseUrl,
          providerClearActions: 3,
          providerProfileRebuildActions: 3,
          clearAllAction: false,
          wrongPasswordRejected: true,
          correctPasswordClearedClaudePartition: true,
          correctPasswordRebuiltClaudeProfile: true,
          fingerprintDashboardPresent: true,
          fingerprintPolicySynced: true,
          fingerprintSnapshotsSynced: false,
          syncedNodeDetectionFields: false,
          aiWebsitesVisited: false,
          blockedNonLocalRequests: blockedRequests.length,
          screenshot: screenshotPath,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (electronApp) await electronApp.close().catch(() => {});
    await stopChild(collab);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
