const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function openChat(page) {
  const skipLogin = page.getByRole("button", { name: "先不登录，随便逛逛" });
  await skipLogin.waitFor({ state: "visible" });
  await skipLogin.click();

  const skipTour = page.getByRole("button", { name: "跳过", exact: true });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  await page.getByRole("button", { name: /协作聊天/ }).click();
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-chat-sidebar-"));
  const screenshot = path.join(temporaryRoot, "member-status.png");
  let electronApp;

  try {
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const page = await electronApp.firstWindow();
    await openChat(page);

    const scroll = page.locator('[data-slot="conversation-list-scroll"]');
    await scroll.waitFor({ state: "visible" });
    const metrics = await scroll.evaluate((node) => {
      node.innerHTML = `
        <ul class="flex w-full min-w-0 flex-col gap-0.5 p-2">
          <li>
            <button class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left">
              <span>头像</span>
              <span class="min-w-0 flex-1 truncate text-sm">
                this-is-an-extremely-long-unbreakable-conversation-name-that-forces-intrinsic-width
              </span>
              <span class="shrink-0 text-[11px]">12:34</span>
            </button>
          </li>
        </ul>
        <div class="mt-1 w-full min-w-0 border-t px-2 pb-2 pt-2">
          <div class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
            <span>图</span>
            <span>群组成员</span>
            <span data-check="count" class="ml-auto shrink-0 whitespace-nowrap tabular-nums text-[11px]">
              2 / 2 在线
            </span>
          </div>
          <button class="flex w-full items-center gap-3 px-2.5 py-1.5">
            <span>头像</span>
            <span class="min-w-0 flex-1 truncate text-sm">st</span>
            <span data-check="status" class="shrink-0 text-[11px]">在线</span>
          </button>
        </div>`;

      const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        viewport: bounds(node),
        count: bounds(node.querySelector('[data-check="count"]')),
        status: bounds(node.querySelector('[data-check="status"]')),
      };
    });

    process.stdout.write(
      "[verify] long chat content cannot push member status outside the sidebar\n",
    );
    assert.equal(metrics.scrollWidth, metrics.clientWidth);
    assert.ok(metrics.count.left >= metrics.viewport.left);
    assert.ok(metrics.count.right <= metrics.viewport.right);
    assert.ok(metrics.status.left >= metrics.viewport.left);
    assert.ok(metrics.status.right <= metrics.viewport.right);
    await page.screenshot({ path: screenshot });
    process.stdout.write(`${JSON.stringify({ ok: true, metrics, screenshot })}\n`);
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
