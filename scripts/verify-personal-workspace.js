const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function dismissGuides(page) {
  const skipTour = page.getByRole("button", { name: "跳过", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const closeGuide = page.getByRole("button", { name: "关闭引导", exact: true });
  if (await closeGuide.isVisible().catch(() => false)) await closeGuide.click();
}

async function assertPersonalWorkspace(page) {
  await page.locator('[data-tour="nav-service"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-tour="nav-service"]').count(), 1);
  assert.equal(await page.locator('[data-tour="nav-calendar"]').count(), 1);
  assert.equal(await page.locator('[data-tour="nav-notes"]').count(), 1);
  assert.equal(await page.locator('[data-tour="nav-gpt"]').count(), 1);
  assert.equal(await page.locator('[data-tour="nav-chat"]').count(), 0);
  assert.equal(await page.locator('[data-tour="nav-team"]').count(), 0);
  assert.equal(await page.locator('[data-tour="nav-stats"]').count(), 0);
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-personal-workspace-"));
  const screenshot = path.join(temporaryRoot, "personal-workspace.png");
  const accountScreenshot = path.join(temporaryRoot, "personal-account.png");
  let electronApp;

  try {
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const page = await electronApp.firstWindow();
    await page.getByRole("button", { name: "进入个人工作区" }).click();
    await dismissGuides(page);
    await assertPersonalWorkspace(page);

    const principal = await page.evaluate(() => window.api.getSettingsPrincipal());
    assert.equal(principal.principalId, "local-device");

    await page.locator('[data-tour="nav-service"]').click();
    assert.equal(await page.getByText(/请先登录账号并保持在线/).count(), 0);
    assert.equal(await page.getByText("代理协议", { exact: true }).count(), 1);
    assert.equal(await page.locator("#s_personal_proxy_host").count(), 1);
    assert.equal(await page.locator("#s_personal_proxy_port").count(), 1);
    assert.equal(await page.locator("#s_proxy_uuid").count(), 0);
    assert.equal(await page.locator("#s_socks_listen_port").count(), 0);
    assert.equal(await page.locator("#s_fallback_mode").count(), 0);
    assert.equal(await page.locator("#s_target_domains").count(), 0);
    assert.equal(await page.getByText("机场节点", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "开启代理" }).isEnabled(), true);
    await page.locator("#s_personal_proxy_port").fill("1080");
    await page.waitForFunction(
      () => document.querySelector("#s_personal_proxy_port")?.value === "1080",
    );
    await page.getByRole("button", { name: "开启代理" }).click();
    await page.getByRole("button", { name: "停止代理" }).waitFor({ state: "visible" });
    const senderStatus = await page.evaluate(() => window.api.getStatus());
    assert.equal(senderStatus.senderRunning, true);
    assert.notEqual(senderStatus.senderSocksPort, 1080);
    await page.getByRole("button", { name: "停止代理" }).click();
    await page.getByRole("button", { name: "开启代理" }).waitFor({ state: "visible" });
    await page.screenshot({ path: screenshot });

    await page.reload();
    await page.getByRole("button", { name: "进入个人工作区" }).waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-tour="nav-service"]').count(), 0);
    await page.getByRole("button", { name: "进入个人工作区" }).click();
    await dismissGuides(page);
    await assertPersonalWorkspace(page);

    assert.equal(await page.getByText(/个人工作区 · 配置/).count(), 0);
    const serviceNav = page.locator('[data-tour="nav-service"]');
    const accountNav = page.locator('[data-tour="nav-account"]');
    await accountNav.click();
    await page.locator("#account-server").waitFor({ state: "visible" });
    assert.match(await accountNav.getAttribute("class"), /text-sidebar-accent-foreground/);
    assert.doesNotMatch(await serviceNav.getAttribute("class"), /text-sidebar-accent-foreground/);
    assert.equal(await page.getByText("当前：个人工作区", { exact: true }).count(), 1);
    assert.equal(await page.getByText("登录组织工作区", { exact: true }).count(), 1);
    await page.screenshot({ path: accountScreenshot });

    await electronApp.close();
    electronApp = undefined;
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const relaunchedPage = await electronApp.firstWindow();
    await relaunchedPage
      .getByRole("button", { name: "进入个人工作区" })
      .waitFor({ state: "visible" });
    assert.equal(await relaunchedPage.locator('[data-tour="nav-service"]').count(), 0);

    process.stdout.write(
      `${JSON.stringify({ ok: true, principal, screenshot, accountScreenshot })}\n`,
    );
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
