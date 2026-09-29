const assert = require("node:assert/strict");
const { createFixtureServer, launchCase } = require("./verify-collab-login-compatibility");

async function main() {
  const fixture = await createFixtureServer();
  try {
    await launchCase({
      ...fixture,
      username: "notes-ai-fixture",
      beforeLogin: async ({ electronApp }) => {
        await electronApp.evaluate(({ BrowserWindow }) => {
          globalThis.__notesAiForeground = [];
          for (const window of BrowserWindow.getAllWindows()) {
            if (window.isVisible() || window.isFocused() || window.isFocusable()) {
              throw new Error("Notes AI acceptance must stay hidden and unfocusable");
            }
            for (const event of ["show", "focus"]) {
              window.on(event, () => globalThis.__notesAiForeground.push(event));
            }
          }
        });
      },
      exercise: async ({ electronApp, window }) => {
        const pageErrors = [];
        window.on("pageerror", (error) => pageErrors.push(error.message));
        await window.evaluate(() =>
          window.api.vault.create("notes-ai-a.md", "# NOTES-A\nBody A\n"),
        );
        await window.locator('[data-tour="nav-account"]').click();
        await window.locator("#ui-show-notes").click();
        await window.locator('[data-tour="nav-notes"]').click();
        await window.getByText("NOTES-A", { exact: true }).first().click();
        await window.getByRole("button", { name: "编辑", exact: true }).click();
        await window.locator(".cm-content").first().waitFor();
        if (!(await window.getByRole("button", { name: "AI", exact: true }).isVisible())) {
          await window.getByTitle("信息栏", { exact: true }).click();
        }
        await window.getByRole("button", { name: "AI", exact: true }).click();
        await window.getByLabel("接口地址", { exact: true }).fill("https://ai.example.invalid");
        await window.getByLabel("API Key", { exact: true }).fill("fixture-only-key");
        await window.getByRole("button", { name: "保存", exact: true }).click();
        await window.getByRole("button", { name: "总结", exact: true }).waitFor();
        const saved = await window.evaluate(async () => {
          const principal = await window.api.getSettingsPrincipal();
          return window.api.loadSettings({
            expectedPrincipalId: principal.principalId,
            expectedPrincipalGeneration: principal.generation,
          });
        });
        assert.equal(saved.translation.ai.baseUrl, "https://ai.example.invalid");
        assert.equal(saved.translation.ai.apiKey, "fixture-only-key");

        await electronApp.evaluate(({ ipcMain }) => {
          const original = ipcMain._invokeHandlers.get("settings:operate");
          ipcMain.removeHandler("settings:operate");
          ipcMain.handle("settings:operate", (event, payload, ...args) => {
            if (payload?.section === "translation") throw new Error("fixture 保存失败");
            return original(event, payload, ...args);
          });
        });
        await window.getByTitle("AI 设置", { exact: true }).click();
        await window.getByRole("button", { name: "保存", exact: true }).click();
        await window.getByRole("alert", { name: "保存 AI 配置错误" }).waitFor();
        assert.equal(
          await window.getByRole("button", { name: "保存", exact: true }).isEnabled(),
          true,
        );
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(await electronApp.evaluate(() => globalThis.__notesAiForeground), []);
        process.stdout.write(
          "[verify] Notes AI settings save after login and report failures without foreground events\n",
        );
      },
    });
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
