const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness } = require("./helpers/rendererStoreHarness.cjs");

for (const boundary of ["account", "same-account transition"])
  test(`late cloud 409 cannot cross ${boundary} boundaries`, async () => {
    let cleanup = () => {};
    let resolveConflict = () => {};
    let generation = 1;
    let transitionRevision = 0;
    let reads = 0,
      applies = 0,
      puts = 0;
    const store = () => ({ getState: () => ({ init: async () => {} }) });
    const config = {
      isLoaded: () => true,
      getLocal: () => {
        reads++;
        return { tasks: [] };
      },
      apply: () => {
        applies++;
      },
      merge: () => ({}),
      subscribe: () => () => {},
    };
    const mocks = {
      "@/lib/userDataTransitionState": {
        useUserDataTransitionVersion: () => 0,
        userDataTransitionState: { isSuspended: () => false, revision: () => transitionRevision },
      },
      react: {
        useEffect: (fn) => {
          cleanup = fn();
        },
      },
      "@/store/useChatStore": {
        useChatStore: (selector) =>
          selector({
            identity: { serverUrl: "http://fixture.invalid", username: "A", token: "token-A" },
          }),
      },
      "@/store/useCalendarStore": { useCalendarStore: store() },
      "@/store/useTasksStore": { useTasksStore: store() },
      "@/lib/wsBus": { wsBus: { subscribe: () => () => {} } },
      "@/lib/settingsPrincipalRuntime": {
        StaleSettingsPrincipalError: Error,
        settingsPrincipalRuntime: {
          current: () => ({ principalId: generation === 1 ? "A" : "B", generation }),
        },
      },
      "@/lib/cloudSync": {
        KIND_CONFIGS: { tasks: config, calendar: config },
        getStoredRev: () => 0,
        setStoredRev: () => {},
        stable: JSON.stringify,
        useSyncStatus: { getState: () => ({ setState: () => {} }) },
      },
    };
    const app = rendererStoreHarness({
      modules: mocks,
      window: {
        setTimeout: () => 1,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
      },
      fetch: async (_url, options) => {
        if (options.method === "PUT") {
          puts++;
          return new Promise((resolve) => {
            resolveConflict = () =>
              resolve({
                ok: false,
                status: 409,
                json: async () => ({ rev: 1, data: { tasks: ["A"] } }),
              });
          });
        }
        return { ok: true, json: async () => ({ rev: 0, data: null }) };
      },
    });
    app.load("hooks/useCloudSync.ts").useCloudSync();
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(puts, 1);
    const readsBefore = reads;
    if (boundary === "account") {
      cleanup();
      generation++;
    } else transitionRevision++;
    resolveConflict();
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, readsBefore);
    assert.equal(applies, 0);
    assert.equal(puts, 1);
    cleanup();
  });
