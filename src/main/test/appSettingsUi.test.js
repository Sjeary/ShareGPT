const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

const imported = {
  ui: {
    theme: "light",
    sidebarSide: "right",
    showGemini: false,
    showClaude: false,
    hiddenNav: ["calendar"],
    navOrder: ["todo", "notes"],
  },
};
function setup(api = {}) {
  const themes = [];
  const dom = [];
  const app = rendererStoreHarness({
    api: {
      loadSettings: async () => imported,
      saveSettings: async () => imported,
      patchSettings: async () => imported,
      setThemeSource: async (theme) => {
        themes.push(theme);
      },
      ...api,
    },
    document: {
      documentElement: { classList: { toggle: (key, value) => dom.push([key, value]) } },
    },
  });
  const store = app.load("store/useAppStore.ts").useAppStore;
  store.setState({
    dark: true,
    showClaude: true,
    showGemini: true,
    active: "claude",
    workspaceMode: "organization",
  });
  return { ...app, store, themes, dom };
}

for (const action of ["reloadSettings", "saveSettings", "patchSection"]) {
  test(`${action} applies imported UI fields, DOM theme, native theme and startup cache together`, async () => {
    const app = setup();
    await app.store.getState()[action]("ui", {});
    const state = app.store.getState();
    assert.equal(state.dark, false);
    assert.equal(state.sidebarSide, "right");
    assert.equal(state.showClaude, false);
    assert.equal(state.showGemini, false);
    assert.equal(state.active, "service");
    assert.equal(JSON.stringify(state.hiddenNav), JSON.stringify(imported.ui.hiddenNav));
    assert.equal(JSON.stringify(state.navOrder), JSON.stringify(imported.ui.navOrder));
    assert.deepEqual(app.dom.at(-1), ["dark", false]);
    assert.equal(app.themes.at(-1), "light");
    assert.equal(app.storage.get("sharegpt-theme"), "light");
    assert.equal(app.storage.get("sharegpt-sidebar-side"), "right");
  });
}

test("late imported UI settings never change a newer principal theme or navigation", async () => {
  const pending = deferred();
  const app = setup({ loadSettings: () => pending.promise });
  const reload = app.store.getState().reloadSettings();
  app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime.activate("B", 2);
  pending.resolve(imported);
  await assert.rejects(reload, { name: "StaleSettingsPrincipalError" });
  assert.equal(app.store.getState().dark, true);
  assert.equal(app.themes.length, 0);
  assert.equal(app.dom.length, 0);
});

function concurrentSettings() {
  let stored = { settingsRevision: 0, ui: { hiddenNav: [], showClaude: true, showGemini: false } };
  const calls = [],
    failures = [];
  const app = rendererStoreHarness({
    modules: { "@/lib/errorToast": { showErrorToast: (e) => failures.push(e.message) } },
    document: { documentElement: { classList: { toggle() {} } } },
    api: {
      setThemeSource: async () => {},
      patchSettings: async (payload) => {
        const response = deferred();
        calls.push({ payload, response });
        await response.promise;
        assert.equal(payload.expectedRevision, stored.settingsRevision);
        stored = {
          ...stored,
          settingsRevision: stored.settingsRevision + 1,
          [payload.section]: { ...stored[payload.section], ...payload.patch },
        };
        return structuredClone(stored);
      },
    },
  });
  const store = app.load("store/useAppStore.ts").useAppStore;
  store.setState({
    settings: structuredClone(stored),
    hiddenNav: [],
    workspaceMode: "organization",
  });
  return { ...app, store, calls, failures, stored: () => stored };
}

test("rapid navigation edits serialize revisions without rolling back pending UI", async () => {
  const f = concurrentSettings();
  f.store.getState().setNavHidden("terminal", true);
  f.store.getState().setNavHidden("notes", true);
  await f.settle();
  assert.equal(f.calls.length, 1);
  f.calls[0].response.resolve();
  await f.settle();
  assert.equal(f.calls.length, 2);
  assert.deepEqual([...f.store.getState().hiddenNav], ["terminal", "notes"]);
  assert.equal(f.calls[1].payload.expectedRevision, 1);
  f.calls[1].response.resolve();
  await f.settle();
  assert.deepEqual([...f.stored().ui.hiddenNav], ["terminal", "notes"]);
  assert.deepEqual(f.failures, []);
});

test("an earlier non-UI save cannot re-enable a terminal being disabled", async () => {
  const f = concurrentSettings();
  const earlier = f.store.getState().patchSection("advancedAi", { enabled: false });
  f.store.getState().setNavHidden("terminal", true);
  await f.settle();
  f.calls[0].response.resolve();
  await earlier;
  await f.settle();
  assert.deepEqual([...f.store.getState().hiddenNav], ["terminal"]);
  f.calls[1].response.resolve();
  await f.settle();
  assert.equal(f.stored().ui.hiddenNav[0], "terminal");
});

test("failed UI persistence reports the error, restores saved state and permits retry", async () => {
  const f = concurrentSettings();
  f.store.getState().setNavHidden("terminal", true);
  await f.settle();
  f.calls[0].response.reject(new Error("disk full"));
  await f.settle();
  assert.deepEqual([...f.store.getState().hiddenNav], []);
  assert.equal(f.storage.get("sharegpt-hidden-nav"), "[]");
  assert.deepEqual(f.failures, ["disk full"]);
  f.store.getState().setNavHidden("terminal", true);
  await f.settle();
  f.calls[1].response.resolve();
  await f.settle();
  assert.equal(f.stored().ui.hiddenNav[0], "terminal");
});

test("queued old-account UI changes cancel quietly without blocking a new account", async () => {
  const f = concurrentSettings();
  f.store.getState().setNavHidden("terminal", true);
  f.store.getState().setNavHidden("notes", true);
  await f.settle();
  f.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime.activate("B", 2);
  f.store.setState({ hiddenNav: [], settings: { settingsRevision: 0, ui: { hiddenNav: [] } } });
  f.store.getState().setNavHidden("focus", true);
  await f.settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].payload.expectedPrincipalId, "B");
  f.calls[0].response.reject(new Error("old failure"));
  await f.settle();
  assert.deepEqual([...f.store.getState().hiddenNav], ["focus"]);
  assert.deepEqual(f.failures, []);
  f.calls[1].response.resolve();
  await f.settle();
  assert.equal(f.calls.length, 2);
});

test("rapidly reversing one switch preserves the newest intent until both saves finish", async () => {
  const f = concurrentSettings();
  f.store.getState().setNavHidden("terminal", true);
  f.store.getState().setNavHidden("terminal", false);
  await f.settle();
  f.calls[0].response.resolve();
  await f.settle();
  assert.deepEqual([...f.store.getState().hiddenNav], []);
  f.calls[1].response.resolve();
  await f.settle();
  assert.deepEqual([...f.stored().ui.hiddenNav], []);
});

test("a failed first UI write does not discard the next queued selection", async () => {
  const f = concurrentSettings();
  f.store.getState().setNavHidden("terminal", true);
  f.store.getState().setNavHidden("notes", true);
  await f.settle();
  f.calls[0].response.reject(new Error("temporary failure"));
  await f.settle();
  assert.deepEqual([...f.store.getState().hiddenNav], ["terminal", "notes"]);
  assert.equal(f.calls[1].payload.expectedRevision, 0);
  f.calls[1].response.resolve();
  await f.settle();
  assert.deepEqual([...f.stored().ui.hiddenNav], ["terminal", "notes"]);
  assert.deepEqual(f.failures, ["temporary failure"]);
});
