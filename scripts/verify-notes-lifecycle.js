const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createFixtureServer, launchCase } = require("./verify-collab-login-compatibility");

async function main() {
  const fixture = await createFixtureServer();
  try {
    const result = await launchCase({
      ...fixture,
      username: "notes-lifecycle",
      exercise: async ({ electronApp, window, userDataDir }) => {
        const errors = [];
        window.on("pageerror", (error) => errors.push(error.message));
        await electronApp.evaluate(({ BrowserWindow }) => {
          globalThis.__notesForeground = [];
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isVisible() || win.isFocused() || win.isFocusable())
              throw new Error("Notes acceptance must stay hidden");
            for (const event of ["show", "focus"])
              win.on(event, () => globalThis.__notesForeground.push(event));
          }
        });
        await window.evaluate(() => window.api.vault.create("note.md", "# ORIGINAL\nold body\n"));
        await window.locator('[data-tour="nav-account"]').click();
        await window.locator("#ui-show-notes").click();
        await window.locator('[data-tour="nav-notes"]').click();
        await window.getByText("ORIGINAL", { exact: true }).first().click();
        await window.getByRole("button", { name: "编辑", exact: true }).click();
        const editor = window.locator(".cm-content").first();
        await editor.waitFor();
        const root = fs.realpathSync(await window.evaluate(() => window.api.vault.getRoot()));
        assert.ok(root.startsWith(fs.realpathSync(userDataDir) + path.sep));
        // Wait out main's own-write watcher echo suppression before the external editor writes.
        await window.waitForTimeout(1800);
        fs.writeFileSync(path.join(root, "note.md"), "# EXTERNAL\nnew remote body\n");
        await window.getByText("EXTERNAL", { exact: true }).first().waitFor();
        assert.match(await editor.innerText(), /new remote body/);
        await editor.click();
        await editor.press("ControlOrMeta+End");
        await editor.press("Enter");
        await editor.pressSequentially("local input");
        let content = "";
        for (let i = 0; i < 50; i++) {
          content = fs.readFileSync(path.join(root, "note.md"), "utf8");
          if (content.includes("local input")) break;
          await window.waitForTimeout(100);
        }
        assert.match(content, /new remote body/);
        assert.match(content, /local input/);
        assert.deepEqual(errors, []);
        const foreground = await electronApp.evaluate(() => globalThis.__notesForeground);
        assert.deepEqual(foreground, []);
        return { externalUpdateAndSubsequentInputPreserved: true, foreground, errors };
      },
    });
    console.log(JSON.stringify(result.exerciseResult, null, 2));
  } finally {
    await fixture.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
