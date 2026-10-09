const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createFixtureServer, launchCase } = require("./verify-collab-login-compatibility");

async function main() {
  const windows = process.platform === "win32";
  if (windows && process.env.GITHUB_ACTIONS !== "true")
    throw new Error("PowerShell UI acceptance requires a disposable GitHub runner.");
  const shellConfig = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-terminal-shell-"));
  fs.writeFileSync(
    path.join(shellConfig, ".zshrc"),
    "unset HISTFILE\nPROMPT='fixture> '\nexport TERMINAL_RC_FIXTURE=loaded\n",
  );
  const launchEnv = windows
    ? { TERMINAL_RC_FIXTURE: "loaded" }
    : { SHELL: "/bin/zsh", ZDOTDIR: shellConfig };
  const prompt = windows ? "PS " : "fixture> ";
  const startupCommand = windows
    ? "$env:TERMINAL_STARTUP_FIXTURE='once'"
    : "export TERMINAL_STARTUP_FIXTURE=once";
  const printVariable = (prefix, variable) =>
    windows
      ? `Write-Output ('${prefix}_' + $env:${variable})`
      : `printf '\\n${prefix}_%s\\n' "$${variable}"`;
  let allowed = true;
  let administrator = false;
  const fixture = await createFixtureServer({
    profileFor: () => ({ isAdmin: administrator, advancedAiAllowed: allowed }),
  });
  try {
    await launchCase({
      ...fixture,
      username: "terminal-approved",
      launchEnv,
      beforeLogin: async ({ electronApp, window }) => {
        await electronApp.evaluate(({ BrowserWindow }) => {
          globalThis.__terminalForeground = [];
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isVisible() || win.isFocusable() || win.isFocused())
              throw new Error("Terminal verification must remain hidden");
            for (const event of ["show", "focus"])
              win.on(event, () => globalThis.__terminalForeground.push(event));
          }
        });
        await window.evaluate(() => {
          window.__terminalEvents = [];
          window.api.onTerminalEvent((event) => window.__terminalEvents.push(event));
        });
        await assert.rejects(
          window.evaluate(async () =>
            window.api.terminal("create", {}, await window.api.getSettingsPrincipal()),
          ),
          /账号/,
        );
      },
      exercise: async ({ electronApp, window, userDataDir }) => {
        const errors = [];
        window.on("pageerror", (e) => errors.push(e.message));
        const nav = window.locator('[data-tour="nav-terminal"]');
        await window.locator('[data-tour="nav-account"]').click();
        await window.locator("#advanced-ai-environments").waitFor();
        assert.equal(
          await window.locator("#ui-show-terminal").getAttribute("aria-checked"),
          "true",
        );
        if (
          (await window.locator("#advanced-ai-environments").getAttribute("aria-checked")) ===
          "true"
        )
          await window.locator("#advanced-ai-environments").click();
        assert.equal(await nav.innerText(), "终端\n本机终端");
        await nav.click();
        await window.getByRole("button", { name: "打开本地终端", exact: true }).click();
        const input = () => window.locator('[data-state="active"] .xterm-helper-textarea');
        await input().waitFor({ state: "attached" });
        await window.waitForFunction(
          (ready) =>
            window.__terminalEvents
              .map((e) => e.data || "")
              .join("")
              .includes(ready),
          prompt,
        );
        await input().pressSequentially(printVariable("READY", "TERMINAL_RC_FIXTURE"));
        await input().press("Enter");
        await window.waitForFunction(() =>
          window.__terminalEvents
            .map((e) => e.data || "")
            .join("")
            .includes("READY_loaded"),
        );
        const first = await window.evaluate(
          () => window.__terminalEvents.find((e) => e.type === "data").id,
        );
        await window.locator('[data-tour="nav-account"]').click();
        await nav.click();
        assert.equal(await window.getByRole("tab").count(), 1);
        await input().pressSequentially(
          windows ? "$env:KEEP_SESSION='kept'" : "export KEEP_SESSION=kept",
        );
        await input().press("Enter");
        await window.getByRole("button", { name: "新建终端", exact: true }).click();
        await window.getByRole("tab").nth(1).waitFor();
        assert.equal(await window.getByRole("tab").count(), 2);
        await window.getByRole("tab").first().click();
        await input().pressSequentially(printVariable("STATE", "KEEP_SESSION"));
        await input().press("Enter");
        await window.waitForFunction(() =>
          window.__terminalEvents
            .map((e) => e.data || "")
            .join("")
            .includes("STATE_kept"),
        );
        await input().pressSequentially(windows ? "Start-Sleep -Seconds 30" : "sleep 30");
        await input().press("Enter");
        await input().press("Control+c");
        await input().pressSequentially(
          windows ? "Write-Output ('CTRL_C_' + 'OK')" : "printf '\\n%s%s\\n' CTRL_C_ OK",
        );
        await input().press("Enter");
        await window.waitForFunction(() =>
          window.__terminalEvents
            .map((e) => e.data || "")
            .join("")
            .includes("CTRL_C_OK"),
        );
        await window.getByRole("button", { name: "启动设置", exact: true }).click();
        await window.getByLabel("启动指令（可选）").fill(startupCommand);
        await window.getByRole("button", { name: "保存", exact: true }).click();
        await window.getByRole("button", { name: "新建终端", exact: true }).click();
        await window.getByRole("tab").nth(2).waitFor();
        await window.waitForFunction((ready) => {
          const streams = new Map();
          for (const e of window.__terminalEvents)
            if (e.type === "data") streams.set(e.id, (streams.get(e.id) || "") + e.data);
          return streams.size === 3 && [...streams.values()].every((s) => s.includes(ready));
        }, prompt);
        await input().pressSequentially(printVariable("START", "TERMINAL_STARTUP_FIXTURE"));
        await input().press("Enter");
        await window.waitForFunction(() =>
          window.__terminalEvents
            .map((e) => e.data || "")
            .join("")
            .includes("START_once"),
        );
        const screenshots = path.resolve(__dirname, "../.cache/terminal-20261009/screenshots");
        fs.mkdirSync(screenshots, { recursive: true });
        await window.screenshot({ path: path.join(screenshots, "terminal.png") });
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(860, 680),
        );
        await window.waitForTimeout(100);
        assert.equal(
          await window.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          ),
          false,
        );
        await window.screenshot({ path: path.join(screenshots, "terminal-narrow.png") });
        await window.locator('button[aria-label="切换主题"]').click();
        await window.waitForTimeout(100);
        await window.screenshot({ path: path.join(screenshots, "terminal-light.png") });
        await assert.rejects(
          window.evaluate(async () => {
            const snapshot = await window.api.getSettingsPrincipal();
            return window.api.terminal(
              "write",
              { id: "any", data: "ls" },
              { ...snapshot, generation: snapshot.generation - 1 },
            );
          }),
          /账号/,
        );
        assert.equal(
          await electronApp.evaluate(async ({ BrowserWindow, ipcMain }) => {
            const rogue = new BrowserWindow({
              show: false,
              focusable: false,
              webPreferences: { sandbox: true, nodeIntegration: false },
            });
            try {
              await rogue.loadURL("data:text/html,untrusted");
              try {
                await ipcMain._invokeHandlers.get("terminal:invoke")(
                  { sender: rogue.webContents, senderFrame: rogue.webContents.mainFrame },
                  "create",
                  {},
                  {},
                );
                return false;
              } catch (e) {
                return /无权/.test(e.message);
              }
            } finally {
              rogue.destroy();
            }
          }),
          true,
        );
        await window.locator('[data-tour="nav-account"]').click();
        const interfaceCard = window
          .getByText("界面设置", { exact: true })
          .locator("xpath=ancestor::*[@data-slot='card'][1]");
        await interfaceCard.screenshot({
          path: path.join(screenshots, "account-terminal-light.png"),
        });
        await window.locator('button[aria-label="切换主题"]').click();
        await interfaceCard.screenshot({
          path: path.join(screenshots, "account-terminal-dark.png"),
        });
        await window.locator("#ui-show-terminal").click();
        await nav.waitFor({ state: "detached" });
        await window.waitForFunction(() => document.querySelectorAll(".xterm").length === 0);
        await assert.rejects(
          window.evaluate(
            async (id) =>
              window.api.terminal(
                "write",
                { id, data: "ignored" },
                await window.api.getSettingsPrincipal(),
              ),
            first,
          ),
          /权限/,
        );
        assert.equal(
          await window.evaluate(async () => {
            const principal = await window.api.getSettingsPrincipal();
            const settings = await window.api.loadSettings({
              expectedPrincipalId: principal.principalId,
              expectedPrincipalGeneration: principal.generation,
            });
            return settings.ui.hiddenNav.includes("terminal");
          }),
          true,
        );
        await window.locator("#ui-show-terminal").click();
        await nav.click();
        await window.getByRole("button", { name: "打开本地终端", exact: true }).waitFor();
        assert.equal(await window.getByRole("tab").count(), 0, "disabling ends old sessions");
        await window.getByRole("button", { name: "启动设置", exact: true }).click();
        assert.equal(await window.getByLabel("启动指令（可选）").inputValue(), startupCommand);
        await window.getByRole("button", { name: "保存", exact: true }).click();
        await window.getByRole("button", { name: "打开本地终端", exact: true }).click();
        await input().waitFor({ state: "attached" });
        allowed = false;
        await window
          .getByRole("button", { name: "重新验证权限", exact: true })
          .waitFor({ timeout: 18000 });
        assert.equal(await window.locator(".xterm").count(), 0);
        await assert.rejects(
          window.evaluate(
            async (id) =>
              window.api.terminal(
                "write",
                { id, data: "ls\r" },
                await window.api.getSettingsPrincipal(),
              ),
            first,
          ),
          /权限/,
        );
        const principal = await window.evaluate(() => window.api.getSettingsPrincipal());
        assert.equal(
          JSON.parse(
            fs.readFileSync(
              path.join(userDataDir, "PrincipalData", principal.principalId, "terminal.json"),
              "utf8",
            ),
          ).startupCommand,
          startupCommand,
        );
        assert.deepEqual(await electronApp.evaluate(() => globalThis.__terminalForeground), []);
        assert.deepEqual(errors, []);
        console.log(
          JSON.stringify({
            localShell: true,
            rcLoaded: !windows,
            inheritedEnvironment: true,
            platform: process.platform,
            tabContinuity: true,
            interrupt: true,
            startup: true,
            remoteIpcRejected: true,
            stalePrincipalRejected: true,
            revocation: true,
            foreground: [],
          }),
        );
      },
    });
    for (const isAdmin of [false, true]) {
      administrator = isAdmin;
      await launchCase({
        ...fixture,
        username: isAdmin ? "terminal-admin" : "terminal-regular",
        launchEnv,
        exercise: async ({ window }) => {
          await window.locator('[data-tour="nav-account"]').click();
          assert.equal(await window.locator("#advanced-ai-environments").count(), isAdmin ? 1 : 0);
          assert.equal(await window.locator("#ui-show-terminal").count(), isAdmin ? 1 : 0);
          assert.equal(await window.locator('[data-tour="nav-terminal"]').count(), isAdmin ? 1 : 0);
          if (isAdmin) {
            await window.locator('[data-tour="nav-terminal"]').click();
            await window.getByRole("button", { name: "打开本地终端", exact: true }).click();
            await window.locator(".xterm-helper-textarea").waitFor({ state: "attached" });
          }
        },
      });
    }
  } finally {
    await fixture.close();
    fs.rmSync(shellConfig, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
