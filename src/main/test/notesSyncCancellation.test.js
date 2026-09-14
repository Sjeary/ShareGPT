const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

async function exercise(cancel) {
  const source = fs.readFileSync(
    path.join(__dirname, "../../renderer-next/src/hooks/useNotesSync.ts"),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let generation = 1;
  let cleanup = () => {};
  let release = () => {};
  let reloads = 0;
  let puts = 0;
  const writes = [],
    removals = [],
    persisted = [];
  const merged = { "first.md": "remote first", "second.md": "remote second" };
  const raw = { "obsolete.md": "old" };
  const store = {
    loaded: true,
    rawByPath: raw,
    reload: async () => {
      reloads++;
      Object.assign(raw, merged);
      delete raw["obsolete.md"];
    },
  };
  const exports = {};
  const mocks = {
    "@/lib/userDataTransitionState": {
      useUserDataTransitionVersion: () => 0,
      userDataTransitionState: { isSuspended: () => false, revision: () => 0 },
    },
    react: {
      useEffect: (fn) => {
        cleanup = fn();
      },
    },
    zustand: {
      create: (init) => {
        let state;
        state = init((patch) => Object.assign(state, patch));
        return { getState: () => state };
      },
    },
    "@/lib/api": {
      api: {
        vault: {
          write: async (name) => {
            writes.push(name);
            if (writes.length === 1)
              await new Promise((resolve) => {
                release = () => resolve(undefined);
              });
          },
          remove: async (name) => {
            removals.push(name);
          },
        },
      },
    },
    "@/store/useChatStore": {
      useChatStore: (selector) =>
        selector({
          identity: { serverUrl: "https://fixture.invalid", token: "synthetic-A", username: "A" },
        }),
    },
    "@/store/useVaultStore": {
      useVaultStore: { getState: () => store, subscribe: () => () => {} },
    },
    "@/lib/wsBus": { wsBus: { subscribe: () => () => {} } },
    "@/lib/settingsPrincipalRuntime": {
      settingsPrincipalRuntime: {
        current: () => ({ principalId: generation === 1 ? "A" : "B", generation }),
      },
    },
    "@/lib/notes/merge": {
      mergeVault: () => ({
        changed: true,
        merged,
        fromCloud: ["first.md", "second.md"],
        conflicts: [],
        deleted: ["obsolete.md"],
      }),
    },
  };
  mocks["@/lib/api"].userDataApiFor = () => mocks["@/lib/api"].api;
  vm.runInNewContext(output, {
    exports,
    require: (name) => mocks[name],
    AbortController,
    console,
    localStorage: { getItem: () => null, setItem: (...args) => persisted.push(args) },
    window: {
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    },
    fetch: async (_url, options) => {
      if (options.method === "PUT") {
        puts++;
        return { ok: true, json: async () => ({ rev: 2 }) };
      }
      return { ok: true, json: async () => ({ rev: 1, data: { files: merged } }) };
    },
  });
  exports.useNotesSync();
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["first.md"]);
  if (cancel) {
    cleanup();
    generation++;
  }
  release();
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  return { writes, removals, reloads, puts, persistedEntries: persisted.length };
}

test("cancelling Notes sync during its first write stops later writes, deletion, reload and old-credential push", async () => {
  const result = await exercise(true);
  assert.deepEqual(result, {
    writes: ["first.md"],
    removals: [],
    reloads: 0,
    puts: 0,
    persistedEntries: 0,
  });
});

test("Notes sync completes every merge step when its Principal remains current", async () => {
  const result = await exercise(false);
  assert.deepEqual(result, {
    writes: ["first.md", "second.md"],
    removals: ["obsolete.md"],
    reloads: 1,
    puts: 1,
    persistedEntries: 4,
  });
});
