const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function waitUntil(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition timed out");
}

function buildCursorHelper(tempDir) {
  const source = path.join(tempDir, "cursor.swift");
  const binary = path.join(tempDir, "cursor-helper");
  fs.writeFileSync(
    source,
    `import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { exit(2) }
let point = CGPoint(x: x, y: y)
CGWarpMouseCursorPosition(point)
if args[1] == "event" {
  CGEvent(
    mouseEventSource: nil,
    mouseType: .mouseMoved,
    mouseCursorPosition: point,
    mouseButton: .left
  )?.post(tap: .cghidEventTap)
}
`,
  );
  childProcess.execFileSync("/usr/bin/swiftc", [source, "-o", binary]);
  return binary;
}

function activateProcess(electronPid) {
  childProcess.execFileSync("/usr/bin/osascript", [
    "-e",
    `tell application "System Events" to set frontmost of first process whose unix id is ${electronPid} to true`,
  ]);
}

function moveCursor(binary, point) {
  childProcess.execFileSync(binary, ["event", String(point.x), String(point.y)]);
}

function warpCursor(binary, point) {
  childProcess.execFileSync(binary, ["warp", String(point.x), String(point.y)]);
}

async function movePointer(binary, window, screenPoint, rendererPoint) {
  warpCursor(binary, screenPoint);
  await window.mouse.move(rendererPoint.x, rendererPoint.y);
}

async function tooltipSnapshot(electronApp) {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    const tooltip = main?.contentView.children.find((view) =>
      view.webContents?.getURL().includes("nav-tooltip.html"),
    );
    const bounds = tooltip?.getBounds() || null;
    const renderer = tooltip
      ? await tooltip.webContents.executeJavaScript(`({
          phase: document.body.dataset.navTooltipPhase || "",
          opacity: Number.parseFloat(getComputedStyle(document.body).opacity),
        })`)
      : { phase: "", opacity: 0 };
    return {
      bounds,
      renderer,
      topmost: Boolean(tooltip && main.contentView.children.at(-1) === tooltip),
      visible: Boolean(
        tooltip?.getVisible() &&
          bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          renderer.phase === "visible" &&
          renderer.opacity === 1
      ),
    };
  });
}

async function waitForTooltipVisible(electronApp, timeoutMs = 10_000) {
  try {
    return await waitUntil(async () => {
      const snapshot = await tooltipSnapshot(electronApp);
      return snapshot.visible ? snapshot : null;
    }, timeoutMs);
  } catch (error) {
    const snapshot = await tooltipSnapshot(electronApp);
    throw new Error(`native tooltip did not become visible: ${JSON.stringify(snapshot)}`, {
      cause: error,
    });
  }
}

async function captureBaseline(electronApp) {
  return electronApp.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1600, height: 1200 },
    });
    const source = sources.find((candidate) => candidate.id === main.getMediaSourceId());
    if (!source) throw new Error("ShareGPT window capture source is unavailable");
    const image = source.thumbnail;
    globalThis.__navTooltipPixelBaseline = {
      bitmap: image.toBitmap(),
      size: image.getSize(),
      windowBounds: main.getBounds(),
      contentBounds: main.getContentBounds(),
    };
    return true;
  });
}

async function tooltipRegionDifference(electronApp, tooltipBounds) {
  return electronApp.evaluate(async ({ BrowserWindow, desktopCapturer }, bounds) => {
    const baseline = globalThis.__navTooltipPixelBaseline;
    const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: baseline.size,
    });
    const source = sources.find((candidate) => candidate.id === main.getMediaSourceId());
    if (!source) throw new Error("ShareGPT window capture source is unavailable");
    const image = source.thumbnail;
    const bitmap = image.toBitmap();
    const size = image.getSize();
    const scaleX = size.width / baseline.windowBounds.width;
    const scaleY = size.height / baseline.windowBounds.height;
    const left = Math.max(
      0,
      Math.floor((baseline.contentBounds.x + bounds.x - baseline.windowBounds.x - 2) * scaleX),
    );
    const top = Math.max(
      0,
      Math.floor((baseline.contentBounds.y + bounds.y - baseline.windowBounds.y - 2) * scaleY),
    );
    const right = Math.min(
      size.width,
      Math.ceil(
        (baseline.contentBounds.x + bounds.x + bounds.width - baseline.windowBounds.x + 2) * scaleX,
      ),
    );
    const bottom = Math.min(
      size.height,
      Math.ceil(
        (baseline.contentBounds.y + bounds.y + bounds.height - baseline.windowBounds.y + 2) *
          scaleY,
      ),
    );
    let changed = 0;
    let compared = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * size.width + x) * 4;
        compared += 1;
        const delta =
          Math.abs(bitmap[offset] - baseline.bitmap[offset]) +
          Math.abs(bitmap[offset + 1] - baseline.bitmap[offset + 1]) +
          Math.abs(bitmap[offset + 2] - baseline.bitmap[offset + 2]);
        if (delta > 36) changed += 1;
      }
    }
    return { changed, compared, fraction: compared ? changed / compared : 0 };
  }, tooltipBounds);
}

