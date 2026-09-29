const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../renderer-next");
const requireRenderer = createRequire(path.join(root, "package.json"));

async function exercise(cancel) {
  let cleanup = () => {};
  let release = () => {};
  let reloads = 0;
  let puts = 0;
  const writes = [],
    removals = [],
    persisted = [];
  const merged = { "first.md": "remote first", "second.md": "remote second" };
  const raw = { "obsolete.md": "old" };
  const modules = new Map();
  const bridge = {
    vault: {
      write: async (name, content) => {
        writes.push(name);
        if (writes.length === 1)
          await new Promise((resolve) => {
            release = () => resolve(undefined);
          });
        raw[name] = content;
      },
      remove: async (name) => {
        removals.push(name);
        delete raw[name];
      },
      list: async () => [],
      readAll: async () => {
        reloads++;
        return Object.entries(raw).map(([name, content]) => ({
          path: name,
          content,
          ctime: 1,
          mtime: 1,
        }));
      },
    },
  };
  const mocks = {
    "@/lib/userDataTransitionState": {
      assertUserDataWritable() {},
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
        const set = (patch) =>
          Object.assign(state, typeof patch === "function" ? patch(state) : patch);
        const get = () => state;
        state = init(set, get);
        return Object.assign((selector) => selector(state), {
          getState: get,
          setState: set,
          subscribe: () => () => {},
        });
      },
    },
    "@/lib/api": {
      userDataApiFor: (snapshot) => load("lib/userDataApi").scopedUserDataApi(bridge, snapshot),
    },
    "@/store/useChatStore": {
      useChatStore: (selector) =>
        selector({
          identity: { serverUrl: "https://fixture.invalid", token: "synthetic-A", username: "A" },
        }),
    },
    "@/lib/wsBus": { wsBus: { subscribe: () => () => {} } },
  };
  function load(relative) {
    let file = path.resolve(root, "src", relative);
    if (!path.extname(file))
      file = fs.existsSync(`${file}.ts`) ? `${file}.ts` : path.join(file, "index.ts");
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(output, {
      exports,
      require(name) {
        if (mocks[name]) return mocks[name];
        if (name.startsWith("@/")) return load(name.slice(2));
        if (name.startsWith("."))
          return load(
            path.relative(path.join(root, "src"), path.resolve(path.dirname(file), name)),
          );
        return requireRenderer(name);
      },
      AbortController,
      console,
      setTimeout: () => 1,
      clearTimeout() {},
      localStorage: {
        getItem: (key) =>
          key === "notesync:base:A" ? JSON.stringify({ "obsolete.md": "old" }) : null,
        setItem: (...args) => persisted.push(args),
      },
      window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} },
      fetch: async (_url, options) => {
        if (options.method === "PUT") {
          puts++;
          assert.deepEqual(JSON.parse(options.body).data.files, merged);
          return { ok: true, json: async () => ({ rev: 2 }) };
        }
        return { ok: true, json: async () => ({ rev: 1, data: { files: merged } }) };
      },
    });
    return exports;
  }
  const runtime = load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  const vault = load("store/useVaultStore").useVaultStore;
  vault.setState({ loaded: true, root: "A", rawByPath: { ...raw } });
  load("hooks/useNotesSync").useNotesSync();
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["first.md"]);
  if (cancel) {
    cleanup();
    runtime.activate("B", 2);
  }
  release();
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  return { writes, removals, reloads, puts, persistedEntries: persisted.length };
}

test("cancelling Notes sync during its first write stops later writes, deletion, reload and old-credential push", async () => {
  assert.deepEqual(await exercise(true), {
    writes: ["first.md"],
    removals: [],
    reloads: 0,
    puts: 0,
    persistedEntries: 0,
  });
});

test("Notes sync completes every merge step when its Principal remains current", async () => {
  assert.deepEqual(await exercise(false), {
    writes: ["first.md", "second.md"],
    removals: ["obsolete.md"],
    reloads: 1,
    puts: 1,
    persistedEntries: 4,
  });
});
