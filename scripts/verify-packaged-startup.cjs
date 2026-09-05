const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// Packaged builds intentionally use the real OS appData path. Never run this on a user's desktop.
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) {
  throw new Error("Packaged startup acceptance is restricted to disposable GitHub runners.");
}
const executablePath = path.resolve(process.argv[2] || "");
const allowedRoots = [process.env.GITHUB_WORKSPACE, process.env.RUNNER_TEMP].filter(Boolean);
if (!allowedRoots.some((root) => executablePath.startsWith(path.resolve(root) + path.sep))) {
  throw new Error("The executable must belong to this runner's workspace or temporary install.");
}

async function run() {
  let app;
  try {
    app = await electron.launch({ executablePath, timeout: 60000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.getByText("欢迎来到 ShareGPT", { exact: true }).waitFor({ timeout: 60000 });
    const identity = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      data: app.getPath("userData"),
    }));
    assert.equal(identity.packaged, true);
    assert.equal(identity.version, require("../package.json").version);
    assert.equal(path.basename(identity.data), "ShareGPT");
    await page.getByRole("button", { name: "开始设置", exact: true }).click();
    await page.getByRole("button", { name: /仅在本机使用/ }).click();
    await page.getByRole("button", { name: "进入个人工作区", exact: true }).click();
    await page.locator('[data-tour="nav-service"]').waitFor();
    assert.equal(
      (await page.evaluate(() => window.api.getSettingsPrincipal())).principalId,
      "local-device",
    );
    const sentinel = "packaged-startup-sentinel.txt";
    await app.evaluate(({ app }, name) => {
      require("node:fs").writeFileSync(
        require("node:path").join(app.getPath("userData"), name),
        "preserve",
      );
    }, sentinel);
    await app.close();
    app = await electron.launch({ executablePath, timeout: 60000 });
    const reopened = await app.firstWindow();
    await reopened.locator('[data-tour="nav-service"]').waitFor({ timeout: 60000 });
    assert.equal(
      (await reopened.evaluate(() => window.api.getSettingsPrincipal())).principalId,
      "local-device",
    );
    const retained = await app.evaluate(
      ({ app }, name) =>
        require("node:fs").readFileSync(
          require("node:path").join(app.getPath("userData"), name),
          "utf8",
        ),
      sentinel,
    );
    assert.equal(retained, "preserve");
    assert.deepEqual(errors, []);
    console.log(
      "Packaged startup passed: real entry/preload, onboarding, personal Principal, restart and data retention.",
    );
  } finally {
    if (app) await app.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
