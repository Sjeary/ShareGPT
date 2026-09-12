const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function main() {
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
      `${JSON.stringify({ ok: true, corruptSettingsPreserved: true, explicitRetryRecovered: true, rendererErrors: errors })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
