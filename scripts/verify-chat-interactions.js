const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { WebSocketServer } = require("../collab_server2/node_modules/ws");
const ROOT = path.resolve(__dirname, "..");

// Real ChatPanel, store and WebSocket hook; only the server and main-issued identities are fixtures.
function fixtureSource(baseUrl) {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatPanel } from '/src/components/panels/ChatPanel.tsx';
import { useChatStore } from '/src/store/useChatStore.ts';
import { useAppStore } from '/src/store/useAppStore.ts';
import { settingsPrincipalRuntime } from '/src/lib/settingsPrincipalRuntime.ts';
import '/src/index.css';
window.chatStore = useChatStore;
window.appStore = useAppStore;
window.switchPrincipal = (username) => {
  settingsPrincipalRuntime.activate('fixture:' + username);
  useAppStore.setState({ active: 'chat', authed: true, workspaceMode: 'organization',
    settings: { collab: { server_url: ${JSON.stringify(baseUrl)}, last_username: username } } });
  useChatStore.getState().setIdentity({ serverUrl: ${JSON.stringify(baseUrl)}, username, token: username });
};
window.switchPrincipal('Alice');
const root = createRoot(document.getElementById('root'));
window.mountChat = () => flushSync(() => root.render(<main className="bg-background text-foreground" style={{display:'flex',height:'100vh'}}><ChatPanel /></main>));
window.unmountChat = () => flushSync(() => root.render(null));
const send = WebSocket.prototype.send;
window.failNextChat = false;
WebSocket.prototype.send = function(data) {
  if (window.failNextChat && JSON.parse(data).type === 'chat') {
    window.failNextChat = false;
    throw new Error('模拟发送失败，草稿已保留');
  }
  return send.call(this, data);
};
window.mountChat();
`;
}

async function run() {
  const { createServer } = await import(
    pathToFileURL(path.join(ROOT, "src/renderer-next/node_modules/vite/dist/node/index.js")).href
  );
  const { _electron: electron } = require("playwright");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-chat-interactions-"));
  const received = [];
  const backend = http.createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    response.end(
      JSON.stringify({
        users: [
          { username: "Alice", displayName: "Alice", online: true },
          { username: "Bob", displayName: "Bob", online: true },
        ],
      }),
    );
  });
  const sockets = new WebSocketServer({ server: backend });
  sockets.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      received.push(message);
      if (message.type === "chat")
        socket.send(
          JSON.stringify({
            ...message,
            id: "sent-" + received.length,
            from: "Alice",
            username: "Alice",
            timestamp: new Date().toISOString(),
          }),
        );
    });
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const source = fixtureSource("http://127.0.0.1:" + backend.address().port);
  const server = await createServer({
    root: path.join(ROOT, "src/renderer-next"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    plugins: [
      {
        name: "chat-interaction-fixture",
        resolveId: (id) => (id === "/chat-fixture.tsx" ? id : undefined),
        load: (id) => (id === "/chat-fixture.tsx" ? source : undefined),
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            if (request.url !== "/chat-fixture") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await vite.transformIndexHtml(
                "/chat-fixture",
                '<div id="root"></div><script type="module" src="/chat-fixture.tsx"></script>',
              ),
            );
          });
        },
      },
    ],
  });
  let app;
  try {
    await server.listen();
    app = await electron.launch({
      args: [__filename],
      env: {
        ...process.env,
        SHAREGPT_CHAT_FIXTURE_URL:
          "http://127.0.0.1:" + server.httpServer.address().port + "/chat-fixture",
        SHAREGPT_USER_DATA: directory,
      },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.waitForFunction(
      () =>
        window.chatStore?.getState().connection === "online" &&
        window.chatStore.getState().directory.length === 2,
    );
    const input = page.getByRole("textbox", { name: "消息内容", exact: true });
    await input.fill("Room draft");
    await page.evaluate(() => window.chatStore.getState().setActiveKey("user:Bob"));
    assert.equal(await input.inputValue(), "");
    await input.fill("Private draft");
    await page.evaluate(() => window.chatStore.getState().setActiveKey(""));
    assert.equal(await input.inputValue(), "Room draft");
    await page.evaluate(() => window.switchPrincipal("alice"));
    await page.waitForFunction(() => window.chatStore.getState().connection === "online");
    assert.equal(await input.inputValue(), "");
    await input.fill("Other account");
    await page.evaluate(() => window.switchPrincipal("Alice"));
    await page.waitForFunction(() => window.chatStore.getState().connection === "online");
    assert.equal(await input.inputValue(), "Room draft");
    await page.evaluate(() => {
      window.unmountChat();
      window.mountChat();
    });
    await page.waitForFunction(() => window.chatStore.getState().connection === "online");
    assert.equal(await input.inputValue(), "Room draft");

    await page.evaluate(() => {
      window.failNextChat = true;
    });
    await input.press("Enter");
    await page.getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), "Room draft");
    assert.equal(received.filter((m) => m.type === "chat").length, 0);
    await input.press("Enter");
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    assert.equal(received.filter((m) => m.type === "chat").length, 1);

    await input.fill("Draft while editing");
    await page.getByRole("button", { name: "消息操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("textbox", { name: "编辑消息", exact: true });
    assert.equal(await edit.inputValue(), "Room draft");
    await edit.fill("Changed existing");
    await edit.press("Escape");
    assert.equal(await input.inputValue(), "Draft while editing");

    await page.evaluate(() => window.chatStore.getState().setConnection("closed"));
    await input.fill("Offline draft");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "Offline draft");
    assert.equal(await page.getByTitle("发送 (Enter)", { exact: true }).isDisabled(), true);
    assert.equal(received.filter((m) => m.type === "chat").length, 1);
    await page.screenshot({ path: path.join(directory, "offline-draft.png") });
    await page.evaluate(() => window.chatStore.getState().setConnection("online"));
    const broadcast = (payload) => {
      for (const socket of sockets.clients) socket.send(JSON.stringify(payload));
    };
    const history = Array.from({ length: 70 }, (_, i) => ({
      id: "history-" + i,
      type: "chat",
      scope: "subnet",
      from: "Bob",
      username: "Bob",
      text: "History message " + i,
      timestamp: new Date(2026, 0, 1, 12, i).toISOString(),
    }));
    broadcast({ type: "history", messages: history });
    await page.locator('[data-message-id="history-69"]').waitFor();
    const viewport = page.locator("[data-chat-scroll-viewport]");
    await viewport.evaluate((node) => {
      node.scrollTop = 300;
    });
    await page.waitForFunction(
      () => document.querySelector("[data-chat-scroll-viewport]").scrollTop === 300,
    );
    // Let the browser deliver the genuine scroll event before simulating an incoming message.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    broadcast({
      id: "live-1",
      type: "chat",
      scope: "subnet",
      from: "Bob",
      username: "Bob",
      text: "New while reading",
      timestamp: new Date().toISOString(),
    });
    const latest = page.getByRole("button", { name: "1 条新消息", exact: true });
    await latest.waitFor();
    assert.equal(await viewport.evaluate((node) => node.scrollTop), 300);
    assert.ok(
      !received.some((m) => m.type === "chat_read" && m.messageIds?.includes("live-1")),
      "offscreen messages must not be marked read",
    );
    await page.evaluate(() => window.chatStore.getState().setActiveKey("user:Bob"));
    await page.evaluate(() => window.chatStore.getState().setActiveKey(""));
    assert.equal(await viewport.evaluate((node) => node.scrollTop), 300);
    await latest.click();
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-chat-scroll-viewport]");
      return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
    });
    await latest.waitFor({ state: "hidden" });
    assert.ok(received.some((m) => m.type === "chat_read" && m.messageIds?.includes("live-1")));
    await page.screenshot({ path: path.join(directory, "reading-latest.png") });
    const receiptsBefore = received.filter((m) => m.type === "chat_read").length;
    broadcast({
      type: "chat_read",
      messages: [
        {
          ...history[69],
          readBy: [{ username: "Alice", displayName: "Alice", readAt: new Date().toISOString() }],
        },
      ],
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    assert.equal(
      received.filter((m) => m.type === "chat_read").length,
      receiptsBefore,
      "read acknowledgements must not cause a receipt loop",
    );

    await viewport.evaluate((node) => {
      node.scrollTop = 1500;
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const anchor = await page.evaluate(() => {
      const state = window.chatStore.getState();
      return state.readingPositions[state.readingActiveView];
    });
    const anchorOffset = () =>
      page.evaluate((id) => {
        const root = document.querySelector("[data-chat-scroll-viewport]");
        return (
          root.querySelector('[data-message-id="' + id + '"]').getBoundingClientRect().top -
          root.getBoundingClientRect().top
        );
      }, anchor.anchorId);
    broadcast({
      type: "chat_edit",
      message: {
        ...history[0],
        text: Array.from({ length: 20 }, () => "Expanded earlier message").join("\n"),
        edited: true,
      },
    });
    await page.getByText(/Expanded earlier message/).waitFor();
    assert.ok(
      Math.abs((await anchorOffset()) - anchor.offset) < 2,
      "earlier message height changes must preserve the reading anchor",
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.ok(
      Math.abs((await anchorOffset()) - anchor.offset) < 2,
      "resizing must preserve the reading anchor",
    );
    await page.screenshot({ path: path.join(directory, "reading-anchor-narrow.png") });

    await page.getByRole("button", { name: "回到最新", exact: true }).click();
    broadcast({
      id: "quoted",
      type: "chat",
      scope: "subnet",
      from: "Bob",
      username: "Bob",
      text: "A reply",
      timestamp: new Date().toISOString(),
      replyTo: {
        id: "history-0",
        from: "Bob",
        displayName: "Bob",
        preview: "Original message",
        timestamp: history[0].timestamp,
      },
    });
    const quoted = page.locator('[data-message-id="quoted"]');
    await quoted.waitFor();
    const beforeJump = await viewport.evaluate((node) => node.scrollTop);
    await quoted.getByRole("button", { name: /Original message/ }).click();
    const back = page.getByRole("button", { name: "返回原位置", exact: true });
    await back.waitFor();
    assert.ok((await viewport.evaluate((node) => node.scrollTop)) < beforeJump);
    await back.click();
    assert.ok(Math.abs((await viewport.evaluate((node) => node.scrollTop)) - beforeJump) < 2);
    await viewport.evaluate((node) => {
      node.scrollTop = 400;
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const laterMessage = {
      id: "live-2",
      type: "chat",
      scope: "subnet",
      from: "Bob",
      username: "Bob",
      text: "Second unread batch",
      timestamp: new Date().toISOString(),
    };
    broadcast(laterMessage);
    await latest.waitFor();
    broadcast(laterMessage);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    assert.equal(await latest.count(), 1, "a replay must not double-count unread");
    assert.equal(await page.getByRole("button", { name: "2 条新消息", exact: true }).count(), 0);
    const marker = page.getByRole("separator", { name: "未读消息", exact: true });
    assert.equal(
      await marker.evaluate(
        (node) => node.parentElement.querySelector("[data-message-id]")?.dataset.messageId,
      ),
      "live-2",
    );
    await page.screenshot({ path: path.join(directory, "new-message-indicator.png") });
    assert.deepEqual(errors, []);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        directory,
        sends: received.filter((m) => m.type === "chat").length,
      }) + "\n",
    );
  } finally {
    await app?.close();
    await server.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => backend.close(resolve));
  }
}
if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.SHAREGPT_USER_DATA);
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    const window = new BrowserWindow({
      show: false,
      width: 1000,
      height: 720,
      webPreferences: { backgroundThrottling: false },
    });
    return window.loadURL(process.env.SHAREGPT_CHAT_FIXTURE_URL);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
