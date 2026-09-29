const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixtureServer, launchCase } = require("./verify-collab-login-compatibility");

const TLS_ERROR = "Client network socket disconnected before secure TLS connection was established";
const SCREENSHOT = path.resolve(__dirname, "../.cache/error-feedback/translation-tls.png");

async function main() {
  const fixture = await createFixtureServer();
  const username = "error-feedback";
  try {
    const result = await launchCase({
      ...fixture,
      username,
      beforeLogin: async ({ electronApp, window }) => {
        await electronApp.evaluate(({ BrowserWindow }) => {
          globalThis.__feedbackWindowEvents = [];
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isVisible() || win.isFocused() || win.isFocusable()) {
              throw new Error("Acceptance must remain hidden and unfocusable");
            }
            for (const event of ["show", "focus"]) {
              win.on(event, () => globalThis.__feedbackWindowEvents.push(event));
            }
          }
        });
        await window.locator("#account-server").fill(fixture.baseUrl);
        await window.locator("#account-username").fill(username);
        await window.locator("#account-password").fill("wrong-password");
        const submit = window.getByRole("button", { name: "登录", exact: true });
        const notice = window.getByRole("alert", { name: "登录与工作区错误" });

        await window.route(
          `${fixture.baseUrl}/api/login`,
          (route) => route.abort("connectionrefused"),
          { times: 1 },
        );
        await submit.click();
        await notice.getByText("暂时无法连接服务", { exact: true }).waitFor();
        assert.equal(await window.locator("#account-password").getAttribute("aria-invalid"), null);
        assert.equal(await window.locator("#account-server").getAttribute("aria-invalid"), "true");
        assert.equal(await window.locator("#account-password").inputValue(), "wrong-password");

        await submit.click();
        await notice.getByText("身份验证未通过", { exact: true }).waitFor();
        assert.equal(
          await window.locator("#account-password").getAttribute("aria-invalid"),
          "true",
        );
        assert.equal(await window.locator("#account-server").getAttribute("aria-invalid"), null);

        fixture.failNextLogin(username);
        await submit.click();
        await notice.getByText("服务暂时不可用", { exact: true }).waitFor();
        assert.equal(await window.locator("#account-password").getAttribute("aria-invalid"), null);
        assert.equal(await window.locator("#account-server").getAttribute("aria-invalid"), null);
      },
      exercise: async ({ electronApp, window }) => {
        assert.equal(await window.getByRole("alert", { name: "登录与工作区错误" }).count(), 0);
        // Exercise the real preload/IPC rejection and UI; no external provider is contacted.
        await electronApp.evaluate(({ ipcMain }, message) => {
          const original = ipcMain._invokeHandlers.get("translation:translate");
          globalThis.__feedbackRestoreTranslation = () => {
            ipcMain.removeHandler("translation:translate");
            ipcMain.handle("translation:translate", original);
          };
          globalThis.__feedbackTranslationError = message;
          ipcMain.removeHandler("translation:translate");
          ipcMain.handle("translation:translate", () => {
            if (globalThis.__feedbackTranslationError)
              throw new Error(globalThis.__feedbackTranslationError);
            return { translatedText: "连接恢复后的译文" };
          });
        }, `${TLS_ERROR}\nhttps://fixture-user:fixture-password@translation.example.test/private/path?api_key=fixture-key&token=fixture-token\nAuthorization: Bearer fixture-bearer`);
        try {
          // Verify copy behavior without changing the user's system clipboard.
          await window.evaluate(() => {
            Object.defineProperty(navigator.clipboard, "writeText", {
              configurable: true,
              value: async (value) => {
                if (window.__feedbackCopyFails) throw new Error("fixture clipboard unavailable");
                window.__feedbackCopied = value;
              },
            });
          });
          await window.locator('[data-tour="nav-gpt"]').click();
          await window.getByRole("button", { name: "打开翻译侧栏", exact: true }).click();
          const panel = window.getByRole("complementary", { name: "翻译工作台" });
          await panel.getByRole("button", { name: "翻译设置", exact: true }).click();
          await panel.getByLabel("翻译服务", { exact: true }).selectOption("api");
          await panel
            .getByLabel("翻译 API 地址", { exact: true })
            .fill("https://translation.example.test");
          await panel.getByRole("button", { name: "翻译设置", exact: true }).click();
          await panel.getByLabel("待翻译原文", { exact: true }).fill("Hello");
          const translate = panel.getByRole("button", { name: "翻译", exact: true });
          await translate.click();
          const notice = panel.getByRole("alert", { name: "阅读翻译错误" });
          await notice.getByText("安全连接中断", { exact: true }).waitFor();
          assert.equal(await notice.locator("details").getAttribute("open"), null);
          assert.equal(await notice.locator("pre").isVisible(), false);
          await notice.getByText("查看技术详情", { exact: true }).click();
          const details = await notice.locator("pre").innerText();
          assert.ok(details.includes(TLS_ERROR));
          assert.ok(details.includes("translation.example.test"));
          assert.doesNotMatch(
            details,
            /fixture-user|fixture-password|fixture-key|fixture-token|fixture-bearer|private\/path|Error invoking remote method/,
          );
          await window.evaluate(() => {
            window.__feedbackCopyFails = true;
          });
          await notice.getByRole("button", { name: "复制技术详情", exact: true }).click();
          await notice.getByText("复制失败，请选中上方详情手动复制。", { exact: true }).waitFor();
          await window.evaluate(() => {
            window.__feedbackCopyFails = false;
          });
          await notice.getByRole("button", { name: "复制技术详情", exact: true }).click();
          await notice.getByRole("button", { name: "已复制", exact: true }).waitFor();
          assert.equal(await window.evaluate(() => window.__feedbackCopied), details);

          await electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].setSize(860, 620),
          );
          await window.waitForFunction(() => innerWidth === 860);
          const layout = await notice.evaluate((node) => ({
            width: node.clientWidth,
            content: node.scrollWidth,
          }));
          assert.ok(layout.width > 0 && layout.content <= layout.width + 1, JSON.stringify(layout));
          fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
          await window
            .getByText("登录成功，欢迎 error-feedback", { exact: true })
            .waitFor({ state: "hidden" });
          await notice.scrollIntoViewIfNeeded();
          await notice.screenshot({ path: SCREENSHOT });

          await electronApp.evaluate(() => {
            globalThis.__feedbackTranslationError = "";
          });
          await translate.click();
          await panel
            .getByLabel("阅读译文", { exact: true })
            .filter({ hasText: "连接恢复后的译文" })
            .waitFor();
          assert.equal(await panel.getByRole("alert", { name: "阅读翻译错误" }).count(), 0);
          const windowState = await electronApp.evaluate(({ BrowserWindow }) => ({
            events: globalThis.__feedbackWindowEvents,
            windows: BrowserWindow.getAllWindows().map((win) => ({
              visible: win.isVisible(),
              focused: win.isFocused(),
              focusable: win.isFocusable(),
            })),
          }));
          assert.deepEqual(windowState.events, []);
          assert.ok(
            windowState.windows.every((win) => !win.visible && !win.focused && !win.focusable),
          );
          return {
            networkLogin: true,
            credentialLogin: true,
            serverLogin: true,
            recoveredLogin: true,
            tlsIpc: true,
            redactedCopy: true,
            clipboardFailure: true,
            narrowLayout: layout,
            recoveredTranslation: true,
            windowState,
            screenshot: SCREENSHOT,
          };
        } finally {
          await electronApp.evaluate(() => globalThis.__feedbackRestoreTranslation());
        }
      },
    });
    console.log(JSON.stringify({ ok: true, ...result.exerciseResult }, null, 2));
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
