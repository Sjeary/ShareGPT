const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness } = require("./helpers/rendererStoreHarness.cjs");

for (const initialStatus of [503, 0, 404])
  test(`calendar/tasks actual adapters classify and recover initial ${initialStatus || "network"} failure`, async (t) => {
    let cleanup = () => {},
      status = initialStatus,
      id = 0;
    const polls = new Map(),
      states = {},
      uploads = [],
      remotes = {},
      locals = {};
    const configs = Object.fromEntries(
      ["calendar", "tasks"].map((kind) => {
        locals[kind] = { items: [`${kind}-local`] };
        remotes[kind] = { rev: 1, data: { items: [`${kind}-remote`] } };
        return [
          kind,
          {
            isLoaded: () => true,
            getLocal: () => locals[kind],
            merge: (a, b) => ({ items: [...new Set([...a.items, ...b.items])] }),
            apply: (data) => {
              locals[kind] = data;
            },
            subscribe: () => () => {},
          },
        ];
      }),
    );
    const app = rendererStoreHarness({
      modules: {
        react: {
          useEffect: (fn) => {
            cleanup = fn();
          },
        },
        "@/store/useChatStore": {
          useChatStore: (select) =>
            select({
              identity: {
                serverUrl: "https://fixture.invalid",
                token: "synthetic-A",
                username: "A",
              },
            }),
        },
        "@/store/useCalendarStore": {
          useCalendarStore: { getState: () => ({ init: async () => {} }) },
        },
        "@/store/useTasksStore": { useTasksStore: { getState: () => ({ init: async () => {} }) } },
        "@/lib/cloudSync": {
          KIND_CONFIGS: configs,
          getStoredRev: () => 0,
          setStoredRev() {},
          useSyncStatus: {
            getState: () => ({
              setState: (kind, value) => {
                states[kind] = value;
              },
            }),
          },
        },
      },
      window: {
        setInterval: (fn) => {
          polls.set(++id, fn);
          return id;
        },
        clearInterval: (key) => polls.delete(key),
      },
      fetch: async (url, options) => {
        const kind = url.split("/").at(-1);
        if (options.method === "GET") {
          if (status === 0) throw new Error("offline");
          return { ok: status === 200, status, json: async () => structuredClone(remotes[kind]) };
        }
        const body = JSON.parse(options.body);
        assert.equal(body.baseRev, remotes[kind].rev);
        uploads.push(kind);
        remotes[kind] = { rev: body.baseRev + 1, data: body.data };
        return { ok: true, status: 200, json: async () => ({ rev: remotes[kind].rev }) };
      },
    });
    app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime.activate("A", 1);
    t.after(() => cleanup());
    const settle = async () => {
      for (let i = 0; i < 12; i++) await app.settle();
    };
    app.load("hooks/useCloudSync.ts").useCloudSync();
    await settle();
    if (initialStatus === 404) {
      assert.deepEqual(states, { calendar: "local", tasks: "local" });
      assert.equal(polls.size, 0);
      assert.deepEqual(uploads, []);
      return;
    }
    assert.deepEqual(states, { calendar: "error", tasks: "error" });
    assert.equal(polls.size, 2);
    status = 200;
    for (const fn of polls.values()) fn();
    await settle();
    assert.deepEqual(states, { calendar: "synced", tasks: "synced" });
    for (const kind of ["calendar", "tasks"]) {
      assert.deepEqual(remotes[kind].data.items, [`${kind}-local`, `${kind}-remote`]);
    }
  });
