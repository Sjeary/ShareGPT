// 手动 Chromium 集成测试：
//   npx electron src/main/test/browserFingerprint.electron.js
// 不纳入 node --test（需要 Electron renderer）。
const assert = require("node:assert");
const { app, BrowserWindow } = require("electron");
const {
  buildFingerprintInjectionSource,
  collectPageFingerprint,
} = require("../browserFingerprint");

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    try {
      await window.loadURL(
        "data:text/html;charset=utf-8,<html><body>fingerprint-test</body></html>",
      );
      await window.webContents.executeJavaScript(
        buildFingerprintInjectionSource(
          { enabled: true, preset: "us-windows" },
          "integration-profile",
          "gpt",
        ),
        true,
      );
      const snapshot = await collectPageFingerprint(window.webContents);
      assert.strictEqual(snapshot.navigator.hardwareConcurrency, 8);
      assert.strictEqual(snapshot.navigator.deviceMemory, 8);
      assert.strictEqual(snapshot.navigator.platform, "Win32");
      assert.strictEqual(snapshot.screen.width, 1920);
      assert.strictEqual(snapshot.screen.height, 1080);
      assert.strictEqual(snapshot.screen.devicePixelRatio, 1);
      assert.strictEqual(snapshot.media.audioInputs, 0);
      assert.strictEqual(snapshot.media.videoInputs, 0);
      assert.match(snapshot.graphics.canvasHash, /^[a-f0-9]{64}$/);
      assert.match(snapshot.browserHash, /^[a-f0-9]{64}$/);
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          platform: snapshot.navigator.platform,
          cpu: snapshot.navigator.hardwareConcurrency,
          memory: snapshot.navigator.deviceMemory,
          screen: snapshot.screen,
          webgl: snapshot.graphics.webglRenderer,
          canvas: snapshot.graphics.canvasHash.slice(0, 12),
          audio: snapshot.audio.hash.slice(0, 12),
        })}\n`,
      );
    } finally {
      window.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  });
