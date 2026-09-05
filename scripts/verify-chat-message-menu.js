const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

// Render the production component and stylesheet; only message data and callbacks are fixtures.
const fixtureSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MessageBubble } from '/src/components/panels/chat/MessageBubble.tsx';
import '/src/index.css';
const message = {
  id: 'menu-fixture', type: 'chat', scope: 'subnet', from: 'self', to: '',
  username: 'self', displayName: 'Member', avatar: '', text: 'Menu boundary check',
  attachments: [], replyTo: null, forwardedFrom: null, timestamp: '2026-01-01T12:00:00Z',
  readAt: '', readBy: [], edited: false, editedAt: '', subnetKey: '', subnetLabel: '',
  system: false, recalled: false, recalledAt: '', reactions: {},
};
const actions = Object.fromEntries(['Reply', 'Forward', 'Edit', 'Recall', 'React', 'OpenImage', 'JumpToMessage']
  .map(name => ['on' + name, () => { document.querySelector('output').textContent = name; }]));
const root = createRoot(document.getElementById('root'));
window.renderMenuFixture = ({ mine = true, top = false, height = 240, dark = false } = {}) => {
  document.documentElement.classList.toggle('dark', dark);
  flushSync(() => root.render(<main className="bg-background text-foreground" style={{ padding: 24 }}>
    <div data-chat-scroll-viewport style={{ height, overflow: 'auto', position: 'relative', padding: 16 }}>
      {!top && <div style={{ height: height - 85 }} />}
      <MessageBubble key={String(mine) + top + height + dark} message={message} mine={mine}
        showAvatar={!mine} selfUsername="self" actions={actions} />
      {top && <div style={{ height }} />}
    </div>
    <button id="outside">Outside</button><output />
  </main>));
};
window.renderMenuFixture();
`;

async function run() {
  const { createServer } = await import(
    pathToFileURL(path.join(ROOT, "src/renderer-next/node_modules/vite/dist/node/index.js")).href
  );
  const { _electron: electron } = require("playwright");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-message-menu-"));
  const server = await createServer({
    root: path.join(ROOT, "src/renderer-next"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "message-menu-fixture",
        resolveId(id) {
          if (id === "/menu-fixture.tsx") return id;
        },
        load(id) {
          if (id === "/menu-fixture.tsx") return fixtureSource;
        },
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            if (request.url !== "/menu-fixture") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await vite.transformIndexHtml(
                "/menu-fixture",
                '<div id="root"></div><script type="module" src="/menu-fixture.tsx"></script>',
              ),
            );
          });
        },
      },
    ],
  });
  let electronApp;
  try {
    await server.listen();
    const address = server.httpServer.address();
    electronApp = await electron.launch({
      args: [__filename],
      env: {
        ...process.env,
        SHAREGPT_MENU_FIXTURE_URL: `http://127.0.0.1:${address.port}/menu-fixture`,
        SHAREGPT_USER_DATA: directory,
      },
    });
    const page = await electronApp.firstWindow();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.waitForFunction(() => typeof window.renderMenuFixture === "function");
    const trigger = page.getByRole("button", { name: "消息操作", exact: true });
    const menu = page.getByRole("menu");
    async function checkBounds() {
      await page.locator('[role="menu"], div.absolute.top-7.z-20').evaluate(async (node) => {
        await Promise.all(
          node.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
      const viewport = await page.locator("[data-chat-scroll-viewport]").boundingBox();
      // The fallback locator also allows the original fixed-position implementation to reproduce the defect.
      const content = await page.locator('[role="menu"], div.absolute.top-7.z-20').boundingBox();
      assert.ok(content, "message menu was not rendered");
      assert.ok(
        content.y >= viewport.y && content.y + content.height <= viewport.y + viewport.height + 1,
        `menu escapes vertical viewport: ${JSON.stringify({ viewport, content })}`,
      );
      assert.ok(
        content.x >= viewport.x && content.x + content.width <= viewport.x + viewport.width + 1,
        "menu escapes horizontal viewport",
      );
    }
    for (const mine of [true, false]) {
      await page.evaluate((mine) => window.renderMenuFixture({ mine }), mine);
      await trigger.click();
      await checkBounds();
      await menu.waitFor();
      assert.equal(await menu.getAttribute("data-side"), "top");
      await page.screenshot({ path: path.join(directory, `bottom-${mine}.png`) });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "消息操作",
      );
    }
    await page.evaluate(() => window.renderMenuFixture({ top: true }));
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await menu.waitFor();
    await checkBounds();
    assert.equal(await menu.getAttribute("data-side"), "bottom");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("output").textContent(), "Reply");
    await menu.waitFor({ state: "hidden" });

    await trigger.click();
    await page.getByRole("menuitem", { name: "撤回", exact: true }).click();
    assert.equal(await page.locator("output").textContent(), "Reply");
    await page.getByRole("menuitem", { name: "确认撤回？", exact: true }).click();
    assert.equal(await page.locator("output").textContent(), "Recall");
    await menu.waitFor({ state: "hidden" });
    await trigger.click();
    await menu.waitFor();
    await page.locator("#outside").click();
    await menu.waitFor({ state: "hidden" });

    await page.getByText("Menu boundary check", { exact: true }).click({ button: "right" });
    await menu.waitFor();
    await checkBounds();
    await page.locator("[data-chat-scroll-viewport]").evaluate((node) => {
      node.scrollTop = 12;
    });
    await checkBounds();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });

    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(360, 360),
    );
    await page.evaluate(() => window.renderMenuFixture({ height: 110, dark: true }));
    await trigger.click();
    await menu.waitFor();
    await checkBounds();
    assert.ok(
      await menu.evaluate((node) => node.scrollHeight > node.clientHeight),
      "short viewport must scroll the menu",
    );
    await page.getByRole("menuitem", { name: "撤回", exact: true }).click();
    await page.getByRole("menuitem", { name: "确认撤回？", exact: true }).click();
    assert.equal(await page.locator("output").textContent(), "Recall");
    await trigger.click();
    await checkBounds();
    await page.screenshot({ path: path.join(directory, "narrow-dark.png") });
    process.stdout.write(`${JSON.stringify({ ok: true, screenshots: directory })}\n`);
  } finally {
    await electronApp?.close();
    await server.close();
  }
}

if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.SHAREGPT_USER_DATA);
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    const window = new BrowserWindow({
      show: false,
      width: 640,
      height: 440,
      webPreferences: { backgroundThrottling: false },
    });
    return window.loadURL(process.env.SHAREGPT_MENU_FIXTURE_URL);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
