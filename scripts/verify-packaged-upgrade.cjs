const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { _electron: electron } = require("playwright");
const {
  createFixtureServer,
  loginThroughForm,
  dismissFirstRunGuides,
} = require("./verify-collab-login-compatibility");

// Uses the disposable runner's native secure storage and Chromium profile.
// The preceding startup verifier proves ownership of the profile moved below.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  !process.env.RUNNER_TEMP ||
  !process.env.GITHUB_WORKSPACE
)
  throw new Error("Packaged upgrade acceptance requires a disposable GitHub runner.");
const windows = process.platform === "win32";
assert.ok(windows || process.platform === "darwin");
const root = fs.realpathSync(process.env.RUNNER_TEMP);
const task = fs.mkdtempSync(path.join(root, "sharegpt-upgrade-"));
const current = path.resolve(process.argv[2] || "");
const installer = windows ? path.resolve(process.argv[3] || "") : null;
for (const file of [current, installer].filter(Boolean)) {
  assert.ok(
    [root, fs.realpathSync(process.env.GITHUB_WORKSPACE)].some((base) =>
      file.startsWith(base + path.sep),
    ),
  );
  assert.ok(fs.existsSync(file));
}
const previous = windows
  ? {
      name: "sharegpt-1.0.10.exe",
      sha256: "a74a44f5918c7829004770cad065fd07123818541ac09305707835fbb44f11cb",
    }
  : {
      name: "sharegpt-1.0.10-arm64.zip",
      sha256: "2643572dbe75cdb73708d057557467f56126ddfd2f7d6c9a7a493dc060e3da5b",
    };
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const run = (file, args) => {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 180000, windowsHide: true });
  if (result.error || result.status !== 0)
    throw new Error(`${file} failed: ${result.error || result.stderr || result.stdout}`);
  return result.stdout;
};
// Only generated fixture secrets live in this temporary Keychain. Explicit old/new
// application ACLs represent user approval; this does not test a silent ad-hoc upgrade.
function isolatedKeychain(oldExe, newExe) {
  if (windows) return () => {};
  const security = (...args) => run("/usr/bin/security", args);
  const paths = (value) => [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const originalDefault = paths(security("default-keychain", "-d", "user"))[0];
  const originalSearch = paths(security("list-keychains", "-d", "user"));
  assert.ok(originalDefault && originalSearch.length);
  const keychain = path.join(task, "upgrade-fixture.keychain-db");
  const password = crypto.randomBytes(24).toString("hex");
  security("create-keychain", "-p", password, keychain);
  const restore = () => {
    security("default-keychain", "-d", "user", "-s", originalDefault);
    security("list-keychains", "-d", "user", "-s", ...originalSearch);
    security("delete-keychain", keychain);
  };
  try {
    security("unlock-keychain", "-p", password, keychain);
    security("list-keychains", "-d", "user", "-s", keychain);
    security("default-keychain", "-d", "user", "-s", keychain);
    // Electron 43.1.0 sets service=app_name+" Safe Storage", account=app_name.
    security(
      "add-generic-password",
      "-a",
      "ShareGPT",
      "-s",
      "ShareGPT Safe Storage",
      "-w",
      crypto.randomBytes(16).toString("base64"),
      "-T",
      oldExe,
      "-T",
      newExe,
      keychain,
    );
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}
const results = [];
let fixture, encrypted;
async function launch(executablePath, seed) {
  let app;
  let phase = "launch";
  const watchdog = setTimeout(() => {
    console.error(`Packaged upgrade timed out: seed=${seed}, phase=${phase}`);
    const child = app?.process();
    if (child) child.kill("SIGKILL");
  }, 180000);
  watchdog.unref();
  const mark = (value) => {
    phase = value;
    console.log(`Upgrade seed=${seed}: ${phase}`);
  };
  try {
    mark("launch");
    app = await electron.launch({ executablePath, timeout: 90000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await app.context().route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["file:", "data:"].includes(url.protocol) || url.hostname === "127.0.0.1"
        ? route.continue()
        : route.abort();
    });
    mark("fixture login");
    await Promise.all([
      loginThroughForm(page, fixture.baseUrl, "upgrade-member"),
      (async () => {
        await page.locator('[data-tour="nav-account"]').waitFor();
        await dismissFirstRunGuides(page);
        await page.locator('[data-tour="nav-account"]').click();
      })(),
    ]);
    const identity = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      data: app.getPath("userData"),
    }));
    assert.equal(identity.version, seed ? "1.0.10" : require("../package.json").version);
    assert.equal(identity.packaged, true);
    const state = await page.evaluate(async (seed) => {
      const p = await window.api.getSettingsPrincipal();
      let settings = await window.api.loadSettings({
        expectedPrincipalId: p.principalId,
        expectedPrincipalGeneration: p.generation,
      });
      if (seed) {
        settings = await window.api.patchSettings({
          section: "ui",
          patch: { upgradeAcceptance: "retained", onboarding_done: true },
          expectedRevision: settings.settingsRevision,
          expectedPrincipalId: p.principalId,
          expectedPrincipalGeneration: p.generation,
        });
        await window.api.saveChatHistory(
          {
            conversations: {
              "room:all": [
                { id: "upgrade-message", text: "retained", timestamp: "2026-10-09T00:00:00Z" },
              ],
            },
          },
          p,
        );
        localStorage.setItem("upgrade-acceptance", "retained");
      }
      return {
        settings,
        principal: p.principalId,
        history: await window.api.loadChatHistory(p),
        local: localStorage.getItem("upgrade-acceptance"),
      };
    }, seed);
    assert.equal(state.settings.ui.upgradeAcceptance, "retained");
    assert.equal(state.history.conversations["room:all"][0].text, "retained");
    assert.equal(state.local, "retained");
    mark("persistent browser cookie");
    const cookie = await app.evaluate(
      async ({ session }, { partition, seed }) => {
        const s = session.fromPartition(partition);
        if (seed)
          await s.cookies.set({
            url: "https://chatgpt.com/",
            name: "sharegpt-upgrade-acceptance",
            value: "retained",
            expirationDate: Date.now() / 1000 + 86400,
          });
        await s.cookies.flushStore();
        s.flushStorageData();
        return s.cookies.get({ url: "https://chatgpt.com/", name: "sharegpt-upgrade-acceptance" });
      },
      { partition: state.settings.gpt.partition, seed },
    );
    assert.equal(cookie[0]?.value, "retained");
    mark("real secure storage");
    encrypted = await app.evaluate(
      ({ safeStorage, app }, { seed, encrypted }) => {
        if (
          app.commandLine.hasSwitch("use-mock-keychain") ||
          app.commandLine.hasSwitch("password-store")
        )
          throw new Error("Real secure storage required");
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage unavailable");
        const bytes = seed
          ? safeStorage.encryptString("upgrade-secret-fixture")
          : Buffer.from(encrypted, "base64");
        if (safeStorage.decryptString(bytes) !== "upgrade-secret-fixture")
          throw new Error("Previous encryption cannot be read");
        return bytes.toString("base64");
      },
      { seed, encrypted },
    );
    if (!seed) {
      mark("packaged terminal");
      assert.equal(identity.data, results[0].data);
      assert.equal(state.principal, results[0].principal);
      assert.equal(state.settings.gpt.partition, results[0].partition);
      await page.evaluate(() => {
        window.__upgradeTerminal = [];
        window.api.onTerminalEvent((e) => window.__upgradeTerminal.push(e));
      });
      await page.locator('[data-tour="nav-terminal"]').click();
      await page.getByRole("button", { name: "打开本地终端", exact: true }).click();
      const input = page.locator('[data-state="active"] .xterm-helper-textarea');
      await input.waitFor({ state: "attached" });
      await page.waitForFunction(() => window.__upgradeTerminal.some((e) => e.type === "data"));
      await input.pressSequentially(
        windows ? "Write-Output ('UPGRADE_' + 'PTY_OK')" : "printf '%s%s\\n' UPGRADE_ PTY_OK",
      );
      await input.press("Enter");
      await page.waitForFunction(() =>
        window.__upgradeTerminal
          .map((e) => e.data || "")
          .join("")
          .includes("UPGRADE_PTY_OK"),
      );
    }
    assert.deepEqual(errors, []);
    results.push({
      ...identity,
      principal: state.principal,
      partition: state.settings.gpt.partition,
      seed,
      settings: true,
      chat: true,
      localStorage: true,
      cookie: true,
      realSecureStorage: true,
      terminal: !seed,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    mark("shutdown");
    try {
      if (app) await app.close();
    } finally {
      clearTimeout(watchdog);
    }
  }
}
(async () => {
  const first = JSON.parse(
    fs.readFileSync(path.join(root, "sharegpt-packaged-startup.json"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(path.join(first.data, "packaged-startup-sentinel.txt"), "utf8"),
    "preserve",
  );
  assert.equal(path.basename(first.data), "ShareGPT");
  assert.ok(!fs.lstatSync(first.data).isSymbolicLink());
  const retainedProfile = path.join(task, "previous-startup-profile");
  fs.cpSync(first.data, retainedProfile, {
    recursive: true,
    verbatimSymlinks: true,
    errorOnExist: true,
  });
  assert.equal(
    fs.readFileSync(path.join(retainedProfile, "packaged-startup-sentinel.txt"), "utf8"),
    "preserve",
  );
  fs.rmSync(first.data, { recursive: true });
  const disk = fs.statfsSync(task);
  assert.ok(disk.bavail * disk.bsize > 1500000000, "Insufficient disposable runner space");
  const response = await fetch(
    `https://github.com/Sjeary/ShareGPT/releases/download/v1.0.10/${previous.name}`,
    { signal: AbortSignal.timeout(120000) },
  );
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), previous.sha256);
  const archive = path.join(task, previous.name);
  fs.writeFileSync(archive, bytes);
  const slot = path.join(task, "installed");
  fs.mkdirSync(slot);
  let oldExe, newExe;
  if (windows) {
    run(archive, ["/S", `/D=${slot}`]);
    oldExe = path.join(slot, "sharegpt.exe");
    newExe = oldExe;
  } else {
    run("/usr/bin/ditto", ["-xk", archive, slot]);
    oldExe = path.join(slot, "ShareGPT.app/Contents/MacOS/ShareGPT");
    newExe = oldExe;
  }
  const restoreKeychain = isolatedKeychain(oldExe, current);
  try {
    fixture = await createFixtureServer({
      profileFor: () => ({ isAdmin: false, advancedAiAllowed: true }),
    });
    await launch(oldExe, true);
    if (windows) run(installer, ["/S", `/D=${slot}`]);
    else {
      fs.renameSync(path.join(slot, "ShareGPT.app"), path.join(task, "previous.app"));
      run("/usr/bin/ditto", [path.resolve(current, "../../.."), path.join(slot, "ShareGPT.app")]);
    }
    await launch(newExe, false);
    await launch(newExe, false);
    fs.writeFileSync(
      path.join(root, "sharegpt-packaged-upgrade.json"),
      JSON.stringify(
        {
          passed: true,
          previousVersion: "1.0.10",
          previousAssetSha256: previous.sha256,
          keychainFixture: windows
            ? "native Windows secure storage"
            : "isolated native Keychain, explicit old/new app approval",
          results,
          limits: [
            "Synthetic accounts and browser cookies; no third-party AI credentials are sent to CI.",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (fixture) await fixture.close();
    } finally {
      restoreKeychain();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
