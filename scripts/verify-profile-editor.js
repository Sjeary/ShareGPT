const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

// Exercise the built profile entry in a hidden native window; only API responses are fixtures.
async function run() {
  const { _electron: electron, expect } = require("playwright/test");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-profile-editor-"));
  const app = await electron.launch({
    args: [__filename],
    env: { ...process.env, SHAREGPT_USER_DATA: directory },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    const updates = [];
    let failLoad = false;
    let failSave = false;
    let releaseSave;
    let profile = { username: "Alice", displayName: "Alice", bio: "Team member", avatar: "A" };
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("https://team.example.test/api/**", async (route) => {
      if (route.request().url().endsWith("/update")) {
        updates.push(route.request().postDataJSON());
        await new Promise((resolve) => {
          releaseSave = resolve;
        });
        if (failSave) return route.fulfill({ status: 503, body: "暂时无法保存，请重试。" });
        profile = { ...profile, ...updates.at(-1) };
      } else if (failLoad) {
        return route.fulfill({ status: 503, body: "暂时无法读取资料。" });
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ profile, roomScope: "Design team" }),
      });
    });
    const load = (token = "fixture-token") =>
      app.evaluate(
        ({ BrowserWindow }, { file, token }) =>
          BrowserWindow.getAllWindows()[0].loadFile(file, {
            query: { serverUrl: "https://team.example.test", token, username: "Alice" },
          }),
        { file: path.join(ROOT, "src/renderer-next/dist/profile.html"), token },
      );
    await load();
    assert.deepEqual(
      await page.evaluate(() => ({
        vault: typeof window.api.vault,
        sender: typeof window.api.startSender,
        update: typeof window.api.installAppUpdate,
      })),
      { vault: "undefined", sender: "undefined", update: "undefined" },
    );
    const name = page.getByLabel("显示昵称", { exact: true });
    const bio = page.getByLabel("个人简介", { exact: true });
    const avatar = page.getByLabel("头像文字", { exact: true });
    const save = page.getByRole("button", { name: "保存更改", exact: true });
    await expect(name).toHaveValue("Alice");
    await expect(save).toBeDisabled();
    await expect(page.getByRole("button", { name: "切换主题" })).toHaveCount(0);
    if (process.platform === "darwin") {
      await expect(page.locator("header").getByRole("button")).toHaveCount(0);
      assert.ok(
        (await page
          .locator("header")
          .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))) >= 70,
      );
    }

    await name.fill("设计成员");
    await bio.fill("白天在线");
    await avatar.fill("星");
    await expect(page.getByRole("heading", { name: "设计成员" })).toBeVisible();
    failSave = true;
    await save.click();
    await expect(name).toBeDisabled();
    await expect(page.getByRole("button", { name: "保存中…" })).toBeDisabled();
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    releaseSave();
    releaseSave = undefined;
    await expect(page.getByRole("alert")).toContainText("暂时无法保存");
    await expect(name).toHaveValue("设计成员");
    await expect(bio).toHaveValue("白天在线");
    await expect(avatar).toHaveValue("星");
    assert.equal(await app.evaluate(() => global.profileEmissions.length), 0);

    failSave = false;
    await save.click();
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    releaseSave();
    releaseSave = undefined;
    await expect(save).toBeDisabled();
    await expect(page.getByText("资料已保存", { exact: true })).toBeVisible();
    assert.deepEqual(updates[1], {
      displayName: "设计成员",
      bio: "白天在线",
      avatar: "星",
      avatarKind: "emoji",
    });
    await expect.poll(() => app.evaluate(() => global.profileEmissions.length)).toBe(1);
    assert.deepEqual(await app.evaluate(() => global.profileEmissions[0].profile), profile);
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute("data-y-position", "top");
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "right");

    for (const dark of [true, false]) {
      await app.evaluate((_, dark) => {
        global.profileDark = dark;
      }, dark);
      await load();
      await expect(name).toHaveValue("设计成员");
      await expect
        .poll(() => page.locator("html").evaluate((el) => el.classList.contains("dark")))
        .toBe(dark);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(900, 680),
      );
      await page.screenshot({
        path: path.join(directory, `profile-${dark ? "dark" : "light"}-normal.png`),
        animations: "disabled",
      });
      for (const [width, height] of [
        [900, 680],
        [760, 560],
        [390, 640],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height],
        );
        await name.fill("W".repeat(30));
        await bio.fill("测".repeat(200));
        await expect(page.getByRole("button", { name: "保存更改", exact: true })).toBeInViewport();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        assert.equal(
          await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
        );
        const footer = await page.locator("footer").boundingBox();
        const saveBox = await save.boundingBox();
        assert.ok(saveBox.y >= footer.y && saveBox.y + saveBox.height <= footer.y + footer.height);
        await page.screenshot({
          path: path.join(directory, `profile-${dark ? "dark" : "light"}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    failLoad = true;
    await load();
    await expect(page.getByRole("alert")).toContainText("暂时无法读取");
    await expect(save).toBeDisabled();
    failLoad = false;
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(name).toHaveValue("设计成员");
    await load("");
    await expect(page.getByRole("alert")).toContainText("登录信息已失效");
    await expect(save).toBeDisabled();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, directory, updates: updates.length }));
  } finally {
    await app.close();
  }
}

if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const { createTrustedIpc } = require("../src/main/trustedIpc");
  const trustedIpc = createTrustedIpc({ ipcMain, openExternal: async () => {} });
  global.profileEmissions = [];
  global.profileDark = true;
  trustedIpc.handle("profile:theme", () => ({
    ui: { theme: global.profileDark ? "dark" : "light" },
  }));
  trustedIpc.handle("settings:principal-context", () => ({
    principalId: "fixture",
    generation: 1,
  }));
  trustedIpc.handle("window:is-maximized", () => false);
  trustedIpc.handle("window:is-fullscreen", () => false);
  trustedIpc.on("profile:updated", (_, payload) => global.profileEmissions.push(payload));
  app.setPath("userData", process.env.SHAREGPT_USER_DATA);
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    const window = new BrowserWindow({
      show: false,
      width: 900,
      height: 680,
      frame: false,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      webPreferences: {
        preload: path.join(ROOT, "src/main/profilePreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    trustedIpc.registerWindow(
      window,
      { type: "file", target: path.join(ROOT, "src/renderer-next/dist/profile.html") },
      "profile",
    );
    return window.loadURL("about:blank");
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
