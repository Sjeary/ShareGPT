const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.resolve(__dirname, "..");

function changedPixels(before, after) {
  assert.deepEqual(before.getSize(), after.getSize());
  const first = before.toBitmap();
  const second = after.toBitmap();
  let changed = 0;
  for (let index = 0; index < first.length; index += 4) {
    const delta =
      Math.abs(first[index] - second[index]) +
      Math.abs(first[index + 1] - second[index + 1]) +
      Math.abs(first[index + 2] - second[index + 2]);
    if (delta >= 12) changed += 1;
  }
  return changed;
}

async function main() {
  await app.whenReady();
  if (process.platform === "darwin") app.dock.hide();
  const window = new BrowserWindow({
    show: false,
    x: -10_000,
    y: -10_000,
    width: 520,
    height: 180,
    opacity: 0,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  try {
    await window.loadFile(path.join(ROOT, "src/renderer-next/dist/index.html"));
    const bounds = await window.webContents.executeJavaScript(`(() => {
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#fff;overflow:hidden';
      const wrapper = document.createElement('div');
      wrapper.className = 'ai-tab-scrollbar';
      wrapper.style.cssText = 'position:absolute;left:20px;top:20px;width:440px;height:40px;background:#fff';
      const scroll = document.createElement('div');
      scroll.className = 'no-scrollbar';
      scroll.style.cssText = 'width:440px;height:40px;overflow-x:scroll;overflow-y:hidden;background:#fff';
      const content = document.createElement('div');
      content.style.cssText = 'width:880px;height:24px;background:#fff';
      scroll.append(content);
      const track = document.createElement('div');
      track.className = 'ai-tab-scrollbar-track is-visible';
      const thumb = document.createElement('div');
      thumb.className = 'ai-tab-scrollbar-thumb';
      thumb.style.cssText = 'left:0;width:50%';
      track.append(thumb);
      wrapper.append(scroll, track);
      document.body.append(wrapper);
      const rect = wrapper.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    })()`);

    window.showInactive();
    window.webContents.sendInputEvent({ type: "mouseMove", x: 500, y: 120 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const idle = await window.webContents.capturePage(bounds);
    window.webContents.sendInputEvent({
      type: "mouseMove",
      x: bounds.x + Math.floor(bounds.width / 2),
      y: bounds.y + Math.floor(bounds.height / 2),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const hovered = await window.webContents.capturePage(bounds);
    const changed = changedPixels(idle, hovered);
    assert.ok(changed >= 40, `hover did not reveal the scrollbar thumb: changedPixels=${changed}`);

    const metrics = await window.webContents.executeJavaScript(`(() => {
      const scroll = document.querySelector('.ai-tab-scrollbar > .no-scrollbar');
      scroll.scrollLeft = 120;
      return {
        clientWidth: scroll.clientWidth,
        scrollWidth: scroll.scrollWidth,
        scrollLeft: scroll.scrollLeft,
        height: scroll.getBoundingClientRect().height,
      };
    })()`);
    assert.ok(metrics.scrollWidth > metrics.clientWidth);
    assert.equal(metrics.scrollLeft, 120);
    assert.equal(metrics.height, 40);
    process.stdout.write(`${JSON.stringify({ ok: true, changedPixels: changed, metrics })}\n`);
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
