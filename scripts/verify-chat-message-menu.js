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
import { Composer } from '/src/components/panels/chat/Composer.tsx';
import { EMPTY_COMPOSER_DRAFT } from '/src/store/useChatStore.ts';
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
function FixtureComposer() {
  const [draft, setDraft] = React.useState(EMPTY_COMPOSER_DRAFT);
  return <Composer disabled={false} sendDisabled={false} placeholder="Message" draft={draft}
    onDraftChange={patch => setDraft(d => ({...d, ...patch}))}
    onSend={() => true} onEditSubmit={() => true} onCancelDraft={() => {}} />;
}
window.renderMenuFixture = ({ mine = true, top = false, height = 240, dark = false, readers = false, composer = false } = {}) => {
  document.documentElement.classList.toggle('dark', dark);
  flushSync(() => root.render(<main className="bg-background text-foreground" style={{ padding: 24 }}>
    <div data-chat-scroll-viewport style={{ height, overflow: 'auto', position: 'relative', padding: 16 }}>
      {!top && <div style={{ height: height - 85 }} />}
      <MessageBubble key={String(mine) + top + height + dark + readers} message={{...message,
        readBy: readers ? Array.from({ length: 30 }, (_, i) => ({username: 'reader-' + i, displayName: 'Reader ' + i, readAt: ''})) : []}} mine={mine}
        showAvatar={!mine} selfUsername="self" actions={actions} />
      {top && <div style={{ height }} />}
    </div>
    {composer && <FixtureComposer />}
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
    server: { host: "127.0.0.1", port: 0, strictPort: false },
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
    async function clickVisibleEmoji(picker) {
      // The picker virtualizes categories and may retain offscreen duplicates of common emoji.
      const buttons = picker.locator("button.epr-emoji");
      const index = await buttons.evaluateAll((nodes) =>
        nodes.findIndex((node) => {
          const r = node.getBoundingClientRect();
          return (
            r.height > 0 &&
            node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          );
        }),
      );
      assert.ok(
        index >= 0,
        "at least one emoji must be immediately clickable without scrolling history",
      );
      await buttons.nth(index).click();
    }
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
    await page.keyboard.press("Escape");
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(640, 640),
    );
    for (const mine of [true, false]) {
      await page.evaluate(
        (mine) => window.renderMenuFixture({ mine, height: 540, dark: true }),
        mine,
      );
      const viewport = page.locator("[data-chat-scroll-viewport]");
      const before = await viewport.evaluate((node) => ({
        top: node.scrollTop,
        height: node.scrollHeight,
      }));
      await page.getByRole("button", { name: "表情回应", exact: true }).click();
      const picker = page.locator(".EmojiPickerReact");
      await picker.waitFor();
      const bounds = await picker.boundingBox();
      const area = await viewport.boundingBox();
      assert.ok(
        bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height,
        `emoji picker escapes chat viewport: ${JSON.stringify({ bounds, area })}`,
      );
      assert.deepEqual(
        await viewport.evaluate((node) => ({ top: node.scrollTop, height: node.scrollHeight })),
        before,
        "opening reactions must not scroll or enlarge message history",
      );
      await page.screenshot({ path: path.join(directory, `reaction-${mine}.png`) });
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "hidden" });
    }
    for (const width of [360, 640]) {
      await electronApp.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 480),
        width,
      );
      await page.evaluate(() =>
        window.renderMenuFixture({ height: 260, readers: true, composer: true }),
      );
      const viewport = page.locator("[data-chat-scroll-viewport]");
      await page.getByRole("button", { name: "表情回应", exact: true }).click();
      const picker = page.locator(".EmojiPickerReact");
      await picker.waitFor();
      const area = await viewport.boundingBox();
      const box = await picker.boundingBox();
      assert.ok(box.x >= area.x && box.x + box.width <= area.x + area.width + 1);
      assert.ok(box.y >= area.y && box.y + box.height <= area.y + area.height + 1);
      await page.screenshot({ path: path.join(directory, `reaction-narrow-${width}.png`) });
      process.stdout.write(`${JSON.stringify({ directory, width, box, area })}\n`);
      await clickVisibleEmoji(picker);
      await picker.waitFor({ state: "hidden" });
      assert.equal(await page.locator("output").textContent(), "React");
      await page.getByRole("button", { name: "30 人已读", exact: true }).click();
      const readers = page.getByRole("dialog", { name: "已读成员" });
      await readers.waitFor();
      const readerBox = await readers.boundingBox();
      assert.ok(
        readerBox.y >= area.y && readerBox.y + readerBox.height <= area.y + area.height + 1,
      );
      await readers.getByText("Reader 29", { exact: true }).scrollIntoViewIfNeeded();
      await page.keyboard.press("Escape");
      await readers.waitFor({ state: "hidden" });
      await page.getByTitle("插入表情", { exact: true }).click();
      await picker.waitFor();
      const composerBox = await picker.boundingBox();
      const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(composerBox.x >= 0 && composerBox.x + composerBox.width <= windowSize.width);
      assert.ok(composerBox.y >= 0 && composerBox.y + composerBox.height <= windowSize.height);
      await picker.getByPlaceholder("搜索表情").fill("grinning face");
      await page.waitForFunction(() =>
        document.querySelector(".EmojiPickerReact")?.classList.contains("epr-search-active"),
      );
      await page.screenshot({ path: path.join(directory, `composer-picker-${width}.png`) });
      await clickVisibleEmoji(picker);
      await picker.waitFor({ state: "hidden" });
      assert.ok((await page.locator("textarea").inputValue()).length > 0);
      await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
    }
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
