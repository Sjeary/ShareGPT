const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");

// Production SenderForm with fixture identities; never starts a real proxy or changes user data.
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SenderForm } from '/src/components/panels/service/SenderForm.tsx';
import { useAppStore } from '/src/store/useAppStore.ts';
import { useAuthStore } from '/src/store/useAuthStore.ts';
import { useChatStore } from '/src/store/useChatStore.ts';
import { api } from '/src/lib/api.ts';
import '/src/index.css';
window.writes = []; window.starts = [];
api.startSender = async (payload) => { window.starts.push(payload); return {}; };
window.setRole = (role) => {
  useAuthStore.setState({profile: role === 'personal' ? null : {
    username: role, isAdmin: role === 'admin', advancedAiAllowed: role === 'advanced'
  }});
  useChatStore.setState({connection: role === 'personal' ? 'offline' : 'online'});
  useAppStore.setState({workspaceMode: role === 'personal' ? 'personal' : 'organization',
    mode: 'sender', status: {}, settings: { ui: { airport_notice_dismissed: true }, sender: {
      proxy_server: 'proxy.example.test', proxy_port: '443', proxy_uuid: 'fixture-uuid',
      socks_listen_port: '1080', fallback_mode: 'system_proxy', fallback_local_port: '7890',
      proxy_mode: 'unified', airport_outbound: { type: 'socks', server: 'node.example.test', server_port: 1080 },
      personal_proxy_host: '127.0.0.1', personal_proxy_port: '7890',
    }}, patchSection: async (section, patch) => {
      window.writes.push({section, patch});
      useAppStore.setState(state => ({settings: {...state.settings, [section]: {...state.settings[section], ...patch}}}));
    }
  });
};
window.setRole('advanced');
createRoot(document.getElementById('root')).render(<main className="bg-background text-foreground p-6"><SenderForm /></main>);
`;

async function run() {
  const { createServer } = await import(
    pathToFileURL(path.join(ROOT, "src/renderer-next/node_modules/vite/dist/node/index.js")).href
  );
  const { _electron: electron, expect } = require("playwright/test");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-proxy-readonly-"));
  const server = await createServer({
    root: path.join(ROOT, "src/renderer-next"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    plugins: [
      {
        name: "proxy-readonly-fixture",
        resolveId: (id) => (id === "/proxy-fixture.tsx" ? id : undefined),
        load: (id) => (id === "/proxy-fixture.tsx" ? source : undefined),
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/proxy-fixture") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                "/proxy-fixture",
                '<div id="root"></div><script type="module" src="/proxy-fixture.tsx"></script>',
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
        SHAREGPT_USER_DATA: directory,
        SHAREGPT_PROXY_FIXTURE_URL:
          "http://127.0.0.1:" + server.httpServer.address().port + "/proxy-fixture",
      },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const fields = [
      "s_proxy_server",
      "s_proxy_port",
      "s_proxy_uuid",
      "s_socks_listen_port",
      "s_fallback_mode",
      "s_fallback_local_port",
    ];
    await page.locator("#s_proxy_server").waitFor();
    for (const id of fields) await expect(page.locator("#" + id)).toBeDisabled();
    await expect(page.getByRole("button", { name: /统一梯子（默认）/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /机场节点/ })).toBeDisabled();
    await expect(page.locator("#s_target_domains")).toHaveJSProperty("readOnly", true);
    const start = page.getByRole("button", { name: "开启代理", exact: true });
    await expect(start).toBeEnabled();
    assert.deepEqual(await page.evaluate(() => window.writes), []);
    await page.screenshot({
      path: path.join(directory, "advanced-readonly.png"),
      animations: "disabled",
    });
    await start.click();
    await expect.poll(() => page.evaluate(() => window.starts.length)).toBe(1);
    assert.equal(await page.evaluate(() => window.starts[0].proxy_server), "proxy.example.test");

    await page.evaluate(() => window.setRole("regular"));
    await expect(page.getByText("团队托管配置", { exact: true })).toBeVisible();
    await expect(page.locator("#s_proxy_server")).toHaveCount(0);
    await expect(start).toBeEnabled();

    await page.evaluate(() => window.setRole("admin"));
    for (const id of fields) await expect(page.locator("#" + id)).toBeEnabled();
    await page.locator("#s_proxy_server").fill("admin-edit.example.test");
    await expect
      .poll(() => page.evaluate(() => window.writes.at(-1)?.patch.proxy_server))
      .toBe("admin-edit.example.test");
    await page.getByRole("button", { name: /机场节点/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.writes.at(-1)?.patch.proxy_mode))
      .toBe("airport");

    await page.evaluate(() => window.setRole("personal"));
    await expect(page.locator("#s_personal_proxy_host")).toBeEnabled();
    await expect(page.locator("#s_personal_proxy_port")).toBeEnabled();
    await expect(page.getByRole("button", { name: "HTTP", exact: true })).toBeEnabled();
    await page.locator("#s_personal_proxy_port").fill("7891");
    await expect
      .poll(() => page.evaluate(() => window.writes.at(-1)?.patch.personal_proxy_port))
      .toBe("7891");
    await expect(start).toBeEnabled();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, directory }));
  } finally {
    await app?.close();
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
      width: 900,
      height: 820,
      webPreferences: { backgroundThrottling: false },
    });
    return window.loadURL(process.env.SHAREGPT_PROXY_FIXTURE_URL);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
