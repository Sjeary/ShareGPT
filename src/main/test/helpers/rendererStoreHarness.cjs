const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../renderer-next");
const requireRenderer = createRequire(path.join(root, "package.json"));

// All persistence, time, browser APIs and notifications stay in memory.
function rendererStoreHarness(overrides = {}) {
  const modules = new Map();
  const timers = new Map();
  const storage = new Map();
  const saved = { focus: [], calendar: [], tasks: [] };
  let now = Date.parse("2026-01-02T12:00:00Z");
  let timer = 0;
  const api = { showSystemNotification: async () => {} };
  for (const kind of Object.keys(saved)) {
    const name = kind[0].toUpperCase() + kind.slice(1);
    api[`load${name}`] = async () => null;
    api[`save${name}`] = async (data) => {
      saved[kind].push(structuredClone(data));
      return data;
    };
  }
  Object.assign(api, overrides.api);
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  function load(relative) {
    const file = path.resolve(root, "src", relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(
      compiled,
      {
        module,
        exports: module.exports,
        require(name) {
          if (Object.hasOwn(overrides.modules || {}, name)) return overrides.modules[name];
          if (name === "@/lib/api") return { api, userDataApiFor: () => api };
          if (name === "@/lib/noise") return { startNoise() {}, stopNoise() {} };
          if (name === "@/lib/userDataTransitionState")
            return {
              assertUserDataWritable() {},
              useUserDataTransitionVersion: () => 0,
              userDataTransitionState: { isSuspended: () => false, revision: () => 0 },
            };
          if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
          if (name.startsWith("."))
            return load(
              path.relative(
                path.join(root, "src"),
                path.resolve(path.dirname(file), name.endsWith(".ts") ? name : `${name}.ts`),
              ),
            );
          return requireRenderer(name);
        },
        crypto,
        structuredClone,
        console,
        AbortController,
        Date: Clock,
        fetch: overrides.fetch,
        localStorage,
        window: {
          setInterval: () => 1,
          clearInterval() {},
          setTimeout: () => 1,
          clearTimeout() {},
        },
        document: overrides.document,
        setTimeout: (callback) => {
          timers.set(++timer, callback);
          return timer;
        },
        clearTimeout: (id) => timers.delete(id),
      },
      { filename: file },
    );
    return module.exports;
  }
  return {
    load,
    saved,
    api,
    storage,
    advance(ms) {
      now += ms;
    },
    async settle() {
      await new Promise((r) => setImmediate(r));
    },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
module.exports = { rendererStoreHarness, deferred };
