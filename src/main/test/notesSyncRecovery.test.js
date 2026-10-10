const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const { rendererStoreHarness } = require("./helpers/rendererStoreHarness.cjs");
const requireRenderer = createRequire(path.resolve(__dirname, "../../renderer-next/package.json"));
const { createStore } = requireRenderer("zustand/vanilla");

function fixture(t) {
  const raw = { "shared.md": "base", "local.md": "not uploaded" };
  const removed = [],
    requests = [],
    polls = new Map();
  let cleanup, receive;
  let remote = { rev: 2, data: { files: { "shared.md": "remote edit" } } };
  let putStatus = 503;
  let getStatus = 200;
  const app = rendererStoreHarness({
    modules: {
      react: {
        useEffect: (fn) => {
          cleanup = fn();
        },
      },
      zustand: {
        create: (init) => {
          const store = createStore(init);
          return Object.assign((selector) => selector(store.getState()), store);
        },
      },
      "@/store/useChatStore": {
        useChatStore: (select) =>
          select({
            identity: {
              serverUrl: "https://fixture.invalid",
              token: "synthetic",
              username: "A",
            },
          }),
      },
      "@/lib/wsBus": {
        wsBus: {
          subscribe: (fn) => {
            receive = fn;
            return () => {};
          },
        },
      },
    },
    api: {
      vault: {
        write: async (name, content) => {
          raw[name] = content;
        },
        remove: async (name) => {
          removed.push(name);
          delete raw[name];
        },
        list: async () => [],
        readAll: async () =>
          Object.entries(raw).map(([path, content]) => ({ path, content, ctime: 1, mtime: 1 })),
      },
    },
    window: {
      setInterval: (fn) => {
        polls.set(1, fn);
        return 1;
      },
      clearInterval: (id) => polls.delete(id),
    },
    fetch: async (_url, options) => {
      requests.push(options.method);
      if (options.method === "GET" && !getStatus) throw new Error("offline");
      if (options.method === "GET")
        return {
          ok: getStatus === 200,
          status: getStatus,
          json: async () => structuredClone(remote),
        };
      const payload = JSON.parse(options.body);
      if (putStatus !== 200) return { ok: false, status: putStatus };
      assert.equal(payload.baseRev, remote.rev);
      remote = { rev: remote.rev + 1, data: payload.data };
      return { ok: true, json: async () => ({ rev: remote.rev }) };
    },
  });
  app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime.activate("A", 1);
  const vault = app.load("store/useVaultStore.ts").useVaultStore;
  vault.setState({ loaded: true, root: "fixture-A", rawByPath: { ...raw } });
  app.storage.set("notesync:base:A", JSON.stringify({ "shared.md": "base" }));
  app.storage.set("notesync:rev:A", "1");
  const sync = app.load("hooks/useNotesSync.ts");
  t.after(() => cleanup?.());
  const settle = async () => {
    for (let i = 0; i < 20; i++) await app.settle();
  };
  return {
    raw,
    removed,
    requests,
    polls,
    app,
    state: () => app.load("store/useNotesSyncStore.ts").useNotesSyncStore.getState().state,
    remote: () => remote,
    putStatus: (value) => {
      putStatus = value;
    },
    getStatus: (value) => {
      getStatus = value;
    },
    start: async () => {
      sync.useNotesSync();
      await settle();
    },
    restart: async () => {
      cleanup();
      sync.useNotesSync();
      await settle();
    },
    poll: async () => {
      for (const fn of polls.values()) fn();
      await settle();
    },
    update: async (files) => {
      remote = { rev: remote.rev + 1, data: { files } };
      receive({ type: "user_store_updated", kind: "notes", rev: remote.rev });
      await settle();
    },
  };
}

for (const restart of [false, true]) {
  test(`failed notes upload retains local-only data through a newer cloud revision${restart ? " after restart" : ""}`, async (t) => {
    const f = fixture(t);
    await f.start();
    assert.equal(f.state(), "error");
    assert.equal(f.remote().data.files["local.md"], undefined);
    if (restart) await f.restart();
    f.putStatus(200);
    await f.update({ "shared.md": "remote edit", "other.md": "another device" });
    assert.equal(f.raw["local.md"], "not uploaded");
    assert.equal(f.remote().data.files["local.md"], "not uploaded");
    assert.deepEqual(f.removed, []);
    assert.equal(f.state(), "synced");
  });
}

test("unchanged cloud revision retries a failed upload instead of declaring it synced", async (t) => {
  const f = fixture(t);
  await f.start();
  f.putStatus(200);
  await f.poll();
  assert.equal(f.requests.filter((v) => v === "PUT").length, 2);
  assert.equal(f.remote().data.files["local.md"], "not uploaded");
  assert.equal(f.state(), "synced");
});

test("continuous notes revision conflicts have a bounded retry count", async (t) => {
  const f = fixture(t);
  f.putStatus(409);
  await f.start();
  assert.equal(f.requests.filter((v) => v === "PUT").length, 3);
  assert.equal(f.state(), "error");
  assert.equal(f.raw["local.md"], "not uploaded");
});

for (const status of [503, 0]) {
  test(`initial notes failure (${status || "network"}) keeps polling and resumes uploads`, async (t) => {
    const f = fixture(t);
    f.getStatus(status);
    await f.start();
    assert.equal(f.state(), "error");
    assert.equal(f.polls.size, 1);
    assert.equal(f.raw["local.md"], "not uploaded");
    f.getStatus(200);
    f.putStatus(200);
    await f.poll();
    assert.equal(f.state(), "synced");
    assert.equal(f.remote().data.files["local.md"], "not uploaded");
  });
}

test("temporary notes failure after syncing recovers without remounting", async (t) => {
  const f = fixture(t);
  f.putStatus(200);
  await f.start();
  f.getStatus(503);
  await f.poll();
  assert.equal(f.state(), "error");
  f.getStatus(200);
  await f.poll();
  assert.equal(f.state(), "synced");
});

for (const status of [404, 405, 501]) {
  test(`legacy notes endpoint (${status}) stays local without repeated requests`, async (t) => {
    const f = fixture(t);
    f.getStatus(status);
    await f.start();
    assert.equal(f.state(), "local");
    await f.poll();
    assert.deepEqual(f.requests, ["GET"]);
  });
}
