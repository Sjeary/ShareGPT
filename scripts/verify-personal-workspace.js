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
  const welcomeScreenshot = path.join(temporaryRoot, "workspace-welcome.png");
  const entryScreenshot = path.join(temporaryRoot, "workspace-entry.png");
  const minimumEntryScreenshot = path.join(temporaryRoot, "workspace-entry-minimum.png");
  const personalEntryScreenshot = path.join(temporaryRoot, "workspace-personal-entry.png");
  const organizationEntryScreenshot = path.join(temporaryRoot, "workspace-team-entry.png");
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
    await page.getByText("欢迎来到 ShareGPT", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator("#account-server").count(), 0);
    await page.screenshot({ path: welcomeScreenshot });
    await page.getByRole("button", { name: "开始设置", exact: true }).click();
    await page.getByRole("button", { name: /仅在本机使用/ }).waitFor({ state: "visible" });
    assert.equal(await page.getByText("连接团队", { exact: true }).count(), 1);
    assert.equal(await page.getByText("仅在本机使用", { exact: true }).count(), 1);
    assert.equal(await page.getByText(/不显示聊天、成员和团队管理功能/).count(), 1);
    assert.equal(await page.getByText(/个人与团队数据互相隔离/).count(), 1);
    await page.screenshot({ path: entryScreenshot });

    const originalWindowSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      return window.getSize();
    });
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      window.setSize(860, 620);
    });
    await page.waitForTimeout(150);
    const minimumLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    }));
    const personalEntryBounds = await page
      .getByRole("button", { name: /仅在本机使用/ })
      .boundingBox();
    assert.ok(personalEntryBounds);
    assert.ok(minimumLayout.documentWidth <= minimumLayout.viewportWidth);
    assert.ok(personalEntryBounds.x + personalEntryBounds.width <= minimumLayout.viewportWidth);
    assert.ok(personalEntryBounds.y + personalEntryBounds.height <= minimumLayout.viewportHeight);
    await page.screenshot({ path: minimumEntryScreenshot });
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      window.setSize(size[0], size[1]);
    }, originalWindowSize);

    await page.getByRole("button", { name: /仅在本机使用/ }).click();
    await page.getByText("在本机独立使用", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.getByText(/不读取任何团队账号的登录状态或历史会话/).count(), 1);
    assert.equal(await page.getByText(/侧栏底部的“账户”/).count(), 1);
    await page.screenshot({ path: personalEntryScreenshot });
    await page.getByRole("button", { name: "进入个人工作区", exact: true }).click();
    await dismissGuides(page);
    await assertPersonalWorkspace(page);

    const principal = await page.evaluate(() => window.api.getSettingsPrincipal());
    assert.equal(principal.principalId, "local-device");
    assert.ok(principal.generation >= 1, "personal workspace must activate a usable Principal");

    const createdWorkspace = await page.evaluate(() =>
      window.api.createAiView("gpt", { lastUrl: "https://chatgpt.com/" }),
    );
    assert.ok(createdWorkspace?.activeTabId, "personal Principal must create an AI workspace");
    assert.ok(
      createdWorkspace.tabs?.some((tab) => tab.id === createdWorkspace.activeTabId),
      "created AI workspace must be present in the main-process tab registry",
    );

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

    const ensuredWorkspace = await page.evaluate(
      async ({ tabId, port }) => {
        await window.api.setActiveAiKind("gpt");
        return window.api.ensureAiWorkspace({
          kind: "gpt",
          tabId,
          environmentId: "",
          host: "127.0.0.1",
          port,
          homeUrl: "https://chatgpt.com/auth/login",
          lastUrl: "https://chatgpt.com/",
          userAgent: window.navigator.userAgent,
        });
      },
      { tabId: createdWorkspace.activeTabId, port: senderStatus.senderSocksPort },
    );
    assert.equal(ensuredWorkspace.tabId, createdWorkspace.activeTabId);
    assert.equal(ensuredWorkspace.proxyMode, "sender");
    assert.equal(ensuredWorkspace.rendererAlive, true);
    assert.equal(await page.getByText("账号身份尚未准备好", { exact: true }).count(), 0);
    await page.evaluate(() => window.api.setActiveAiKind(""));

    await page.getByRole("button", { name: "停止代理" }).click();
    await page.getByRole("button", { name: "开启代理" }).waitFor({ state: "visible" });
    await page.screenshot({ path: screenshot });

    await page.reload();
    await page.locator("#account-server").waitFor({ state: "visible" });
    assert.equal(await page.getByText("欢迎来到 ShareGPT", { exact: true }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "返回选择使用方式", exact: true }).count(),
      1,
    );
    await page.screenshot({ path: organizationEntryScreenshot });
    assert.equal(await page.locator('[data-tour="nav-service"]').count(), 0);
    await page.getByRole("button", { name: "返回选择使用方式", exact: true }).click();
    await page.getByRole("button", { name: /仅在本机使用/ }).click();
    await page.getByRole("button", { name: "进入个人工作区", exact: true }).click();
    await dismissGuides(page);
    await assertPersonalWorkspace(page);

    assert.equal(await page.getByText(/个人工作区 · 配置/).count(), 0);
    const serviceNav = page.locator('[data-tour="nav-service"]');
    const accountNav = page.locator('[data-tour="nav-account"]');
    await accountNav.click();
    await page.getByText("网页隐私与环境", { exact: true }).waitFor({ state: "visible" });
    assert.match(await accountNav.getAttribute("class"), /text-sidebar-accent-foreground/);
    assert.doesNotMatch(await serviceNav.getAttribute("class"), /text-sidebar-accent-foreground/);
    assert.equal(await page.getByText("当前：个人工作区", { exact: true }).count(), 1);
    assert.equal(await page.locator("#account-server").count(), 0);
    assert.equal(await page.getByRole("button", { name: "清除", exact: true }).count(), 3);
    assert.equal(await page.getByRole("button", { name: "重建资料环境", exact: true }).count(), 3);
    assert.equal(await page.locator("#browser-privacy-sync").count(), 0);
    assert.equal(
      await page.getByText(/个人工作区的环境配置、清理记录和网页分区只保存在本机/).count(),
      1,
    );

    const rejectedWithoutConfirmation = await page.evaluate(async () => {
      try {
        await window.api.clearAiBrowserData("claude", {});
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(rejectedWithoutConfirmation, /确认当前个人工作区/);

    const beforeClear = await page.evaluate(async () => {
      const activePrincipal = await window.api.getSettingsPrincipal();
      const settings = await window.api.loadSettings({
        expectedPrincipalId: activePrincipal.principalId,
        expectedPrincipalGeneration: activePrincipal.generation,
      });
      return {
        partition: settings.claude?.partition || "",
        clearedAt: settings.browserPrivacy?.lastClearedAt?.claude || "",
      };
    });
    const claudeRow = page
      .getByText("只清除 Claude 网页分区", { exact: false })
      .locator("..")
      .locator("..");
    await claudeRow.getByRole("button", { name: "清除", exact: true }).click();
    const clearDialog = page.getByRole("dialog");
    await clearDialog.getByText("清除 Claude 网页数据", { exact: true }).waitFor();
    assert.equal(await clearDialog.locator("#browser-clear-password").count(), 0);
    const confirmButton = clearDialog.getByRole("button", { name: "确认并清除", exact: true });
    assert.equal(await confirmButton.isDisabled(), true);
    await clearDialog.locator("#browser-clear-confirmation").fill("Claude");
    await confirmButton.click();
    await page.getByText(/Claude 的 Cookie、登录状态和本地网页记录已清除/).waitFor();
    await clearDialog.waitFor({ state: "hidden" });
    const afterClear = await page.evaluate(async () => {
      const activePrincipal = await window.api.getSettingsPrincipal();
      const settings = await window.api.loadSettings({
        expectedPrincipalId: activePrincipal.principalId,
        expectedPrincipalGeneration: activePrincipal.generation,
      });
      return {
        principalId: activePrincipal.principalId,
        partition: settings.claude?.partition || "",
        clearedAt: settings.browserPrivacy?.lastClearedAt?.claude || "",
      };
    });
    assert.equal(afterClear.principalId, "local-device");
    assert.equal(afterClear.partition, beforeClear.partition);
    assert.notEqual(afterClear.clearedAt, beforeClear.clearedAt);
    await page.screenshot({ path: accountScreenshot });

    await page.getByRole("button", { name: "登录组织工作区", exact: true }).click();
    await page.locator("#account-server").waitFor({ state: "visible" });

    await electronApp.close();
    electronApp = undefined;
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const relaunchedPage = await electronApp.firstWindow();
    await relaunchedPage.locator("#account-server").waitFor({ state: "visible" });
    assert.equal(await relaunchedPage.getByText("欢迎来到 ShareGPT", { exact: true }).count(), 0);
    assert.equal(await relaunchedPage.locator('[data-tour="nav-service"]').count(), 0);

    process.stdout.write(
      `${JSON.stringify({ ok: true, principal, welcomeScreenshot, entryScreenshot, minimumEntryScreenshot, personalEntryScreenshot, organizationEntryScreenshot, screenshot, accountScreenshot })}\n`,
    );
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
