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
        await window.evaluate(() =>
          window.api.vault.create("notes-ai-b.md", "# NOTES-B\nBody B\n"),
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
          globalThis.__notesAiRequests = [];
          globalThis.__notesAiCancelled = [];
          ipcMain.removeHandler("notes-ai:complete");
          ipcMain.handle("notes-ai:complete", (event, request) => {
            const streamId = `fixture-${globalThis.__notesAiRequests.length + 1}`;
            globalThis.__notesAiRequests.push({ ...request, streamId, sender: event.sender });
            return { streamId, principalId: request.principalId };
          });
          ipcMain.removeHandler("notes-ai:cancel");
          ipcMain.handle("notes-ai:cancel", (_event, id) => {
            globalThis.__notesAiCancelled.push(id);
            return { ok: true };
          });
        });
        const emit = (index, payload) =>
          electronApp.evaluate(
            (_electron, { index, payload }) => {
              const request = globalThis.__notesAiRequests[index];
              request.sender.send("notes-ai:event", {
                streamId: request.streamId,
                principalId: request.principalId,
                ...payload,
              });
            },
            { index, payload },
          );
        const waitRequests = async (count) => {
          for (let i = 0; i < 40; i++) {
            if ((await electronApp.evaluate(() => globalThis.__notesAiRequests.length)) === count)
              return;
            await window.waitForTimeout(25);
          }
          throw new Error(`Expected ${count} Notes AI requests`);
        };
        const openInline = async () => {
          const editor = window.locator(".cm-content").first();
          await editor.click();
          await editor.press("ControlOrMeta+a");
          await editor.press("ControlOrMeta+k");
          return window.getByPlaceholder("如何修改这段…（改写/翻译/精简/扩写/列点…）");
        };
        let instruction = await openInline();
        await instruction.fill("rewrite A");
        await instruction.press("Enter");
        await waitRequests(1);
        await instruction.press("Escape");
        await window.getByText("NOTES-B", { exact: true }).first().click();
        instruction = await openInline();
        await emit(0, { type: "delta", text: "OLD-A-MUST-NOT-APPEAR" });
        await emit(0, { type: "done" });
        await window.waitForTimeout(50);
        assert.equal(await window.getByText("OLD-A-MUST-NOT-APPEAR", { exact: true }).count(), 0);
        assert.equal(await window.getByRole("button", { name: "保留", exact: true }).count(), 0);
        await instruction.fill("rewrite B");
        await instruction.press("Enter");
        await waitRequests(2);
        await emit(0, { type: "delta", text: "LATE-A" });
        await emit(1, { type: "delta", text: "# NOTES-B\nNEW-B-ONLY\n" });
        await emit(1, { type: "done" });
        await window.getByRole("button", { name: "保留", exact: true }).click();
        const bodyB = await window.locator(".cm-content").first().innerText();
        assert.match(bodyB, /NEW-B-ONLY/);
        assert.doesNotMatch(bodyB, /LATE-A|OLD-A/);
        assert.ok(
          (await electronApp.evaluate(() => globalThis.__notesAiCancelled)).includes("fixture-1"),
        );

        await window.getByRole("button", { name: "总结", exact: true }).click();
        await waitRequests(3);
        await window.getByText("NOTES-A", { exact: true }).first().click();
        await emit(2, { type: "delta", text: "OLD-B-SIDEBAR" });
        await emit(2, { type: "done" });
        await window.waitForTimeout(50);
        assert.equal(await window.getByText("OLD-B-SIDEBAR", { exact: true }).count(), 0);
        assert.equal(
          await window.getByRole("button", { name: "总结", exact: true }).isEnabled(),
          true,
        );

        await window.getByRole("button", { name: "总结", exact: true }).click();
        await waitRequests(4);
        await emit(3, { type: "delta", text: "PARTIAL-STOPPED" });
        await window.getByRole("button", { name: "停止", exact: true }).click();
        assert.equal(
          await window.getByRole("button", { name: "总结", exact: true }).isEnabled(),
          true,
        );
        assert.equal(
          await window.getByRole("button", { name: "插入文末", exact: true }).count(),
          0,
        );
        await emit(3, { type: "done" });
        await window.getByRole("button", { name: "总结", exact: true }).click();
        await waitRequests(5);
        await emit(4, { type: "delta", text: "RESTARTED-RESULT" });
        await emit(4, { type: "done" });
        await window.getByText("RESTARTED-RESULT", { exact: true }).waitFor();

        const providerError =
          "Client network socket disconnected before secure TLS connection was established https://user:fixture-password@example.test/path?api_key=fixture-secret Authorization: Bearer fixture-bearer-secret";
        const checkError = async (context) => {
          const notice = window.getByRole("alert", { name: `${context}错误` });
          await notice.waitFor();
          assert.equal(await notice.getAttribute("data-error-category"), "connection");
          assert.match(await notice.locator("summary").innerText(), /安全连接中断/);
          assert.equal(await notice.locator("details").getAttribute("open"), null);
          await notice.locator("summary").click();
          const details = await notice.locator("pre").innerText();
          assert.match(details, /TLS/);
          assert.doesNotMatch(details, /fixture-password|fixture-secret|fixture-bearer-secret/);
          assert.equal(
            await notice.getByRole("button", { name: "复制技术详情", exact: true }).isVisible(),
            true,
          );
        };
        await window.getByRole("button", { name: "总结", exact: true }).click();
        await waitRequests(6);
        await emit(5, { type: "error", message: providerError });
        await checkError("笔记 AI");
        instruction = await openInline();
        await instruction.fill("fail inline");
        await instruction.press("Enter");
        await waitRequests(7);
        await emit(6, { type: "error", message: providerError });
        await checkError("内联 AI 编辑");
        await instruction.press("Escape");
        await window.getByRole("button", { name: "图谱", exact: true }).click();
        await window.getByRole("button", { name: "AI 连线", exact: true }).click();
        await waitRequests(8);
        await emit(7, { type: "error", message: providerError });
        await checkError("AI 自动连线");
        await window.getByText("AI 自动连线", { exact: true }).getByRole("button").click();
        await window.getByRole("button", { name: "编辑", exact: true }).click();

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
          "[verify] Notes AI settings, document isolation, cancellation and redacted errors passed without foreground events\n",
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
