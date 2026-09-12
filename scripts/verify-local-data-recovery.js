const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-local-data-recovery-"));
  const localData = path.join(profile, "PrincipalData", "local-device");
  fs.mkdirSync(localData, { recursive: true });
  const invalid = '{"interrupted":';
  fs.writeFileSync(path.join(localData, "calendar.json"), invalid);
  fs.writeFileSync(path.join(localData, "tasks.json"), invalid);
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, SHAREGPT_USER_DATA: profile, SHAREGPT_BACKGROUND_TEST: "1" },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.getByRole("button", { name: "开始设置", exact: true }).click();
    await page.getByRole("button", { name: /仅在本机使用/ }).click();
    await page.getByRole("button", { name: "进入个人工作区", exact: true }).click();
    await page.getByRole("button", { name: "跳过", exact: true }).click();
    const guide = page.getByRole("button", { name: "关闭引导", exact: true });
    if (await guide.isVisible()) await guide.click();
    await page.locator('[data-tour="nav-account"]').click();
    await page.locator("#ui-show-calendar").click();
    await page.locator("#ui-show-todo").click();

    await page.locator('[data-tour="nav-calendar"]').click();
    const retry = page.getByRole("button", { name: "重新加载", exact: true });
    await retry.waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "新建", exact: true }).count(), 0);
    assert.equal(fs.readFileSync(path.join(localData, "calendar.json"), "utf8"), invalid);
    await retry.click();
    await retry.waitFor({ state: "visible" });
    fs.writeFileSync(
      path.join(localData, "calendar.json"),
      JSON.stringify({
        calendars: [
          {
            id: "restored-calendar",
            name: "Recovered calendar",
            color: "#123456",
            visible: true,
            isDefault: true,
          },
        ],
        events: [],
      }),
    );
    await retry.click();
    await page.getByRole("button", { name: "新建", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByPlaceholder("标题", { exact: true })
      .fill("Recovered editing");
    await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("Recovered editing", { exact: true }).first().waitFor();

    await page.locator('[data-tour="nav-todo"]').click();
    await retry.waitFor({ state: "visible" });
    assert.equal(await page.getByPlaceholder(/添加任务/).count(), 0);
    assert.equal(fs.readFileSync(path.join(localData, "tasks.json"), "utf8"), invalid);
    fs.writeFileSync(
      path.join(localData, "tasks.json"),
      JSON.stringify({
        lists: [{ id: "restored-inbox", name: "Recovered inbox", color: "#123456", isInbox: true }],
        tasks: [],
        memos: [],
      }),
    );
    await retry.click();
    await page.getByRole("button", { name: /^全部/ }).click();
    await page.getByPlaceholder(/添加任务/).fill("Recovered task");
    await page.getByPlaceholder(/添加任务/).press("Enter");
    await page.getByText("Recovered task", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    process.stdout.write(
      `${JSON.stringify({ ok: true, preservedCorruptFiles: true, calendarRetryEditing: true, tasksRetryEditing: true, rendererErrors: errors })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
