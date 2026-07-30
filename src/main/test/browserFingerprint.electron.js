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
      const nativePlatform = await window.webContents.executeJavaScript("navigator.platform", true);
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
      assert.strictEqual(
        snapshot.navigator.platform,
        process.platform === "win32" ? "Win32" : nativePlatform,
      );
      assert.strictEqual(snapshot.screen.width, 1920);
      assert.strictEqual(snapshot.screen.height, 1080);
      assert.strictEqual(snapshot.screen.devicePixelRatio, 1);
      assert.match(snapshot.graphics.canvasHash, /^[a-f0-9]{64}$/);
      assert.match(snapshot.browserHash, /^[a-f0-9]{64}$/);

      await window.webContents.executeJavaScript(
        buildFingerprintInjectionSource(
          { enabled: true, preset: "us-windows" },
          "integration-profile",
          "gpt",
          "win32",
        ),
        true,
      );
      const windowsSnapshot = await collectPageFingerprint(window.webContents);
      assert.strictEqual(windowsSnapshot.navigator.platform, "Win32");
      assert.strictEqual(windowsSnapshot.media.audioInputs, 0);
      assert.strictEqual(windowsSnapshot.media.videoInputs, 0);
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          hostPlatform: process.platform,
          nativePlatform,
          platform: snapshot.navigator.platform,
          windowsHelperPlatform: windowsSnapshot.navigator.platform,
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
