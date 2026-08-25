const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend } = require("../backend");

function createBackend(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = {
    isPackaged: true,
    getPath(name) {
      if (name === "exe") return path.join(root, "ShareGPT.exe");
      const target = path.join(root, name);
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
  return new Backend(app, () => null, "all");
}

test("settings use an empty remote translation endpoint and reject stale writes", (t) => {
  const backend = createBackend(t);
  const initial = backend.loadSettings();
  assert.equal(initial.translation.ai.baseUrl, "");
  assert.equal(initial.settingsRevision, 0);

  const saved = backend.patchSettings("ui", { theme: "dark" }, 0);
  assert.equal(saved.settingsRevision, 1);
  assert.equal(saved.ui.theme, "dark");
  assert.throws(() => backend.patchSettings("ui", { theme: "light" }, 0), /设置已被其他操作更新/);
});

test("settings recover from the atomic backup without overwriting the corrupt file", (t) => {
  const backend = createBackend(t);
  const first = backend.patchSettings("ui", { theme: "dark" }, 0);
  backend.patchSettings("ui", { sidebarSide: "right" }, first.settingsRevision);
  fs.writeFileSync(backend.settingsFile, "{broken", "utf8");

  const recovered = backend.loadSettings();
  assert.equal(recovered.ui.theme, "dark");
  assert.equal(recovered.ui.sidebarSide, undefined);
  assert.equal(fs.readFileSync(backend.settingsFile, "utf8"), "{broken");
});
