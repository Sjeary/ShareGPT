const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function verifyDefaultDevelopment() {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-dev-entry-")));
  const appData = path.join(fixture, "app-data");
  const installed = path.join(appData, "ShareGPT");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, "settings.json"), "installed-profile-sentinel");
  const entry = path.join(fixture, "entry.cjs");
  // Isolate the OS application-data root before loading the real package entry.
  // Do not set SHAREGPT_USER_DATA: this exercises the default development path.
  fs.writeFileSync(
    entry,
    `
    const { app } = require("electron");
    app.setPath("appData", ${JSON.stringify(appData)});
    app.setPath("userData", ${JSON.stringify(installed)});
    app.setAppPath(${JSON.stringify(fixture)});
    globalThis.__foregroundEvents = [];
    app.on("browser-window-focus", () => globalThis.__foregroundEvents.push("focus"));
    app.on("browser-window-created", (_event, window) => {
      window.on("show", () => globalThis.__foregroundEvents.push("show"));
    });
    require(${JSON.stringify(path.join(ROOT, require("../package.json").main))});
  `,
  );
  const env = { ...process.env, SHAREGPT_BACKGROUND_TEST: "1" };
  delete env.SHAREGPT_USER_DATA;
  const profile = path.join(fixture, ".cache", "user-data");
  try {
    for (const restart of [false, true]) {
      const instance = await electron.launch({ args: [entry], cwd: ROOT, env });
      try {
        const page = await instance.firstWindow();
        await page.getByText("欢迎来到 ShareGPT", { exact: true }).waitFor({ state: "visible" });
        const paths = await page.evaluate(() => window.api.getPaths());
        assert.equal(paths.userDataDir, profile);
        assert.equal(paths.updateBackupsDir, path.join(profile, "ShareGPT Backups"));
        assert.equal(paths.updatesDir, path.join(profile, "ShareGPT Updates"));
        assert.equal(paths.frpc, "");
        assert.equal((await page.evaluate(() => window.api.getAppMeta())).mode, "sender");
        assert.equal(await instance.evaluate(({ app }) => app.getPath("sessionData")), profile);
        await page.evaluate(() => window.api.openProfileEditor({}));
        await page.evaluate(() => window.api.openProfileEditor({}));
        assert.equal(
          await page.evaluate(() => window.api.showSystemNotification({ title: "fixture" })),
          false,
        );
        assert.deepEqual(await instance.evaluate(() => globalThis.__foregroundEvents), []);
        assert.equal(
          await instance.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some(
              (window) => window.isVisible() || window.isFocused() || window.isFocusable(),
            ),
          ),
          false,
        );
        await assert.rejects(
          page.evaluate(() => window.api.startReceiver({})),
          /不支持 receiver/,
        );
        if (restart) {
          assert.equal(await page.evaluate(() => localStorage.getItem("dev-restart")), "keep");
        } else {
          await page.evaluate(() => localStorage.setItem("dev-restart", "keep"));
        }
      } finally {
        await instance.close();
      }
    }
    assert.equal(
      fs.readFileSync(path.join(installed, "settings.json"), "utf8"),
      "installed-profile-sentinel",
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

async function main() {
  await verifyDefaultDevelopment();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-startup-recovery-"));
  const settingsFile = path.join(profile, "settings.json");
  const invalid = '{"interrupted":';
  fs.writeFileSync(settingsFile, invalid);
  fs.writeFileSync(path.join(profile, "preserved-marker.txt"), "keep");
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, SHAREGPT_USER_DATA: profile, SHAREGPT_BACKGROUND_TEST: "1" },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const retry = page.getByRole("button", { name: "重新尝试", exact: true });
    await retry.waitFor({ state: "visible" });
    assert.match(await page.getByRole("alert").innerText(), /settings\.json/);
    assert.equal(fs.readFileSync(settingsFile, "utf8"), invalid);
    let loads = 0;
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("settings:principal-context");
      globalThis.__startupRecoveryLoads = 0;
      ipcMain.removeHandler("settings:principal-context");
      ipcMain.handle("settings:principal-context", (...args) => {
        globalThis.__startupRecoveryLoads++;
        return original(...args);
      });
    });
    await retry.click();
    await retry.waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    loads = await app.evaluate(() => globalThis.__startupRecoveryLoads);
    assert.equal(loads, 1, "failure remains stopped until another manual retry");
    assert.equal(fs.readFileSync(settingsFile, "utf8"), invalid);
    fs.writeFileSync(settingsFile, JSON.stringify({ ui: { workspace_entry_intro_done: false } }));
    await retry.click();
    await page.getByText("欢迎来到 ShareGPT", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await retry.count(), 0);
    assert.equal(fs.readFileSync(path.join(profile, "preserved-marker.txt"), "utf8"), "keep");
    assert.deepEqual(errors, []);
    process.stdout.write(
      `${JSON.stringify({ ok: true, defaultClientEntry: true, defaultProfileIsolated: true, backgroundWindows: true, restartPreserved: true, corruptSettingsPreserved: true, explicitRetryRecovered: true, rendererErrors: errors })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