async function main() {
  assert.equal(process.platform, "darwin", "native cursor verification currently requires macOS");
  const repo = path.resolve(__dirname, "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-nav-tooltip-"));
  const cursorHelper = buildCursorHelper(tempDir);
  const electronApp = await electron.launch({
    args: [repo],
    cwd: repo,
    env: { ...process.env, SHAREGPT_USER_DATA: path.join(tempDir, "user-data") },
  });
  const electronPid = await electronApp.evaluate(() => process.pid);

  try {
    const window = await waitUntil(() =>
      electronApp
        .windows()
        .find(
          (candidate) =>
            candidate.url().includes("index.html") && !candidate.url().includes("nav-tooltip.html"),
        ),
    );
    await window.getByRole("button", { name: "先浏览界面" }).click();
    await window.locator('[data-tour="nav-gpt"]').waitFor();
    const skipOnboarding = window.getByRole("button", { name: "跳过", exact: true });
    if (await skipOnboarding.isVisible()) await skipOnboarding.click();
    await window.locator('[data-tour="nav-chat"]').click();
    const collapse = window.getByRole("button", { name: "收起侧栏" });
    if (await collapse.isVisible()) await collapse.click();
    await window.getByRole("button", { name: "展开侧栏" }).waitFor();
    await window.waitForTimeout(300);
    await electronApp.evaluate(({ app, BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      app.focus({ steal: true });
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.focus();
    });
    const gptNav = window.locator('[data-tour="nav-gpt"]');
    const trigger = await gptNav.boundingBox();
    assert.ok(trigger, "GPT navigation trigger has no bounds");
    const geometry = await electronApp.evaluate(({ BrowserWindow }, box) => {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      const content = mainWindow.getContentBounds();
      const zoom = mainWindow.webContents.getZoomFactor();
      return {
        triggerPoint: {
          x: Math.round(content.x + (box.x + box.width / 2) * zoom),
          y: Math.round(content.y + (box.y + box.height / 2) * zoom),
        },
        triggerRendererPoint: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        neutralPoint: {
          x: Math.round(content.x + Math.max(240, content.width * 0.65)),
          y: Math.round(content.y + Math.max(180, content.height * 0.5)),
        },
        neutralRendererPoint: {
          x: Math.max(240, content.width * 0.65) / zoom,
          y: Math.max(180, content.height * 0.5) / zoom,
        },
        focusPoint: {
          x: Math.round(content.x + content.width / 2),
          y: Math.round(content.y + 10),
        },
      };
    }, trigger);

    activateProcess(electronPid);
    moveCursor(cursorHelper, geometry.focusPoint);
    await window.waitForTimeout(200);
    await movePointer(cursorHelper, window, geometry.neutralPoint, geometry.neutralRendererPoint);
    await window.waitForTimeout(100);
    await captureBaseline(electronApp);
    await gptNav.hover();
    const normalTooltip = window.locator('[data-slot="tooltip-content"]', {
      hasText: "ChatGPT",
    });
    await normalTooltip.waitFor({ state: "visible" });
    assert.equal(
      (await tooltipSnapshot(electronApp)).visible,
      false,
      "normal pages unexpectedly used the native tooltip bridge",
    );
    const normalTooltipBox = await normalTooltip.boundingBox();
    assert.ok(normalTooltipBox, "normal shadcn tooltip has no bounds");
    const normalTooltipBounds = await electronApp.evaluate(({ BrowserWindow }, box) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const zoom = mainWindow.webContents.getZoomFactor();
      return {
        x: Math.floor(box.x * zoom),
        y: Math.floor(box.y * zoom),
        width: Math.ceil(box.width * zoom),
        height: Math.ceil(box.height * zoom),
      };
    }, normalTooltipBox);
    const firstPixels = await tooltipRegionDifference(electronApp, normalTooltipBounds);
    assert.ok(
      firstPixels.changed > 150,
      `normal shadcn hover produced only ${firstPixels.changed} changed pixels`,
    );

    await window.mouse.move(geometry.neutralRendererPoint.x, geometry.neutralRendererPoint.y, {
      steps: 12,
    });
    await window.waitForTimeout(200);
    if (await normalTooltip.isVisible()) {
      const normalExitDiagnostics = await gptNav.evaluate((element) => ({
        hovered: element.matches(":hover"),
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        activeLabel: document.activeElement?.getAttribute("aria-label") || "",
      }));
      throw new Error(`normal shadcn tooltip did not close: ${JSON.stringify(normalExitDiagnostics)}`);
    }
    await normalTooltip.waitFor({ state: "hidden" });

    await gptNav.click();
    await window.mouse.move(geometry.neutralRendererPoint.x, geometry.neutralRendererPoint.y);
    await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      const content = mainWindow.getContentBounds();
      const fixture = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      fixture.setBackgroundColor("#146b5d");
      fixture.setBounds({ x: 68, y: 40, width: content.width - 68, height: content.height - 40 });
      mainWindow.contentView.addChildView(fixture);
      await fixture.webContents.loadURL(
        `data:text/html,<body style="margin:0;background:%23146b5d;color:white;font:24px sans-serif">AI fixture</body>`,
      );
      globalThis.__navTooltipFixtureView = fixture;
      mainWindow.show();
      mainWindow.focus();
    });
    await captureBaseline(electronApp);
    moveCursor(cursorHelper, geometry.triggerPoint);
    const aiVisible = await waitForTooltipVisible(electronApp);
    assert.equal(aiVisible.topmost, true, "tooltip is below the AI fixture view");
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = mainWindow.contentView.children.find((view) =>
        view.webContents?.getURL().includes("nav-tooltip.html"),
      );
      await tooltip.webContents.executeJavaScript(`
        globalThis.__verifiedPersistentTooltip = document.querySelector("[data-slot=tooltip-content]");
      `);
    });
    const aiPixels = await tooltipRegionDifference(electronApp, aiVisible.bounds);
    assert.ok(aiPixels.changed > 150, `AI hover produced only ${aiPixels.changed} changed pixels`);
    await window.waitForTimeout(2300);
    const heldVisible = await tooltipSnapshot(electronApp);
    assert.deepEqual(heldVisible.bounds, aiVisible.bounds, "held hover moved the tooltip");
    assert.equal(heldVisible.visible, true, "frame ACK did not cancel the overlay timeout");
    const heldRender = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      const tooltip = mainWindow.contentView.children.find((view) =>
        view.webContents?.getURL().includes("nav-tooltip.html"),
      );
      return tooltip.webContents.executeJavaScript(`
        document.querySelector("[data-slot=tooltip-content]") === globalThis.__verifiedPersistentTooltip
      `);
    });
    assert.equal(heldRender, true, "held hover remounted the persistent tooltip element");

    moveCursor(cursorHelper, geometry.neutralPoint);
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));
    const hiddenPixels = await tooltipRegionDifference(electronApp, aiVisible.bounds);
    assert.ok(
      hiddenPixels.changed < Math.max(30, aiPixels.changed * 0.08),
      `tooltip pixels remained after pointer exit: ${hiddenPixels.changed}`,
    );

    childProcess.execFileSync("/usr/bin/open", ["-a", "Finder"]);
    await waitUntil(() =>
      electronApp.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isFocused()),
    );
    await movePointer(cursorHelper, window, geometry.triggerPoint, geometry.triggerRendererPoint);
    await waitForTooltipVisible(electronApp);
    assert.equal(
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
      false,
      "pointer hover unexpectedly activated the app window",
    );
    activateProcess(electronPid);
    await waitUntil(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    );
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));
    await movePointer(cursorHelper, window, geometry.neutralPoint, geometry.neutralRendererPoint);
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));
    moveCursor(cursorHelper, geometry.triggerPoint);
    await waitForTooltipVisible(electronApp);
    moveCursor(cursorHelper, geometry.neutralPoint);
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));

    const claudeNav = window.locator('[data-tour="nav-claude"]');
    await claudeNav.click();
    await window.mouse.move(geometry.neutralRendererPoint.x, geometry.neutralRendererPoint.y);
    const claudeTrigger = await claudeNav.boundingBox();
    assert.ok(claudeTrigger, "Claude navigation trigger has no bounds");
    const claudeGeometry = await electronApp.evaluate(({ BrowserWindow }, box) => {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      const content = mainWindow.getContentBounds();
      const zoom = mainWindow.webContents.getZoomFactor();
      return {
        screen: {
          x: Math.round(content.x + (box.x + box.width / 2) * zoom),
          y: Math.round(content.y + (box.y + box.height / 2) * zoom),
        },
        renderer: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      };
    }, claudeTrigger);
    await movePointer(cursorHelper, window, claudeGeometry.screen, claudeGeometry.renderer);
    await waitForTooltipVisible(electronApp);
    const claudeRender = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      const tooltip = mainWindow.contentView.children.find((view) =>
        view.webContents?.getURL().includes("nav-tooltip.html"),
      );
      return tooltip.webContents.executeJavaScript(`(() => {
        const element = document.querySelector("[data-slot=tooltip-content]");
        return {
          sameElement: element === globalThis.__verifiedPersistentTooltip,
          text: Array.from(element.childNodes)
            .find((node) => node.nodeType === Node.TEXT_NODE)?.textContent,
        };
      })()`);
    });
    assert.deepEqual(claudeRender, { sameElement: true, text: "Claude" });
    await movePointer(cursorHelper, window, geometry.neutralPoint, geometry.neutralRendererPoint);
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));

    await gptNav.click();
    await window.mouse.move(geometry.neutralRendererPoint.x, geometry.neutralRendererPoint.y);
    await movePointer(cursorHelper, window, geometry.triggerPoint, geometry.triggerRendererPoint);
    await waitForTooltipVisible(electronApp);
    await movePointer(cursorHelper, window, geometry.neutralPoint, geometry.neutralRendererPoint);
    await waitUntil(() => tooltipSnapshot(electronApp).then((value) => !value.visible));

    await movePointer(cursorHelper, window, geometry.triggerPoint, geometry.triggerRendererPoint);
    await window.mouse.click(geometry.triggerRendererPoint.x, geometry.triggerRendererPoint.y);
    await movePointer(cursorHelper, window, geometry.neutralPoint, geometry.neutralRendererPoint);
    childProcess.execFileSync("/usr/bin/open", ["-a", "Finder"]);
    await waitUntil(() =>
      electronApp.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isFocused()),
    );
    await electronApp.evaluate(({ app, BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      app.focus({ steal: true });
      mainWindow.show();
      mainWindow.focus();
    });
    activateProcess(electronPid);
    await waitUntil(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    );
    const focusDeadline = Date.now() + 900;
    while (Date.now() < focusDeadline) {
      assert.equal(
        (await tooltipSnapshot(electronApp)).visible,
        false,
        "window focus revived tooltip",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await window.keyboard.press("Tab");
    await gptNav.evaluate((element) => element.focus());
    await waitForTooltipVisible(electronApp);
    assert.equal(
      await gptNav.evaluate((element) => element.matches(":focus-visible")),
      true,
      "keyboard navigation did not produce focus-visible",
    );

    process.stdout.write(
      `${JSON.stringify({
        firstHoverChangedPixels: firstPixels.changed,
        firstHoverBounds: normalTooltipBounds,
        aiHoverChangedPixels: aiPixels.changed,
        aiHoverBounds: aiVisible.bounds,
        persistentAiElementAcrossProviders: true,
        pointerExitChangedPixels: hiddenPixels.changed,
        topmost: aiVisible.topmost,
      })}\n`,
    );
  } finally {
    await electronApp.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
