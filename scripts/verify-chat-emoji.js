const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function serveFixture() {
  const root = path.resolve(__dirname, "../src/renderer-next");
  const { createServer } = await import(
    pathToFileURL(path.join(root, "node_modules/vite/dist/node/index.js")).href
  );
  const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JumboEmoji } from '/src/components/panels/chat/JumboEmoji.tsx';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
window.renderEmoji = clusters => flushSync(() => root.render(<JumboEmoji clusters={clusters} />));
window.unmountEmoji = () => flushSync(() => root.render(null));
window.fixtureReady = true;
`;
  const server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "emoji-behavior-fixture",
        resolveId: (id) => (id === "/emoji-fixture.tsx" ? id : undefined),
        load: (id) => (id === "/emoji-fixture.tsx" ? source : undefined),
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            if (request.url !== "/emoji-fixture") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await vite.transformIndexHtml(
                "/emoji-fixture",
                '<div id="root"></div><script type="module" src="/emoji-fixture.tsx"></script>',
              ),
            );
          });
        },
      },
    ],
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.httpServer.address().port}/emoji-fixture` };
}

async function run() {
  const fixture = process.env.SHAREGPT_EMOJI_FIXTURE_URL ? null : await serveFixture();
  const url = process.env.SHAREGPT_EMOJI_FIXTURE_URL || fixture.url;
  if (process.env.SHAREGPT_EMOJI_SERVER_ONLY === "1") {
    console.log(JSON.stringify({ fixtureUrl: url }));
    return;
  }
  const { _electron } = require("playwright");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-emoji-test-"));
  const checks = [];
  let app;
  try {
    app = await _electron.launch({
      ...(process.env.SHAREGPT_TEST_ELECTRON
        ? { executablePath: process.env.SHAREGPT_TEST_ELECTRON }
        : {}),
      args: [__filename],
      env: { ...process.env, SHAREGPT_EMOJI_FIXTURE_URL: url, SHAREGPT_USER_DATA: userData },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=",
      "base64",
    );
    let fail = true;
    let kitchenRequests = 0;
    await page
      .context()
      .route("https://fonts.gstatic.com/**", (route) =>
        route.fulfill({ contentType: "image/png", body: png }),
      );
    await page.context().route("https://www.gstatic.com/**", (route) => {
      kitchenRequests++;
      return fail
        ? route.abort("internetdisconnected")
        : route.fulfill({ contentType: "image/png", body: png });
    });
    await page.waitForFunction(() => window.fixtureReady === true);
    await page.evaluate(() => window.renderEmoji(["😀", "😂"]));
    const retry = page.getByRole("button", { name: "重新加载组合表情" });
    await retry.waitFor();
    assert.equal(await page.locator("#root img").count(), 2);
    checks.push("failed combination keeps both original emojis and exposes retry");
    fail = false;
    await retry.click();
    await page.waitForFunction(() => {
      const image = document.querySelector('#root img[src*="emojikitchen"]');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await retry.count(), 0);
    checks.push("retry recovers the combination without restarting");
    await page.evaluate(() => window.renderEmoji(["😀", "😀"]));
    await page.waitForFunction(
      () => document.querySelector('#root img[src*="u1f600_u1f600"]')?.complete,
    );
    assert.equal(await page.locator('#root img[alt="😀😀"]').count(), 1);
    checks.push("changing the pair replaces the previous combination");
    fail = true;
    await page.evaluate(() => window.renderEmoji(["😂", "😂"]));
    await retry.waitFor();
    await page.evaluate(() => window.unmountEmoji());
    fail = false;
    await page.evaluate(() => window.renderEmoji(["😂", "😂"]));
    await page.waitForFunction(() => {
      const image = document.querySelector('#root img[src*="u1f602_u1f602"]');
      return image?.complete && image.naturalWidth > 0;
    });
    checks.push("a temporary failure is not cached across remounts");
    const beforeUnsupported = kitchenRequests;
    await page.evaluate(() => window.renderEmoji(["🧑‍🚀", "🧑‍🚀"]));
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#root img").count(), 2);
    assert.equal(await retry.count(), 0);
    assert.equal(kitchenRequests, beforeUnsupported);
    checks.push("unsupported combinations remain two emojis without a combination request");
    assert.deepEqual(errors, []);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((win) => win.isVisible()),
      ),
      false,
    );
    console.log(JSON.stringify({ ok: true, platform: process.platform, checks }, null, 2));
  } finally {
    await app?.close();
    await fixture?.server.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.SHAREGPT_USER_DATA);
  if (process.platform === "darwin") app.dock.hide();
  app.whenReady().then(() => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL(process.env.SHAREGPT_EMOJI_FIXTURE_URL);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
