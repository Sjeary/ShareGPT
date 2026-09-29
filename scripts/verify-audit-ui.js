const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixtureServer, launchCase } = require("./verify-collab-login-compatibility");
const { maxTextLength } = require("../collab_server2/chat_limits.json");

const SCREENSHOTS = path.resolve(__dirname, "../.cache/audit-ui-acceptance");

async function main() {
  const fixture = await createFixtureServer();
  let calendarUnavailable = true;
  const now = new Date();
  const event = {
    id: "recovered-team-event",
    title: "Recovered team calendar",
    start: now.toISOString(),
    end: new Date(now.getTime() + 3600000).toISOString(),
    allDay: false,
    organizer: "audit-ui",
    attendees: [],
    subnetKey: "fixture",
    createdBy: "audit-ui",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  try {
    const result = await launchCase({
      ...fixture,
      username: "audit-ui",
      beforeLogin: async ({ electronApp, window }) => {
        const profilePaths = await electronApp.evaluate(({ app }) => ({
          expected: process.env.SHAREGPT_USER_DATA,
          userData: app.getPath("userData"),
          sessionData: app.getPath("sessionData"),
        }));
        assert.ok(profilePaths.expected);
        const expectedProfile = fs.realpathSync(profilePaths.expected);
        assert.equal(fs.realpathSync(profilePaths.userData), expectedProfile);
        assert.equal(fs.realpathSync(profilePaths.sessionData), expectedProfile);
        await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
          if (process.env.SHAREGPT_BACKGROUND_TEST !== "1" || !process.env.SHAREGPT_USER_DATA)
            throw new Error("Requires an isolated background profile before application entry");
          globalThis.__auditUi = { windowEvents: [], focusUnavailable: true, focusWrites: 0 };
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isVisible() || win.isFocused() || win.isFocusable())
              throw new Error("Acceptance window must remain hidden and unfocusable");
            for (const event of ["show", "focus"])
              win.on(event, () => globalThis.__auditUi.windowEvents.push(event));
          }
          const loadFocus = ipcMain._invokeHandlers.get("focus:load");
          const saveFocus = ipcMain._invokeHandlers.get("focus:save");
          ipcMain.removeHandler("focus:load");
          ipcMain.handle("focus:load", (event, ...args) => {
            if (globalThis.__auditUi.focusUnavailable)
              throw new Error("fixture focus file unreadable");
            return loadFocus(event, ...args);
          });
          ipcMain.removeHandler("focus:save");
          ipcMain.handle("focus:save", (event, ...args) => {
            globalThis.__auditUi.focusWrites += 1;
            return saveFocus(event, ...args);
          });
        });
        await window.evaluate(() => {
          window.__auditChatWrites = [];
          const original = WebSocket.prototype.send;
          WebSocket.prototype.send = function (raw) {
            try {
              const message = JSON.parse(String(raw));
              if (message.type === "chat" || message.type === "chat_edit")
                window.__auditChatWrites.push(message);
            } catch {
              /* Only JSON chat frames are part of this acceptance. */
            }
            return original.call(this, raw);
          };
        });
        await window.route("**/api/team-calendar/events", (route) =>
          route.fulfill({
            status: calendarUnavailable ? 503 : 200,
            contentType: "application/json",
            body: JSON.stringify(
              calendarUnavailable ? { error: "fixture calendar unavailable" } : { events: [event] },
            ),
          }),
        );
      },
      exercise: async ({ electronApp, window }) => {
        assert.equal(
          await window.evaluate(() =>
            window.api.showSystemNotification({ title: "suppressed acceptance notification" }),
          ),
          false,
        );
        await window.locator('[data-tour="nav-account"]').click();
        for (const key of ["focus", "team"]) {
          const toggle = window.locator(`#ui-show-${key}`);
          if ((await toggle.getAttribute("data-state")) !== "checked") await toggle.click();
          await window.waitForFunction(async (nav) => {
            const principal = await window.api.getSettingsPrincipal();
            const settings = await window.api.loadSettings({
              expectedPrincipalId: principal.principalId,
              expectedPrincipalGeneration: principal.generation,
            });
            return !settings.ui.hiddenNav.includes(nav);
          }, key);
        }
        await window.locator('[data-tour="nav-focus"]').click();
        await window.getByRole("alert").filter({ hasText: "无法读取专注资料" }).waitFor();
        assert.equal(await window.getByRole("button", { name: "开始", exact: true }).count(), 0);
        assert.equal(await electronApp.evaluate(() => globalThis.__auditUi.focusWrites), 0);
        await window.screenshot({
          animations: "disabled",
          path: path.join(SCREENSHOTS, "focus-unreadable-dark.png"),
        });
        await window.getByRole("button", { name: "切换主题", exact: true }).click();
        await window.screenshot({
          animations: "disabled",
          path: path.join(SCREENSHOTS, "focus-unreadable-light.png"),
        });
        await electronApp.evaluate(() => {
          globalThis.__auditUi.focusUnavailable = false;
        });
        await window.getByRole("button", { name: "重新加载", exact: true }).click();
        await window.getByRole("button", { name: "开始", exact: true }).waitFor();
        assert.equal(
          await window.getByRole("alert").filter({ hasText: "无法读取专注资料" }).count(),
          0,
        );

        await window.locator('[data-tour="nav-team"]').click();
        const error = window.getByRole("alert", { name: "组队日历加载失败错误" });
        await error.getByText("服务暂时不可用", { exact: true }).waitFor();
        await error.locator("summary").click();
        assert.match(await error.innerText(), /503/);
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(860, 620),
        );
        await window.waitForFunction(() => innerWidth === 860);
        const layout = await error.evaluate((node) => ({
          width: node.clientWidth,
          content: node.scrollWidth,
        }));
        assert.ok(layout.width > 0 && layout.content <= layout.width + 1, JSON.stringify(layout));
        await window.screenshot({
          animations: "disabled",
          path: path.join(SCREENSHOTS, "team-unavailable-light-narrow.png"),
        });
        await window.getByRole("button", { name: "切换主题", exact: true }).click();
        await window.screenshot({
          animations: "disabled",
          path: path.join(SCREENSHOTS, "team-unavailable-dark-narrow.png"),
        });
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setSize(1180, 760),
        );
        await window.waitForFunction(() => innerWidth === 1180);
        calendarUnavailable = false;
        await window.getByRole("button", { name: "重新加载", exact: true }).click();
        await window.getByText(event.title, { exact: true }).first().waitFor();
        assert.equal(await error.count(), 0);

        await window.locator('[data-tour="nav-chat"]').click();
        const composer = window.getByRole("textbox", { name: "消息内容", exact: true });
        const oversized = "x".repeat(maxTextLength + 1);
        await composer.fill(oversized);
        await composer.press("Enter");
        await window.getByText(/消息不能超过 8000 个字符/).waitFor();
        assert.equal(await composer.inputValue(), oversized);
        assert.equal(await window.evaluate(() => window.__auditChatWrites.length), 0);
        await window.screenshot({
          animations: "disabled",
          path: path.join(SCREENSHOTS, "chat-overflow-dark.png"),
        });
        await composer.fill("x".repeat(maxTextLength));
        await composer.press("Enter");
        await window.waitForFunction(() => window.__auditChatWrites.length === 1);
        assert.equal(await composer.inputValue(), "");
        assert.equal(
          await window.evaluate(() => window.__auditChatWrites[0].text.length),
          maxTextLength,
        );
        const visibility = await electronApp.evaluate(({ BrowserWindow }) => ({
          events: globalThis.__auditUi.windowEvents,
          windows: BrowserWindow.getAllWindows().map((win) => ({
            visible: win.isVisible(),
            focused: win.isFocused(),
            focusable: win.isFocusable(),
          })),
        }));
        assert.deepEqual(visibility.events, []);
        assert.ok(
          visibility.windows.every((win) => !win.visible && !win.focused && !win.focusable),
        );
        return {
          focusRetry: true,
          team503Retry: true,
          oversizedDraftPreserved: true,
          boundarySentUnchanged: true,
          visibility,
        };
      },
    });
    assert.deepEqual(result.blockedRequests, []);
    console.log(JSON.stringify({ ...result.exerciseResult, screenshots: SCREENSHOTS }, null, 2));
  } finally {
    await fixture.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
