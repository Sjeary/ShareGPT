const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

test("focus failed reads block edits and never overwrite existing sessions; retry restores them", async () => {
  const previous = { id: "existing", minutes: 25, date: "2026-01-01" };
  let failed = true;
  const app = rendererStoreHarness({
    api: {
      loadFocus: async () => {
        if (failed) throw new Error("unreadable");
        return { sessions: [previous], settings: { focusMin: 20 } };
      },
    },
  });
  const store = app.load("store/useFocusStore.ts").useFocusStore;
  await store.getState().init();
  assert.equal(store.getState().loaded, false);
  assert.match(store.getState().loadError, /无法读取/);
  for (const edit of [
    () => store.getState().setSettings({ focusMin: 60 }),
    () => store.getState().setTaskId("task"),
    () => store.getState().start(),
  ])
    assert.throws(edit, /尚未加载/);
  await store.getState().flushPending();
  assert.equal(app.saved.focus.length, 0);
  failed = false;
  await store.getState().init();
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().sessions[0].id, previous.id);
  store.getState().setSettings({ sound: "none" });
  await store.getState().flushPending();
  assert.equal(app.saved.focus.at(-1).sessions[0].id, previous.id);
});

test("focus delayed load success or failure cannot replace another principal", async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    let loads = 0;
    const app = rendererStoreHarness({
      api: {
        loadFocus: () =>
          ++loads === 1 ? pending.promise : Promise.resolve({ sessions: [{ id: "B" }] }),
      },
    });
    const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
    const store = app.load("store/useFocusStore.ts").useFocusStore;
    runtime.activate("A", 1);
    const old = store.getState().init();
    await app.settle();
    runtime.activate("B", 2);
    store.getState().resetForPrincipal();
    await store.getState().init();
    if (fail) pending.reject(new Error("late"));
    else pending.resolve({ sessions: [{ id: "A" }] });
    await old;
    assert.equal(store.getState().sessions[0].id, "B");
    assert.equal(store.getState().loaded, true);
    assert.equal(store.getState().loadError, "");
  }
});
