const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function waitForFullScreen(electronApp, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      return Boolean(window?.isFullScreen());
    });
    if (current === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`window did not reach fullScreen=${expected}`);
}

async function titlebarSnapshot(page) {
  const header = page.locator("header").first();
  const brand = header.getByText("ShareGPT", { exact: true });
  await brand.waitFor({ state: "visible" });
  return {
    paddingLeft: await header.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).paddingLeft),
    ),
    brand: await brand.boundingBox(),
  };
}

async function waitForFullScreenEvent(page, expected) {
  await page.waitForFunction(
    (value) =>
      Array.isArray(window.__shareGptFullScreenEvents) &&
      window.__shareGptFullScreenEvents.some((event) => event.fullScreen === value),
    expected,
  );
}

async function main() {
  if (process.platform !== "darwin") {
    process.stdout.write("[verify] macOS fullscreen titlebar skipped on non-macOS\n");
    return;
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-fullscreen-titlebar-"));
  const screenshots = {
    windowed: path.join(temporaryRoot, "windowed.png"),
    fullscreen: path.join(temporaryRoot, "fullscreen.png"),
    restored: path.join(temporaryRoot, "restored.png"),
  };
  let electronApp;

  try {
    electronApp = await electron.launch({
      args: [ROOT],
      cwd: ROOT,
      env: { ...process.env, SHAREGPT_USER_DATA: path.join(temporaryRoot, "user-data") },
    });
    const page = await electronApp.firstWindow();
    await page.waitForFunction(() => Boolean(window.api?.toggleWindowFullScreen));
    await page.evaluate(() => {
      window.__shareGptFullScreenEvents = [];
      window.api.onAppEvent((payload) => {
        if (payload?.type === "window-fullscreen-changed") {
          window.__shareGptFullScreenEvents.push({ fullScreen: Boolean(payload.fullScreen) });
        }
      });
    });

    await page.evaluate(() => window.api.toggleWindowFullScreen(false));
    await waitForFullScreen(electronApp, false);
    const windowed = await titlebarSnapshot(page);
    await page.screenshot({ path: screenshots.windowed });
    assert.ok(windowed.brand, "windowed ShareGPT brand must be visible");
    assert.ok(windowed.paddingLeft >= 70, `windowed traffic-light padding=${windowed.paddingLeft}`);

    process.stdout.write(
      "[verify] completed macOS enter-full-screen event removes traffic-light padding\n",
    );
    await page.evaluate(() => window.api.toggleWindowFullScreen(true));
    await waitForFullScreen(electronApp, true);
    await waitForFullScreenEvent(page, true);
    const fullscreen = await titlebarSnapshot(page);
    await page.screenshot({ path: screenshots.fullscreen });
    assert.ok(fullscreen.brand, "fullscreen ShareGPT brand must be visible");
    assert.ok(
      fullscreen.paddingLeft <= 16,
      `fullscreen titlebar padding=${fullscreen.paddingLeft}`,
    );
    assert.ok(
      windowed.brand.x - fullscreen.brand.x >= 50,
      `brand did not move left after traffic lights hid: ${windowed.brand.x} -> ${fullscreen.brand.x}`,
    );

    process.stdout.write(
      "[verify] completed macOS leave-full-screen event restores traffic-light padding\n",
    );
    await page.evaluate(() => {
      window.__shareGptFullScreenEvents = [];
      return window.api.toggleWindowFullScreen(false);
    });
    await waitForFullScreen(electronApp, false);
    await waitForFullScreenEvent(page, false);
    const restored = await titlebarSnapshot(page);
    await page.screenshot({ path: screenshots.restored });
    assert.ok(restored.brand, "restored ShareGPT brand must be visible");
    assert.ok(Math.abs(restored.paddingLeft - windowed.paddingLeft) <= 1);
    assert.ok(Math.abs(restored.brand.x - windowed.brand.x) <= 2);

    process.stdout.write(
      `${JSON.stringify({ ok: true, windowed, fullscreen, restored, screenshots })}\n`,
    );
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
