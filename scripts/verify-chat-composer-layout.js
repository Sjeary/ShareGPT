const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { loginThroughForm, startCollabLoginFixture } = require("./lib/collab-login-fixture");

const ROOT = path.resolve(__dirname, "..");

async function metrics(composer) {
  return composer.evaluate((node) => ({
    clientHeight: node.clientHeight,
    offsetHeight: node.offsetHeight,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
}

async function enableAndFill(composer, value) {
  await composer.evaluate((node) => {
    node.disabled = false;
  });
  await composer.fill(value);
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-chat-composer-"));
  const screenshot = path.join(temporaryRoot, "short-text.png");
  const fixture = await startCollabLoginFixture();
  let electronApp;

  try {
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const page = await electronApp.firstWindow();
    await loginThroughForm(page, fixture.baseUrl);
    await page.getByRole("button", { name: /协作聊天/ }).click();

    const composer = page.locator('textarea[placeholder="登录账户后即可发送消息"]');
    await composer.waitFor({ state: "visible" });

    process.stdout.write("[verify] short composer text does not create a false scrollbar\n");
    await enableAndFill(composer, "真的假的");
    const short = await metrics(composer);
    await page.screenshot({ path: screenshot });
    assert.equal(short.overflowY, "hidden");
    assert.ok(
      short.scrollHeight <= short.clientHeight,
      `short text overflowed: scroll=${short.scrollHeight}, client=${short.clientHeight}`,
    );

    process.stdout.write("[verify] long composer text keeps bounded scrolling\n");
    await enableAndFill(
      composer,
      Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行`).join("\n"),
    );
    const long = await metrics(composer);
    assert.equal(long.overflowY, "auto");
    assert.ok(long.scrollHeight > long.clientHeight);
    assert.ok(long.offsetHeight <= 140, `long composer height=${long.offsetHeight}`);

    process.stdout.write("[verify] clearing composer restores the single-line layout\n");
    await enableAndFill(composer, "");
    const cleared = await metrics(composer);
    assert.equal(cleared.overflowY, "hidden");
    assert.ok(cleared.scrollHeight <= cleared.clientHeight);
    assert.equal(cleared.offsetHeight, short.offsetHeight);

    process.stdout.write(`${JSON.stringify({ ok: true, short, long, cleared, screenshot })}\n`);
  } finally {
    await electronApp?.close().catch(() => undefined);
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
