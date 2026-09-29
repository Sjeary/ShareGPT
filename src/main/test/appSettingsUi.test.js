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
  app.store = app.load("store/useAppStore.ts").useAppStore;
  app.store.setState({
    dark: true,
    showClaude: true,
    showGemini: true,
    active: "claude",
    workspaceMode: "organization",
  });
  return { ...app, themes, dom };
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
