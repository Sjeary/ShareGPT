const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-editor-state-"));
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: {
      ...process.env,
      SHAREGPT_USER_DATA: profile,
      SHAREGPT_BACKGROUND_TEST: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "开始设置", exact: true }).click();
    await page.getByRole("button", { name: /仅在本机使用/ }).click();
    await page.getByRole("button", { name: "进入个人工作区", exact: true }).click();
    const skip = page.getByRole("button", { name: "跳过", exact: true });
    await skip.waitFor({ state: "visible" });
    await skip.click();
    const guide = page.getByRole("button", { name: "关闭引导", exact: true });
    if (await guide.isVisible()) await guide.click();
    await page.locator('[data-tour="nav-account"]').click();
    await page.locator("#ui-show-calendar").click();
    await page.locator("#ui-show-todo").click();

    await page.locator('[data-tour="nav-calendar"]').click();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("标题", { exact: true }).fill("Audit calendar event");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("Audit calendar event", { exact: true }).first().click();
    dialog = page.getByRole("dialog");
    assert.equal(
      await dialog.getByPlaceholder("标题", { exact: true }).inputValue(),
      "Audit calendar event",
    );
    await dialog.getByPlaceholder("标题", { exact: true }).fill("Audit calendar revised");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    assert.equal(
      await page.getByRole("dialog").getByPlaceholder("标题", { exact: true }).inputValue(),
      "",
    );
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();

    await page.locator('[data-tour="nav-todo"]').click();
    await page.getByRole("button", { name: /^全部/ }).click();
    const add = page.getByPlaceholder(/添加任务/);
    await add.fill("Audit task");
    await add.press("Enter");
    await page.getByText("Audit task", { exact: true }).click();
    dialog = page.getByRole("dialog");
    assert.equal(
      await dialog.getByPlaceholder("任务标题", { exact: true }).inputValue(),
      "Audit task",
    );
    await dialog.getByPlaceholder("任务标题", { exact: true }).fill("Audit task revised");
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByText("Audit task revised", { exact: true }).click();
    assert.equal(
      await page.getByRole("dialog").getByPlaceholder("任务标题", { exact: true }).inputValue(),
      "Audit task revised",
    );
    await page.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();

    await page.getByRole("button", { name: "备忘录", exact: true }).click();
    await page.getByRole("button", { name: "新建便签", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("标题", { exact: true }).fill("Audit memo");
    await dialog.getByPlaceholder("写点什么…", { exact: true }).fill("Saved memo body");
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByText("Audit memo", { exact: true }).click();
    assert.equal(
      await page.getByRole("dialog").getByPlaceholder("写点什么…", { exact: true }).inputValue(),
      "Saved memo body",
    );
    await page.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();

    await page.getByRole("button", { name: "新手引导", exact: true }).click();
    const firstStep = await page.getByText(/1 \/ /).textContent();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "跳过", exact: true }).click();
    await page.getByRole("button", { name: "新手引导", exact: true }).click();
    assert.equal(await page.getByText(/1 \/ /).textContent(), firstStep);
    process.stdout.write(
      `${JSON.stringify({ ok: true, calendar: "edit-and-new", task: "save-and-reopen", memo: "save-and-reopen", onboarding: "restart-at-first-step" })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
