const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../renderer-next");
const requireRenderer = createRequire(path.join(root, "package.json"));

function fixture() {
  const modules = new Map();
  const files = new Map();
  const calls = [];
  let failSave = false;
  const timers = new Set();
  const localStorage = new Map();
  function load(input) {
    let file = path.resolve(root, "src", input);
    if (!path.extname(file))
      file = fs.existsSync(`${file}.ts`) ? `${file}.ts` : path.join(file, "index.ts");
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const apiFor = (snapshot) => {
      const scope = files.get(snapshot.principalId) || {};
      files.set(snapshot.principalId, scope);
      const call =
        (name, write = false) =>
        async (value, content) => {
          load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime.assertCurrent(snapshot);
          calls.push({ name, id: snapshot.principalId });
          if (write && failSave) throw new Error("fixture save failure");
          if (name === "vault.write") {
            (scope.vault ||= {})[value] = content;
            return;
          }
          if (name === "vault.readAll")
            return Object.entries(scope.vault || {}).map(([p, text]) => ({
              path: p,
              content: text,
              mtime: 1,
              ctime: 1,
            }));
          if (name === "vault.list") return [];
          if (name === "vault.getRoot") return snapshot.principalId;
          if (name === "vault.start") return;
          if (write) {
            scope[name.replace("save", "")] = structuredClone(value);
            return value;
          }
          return structuredClone(scope[name.replace("load", "")] ?? null);
        };
      return Object.assign(
        Object.fromEntries(
          ["Calendar", "Tasks", "Focus", "ChatHistory"].flatMap((kind) => [
            [`load${kind}`, call(`load${kind}`)],
            [`save${kind}`, call(`save${kind}`, true)],
          ]),
        ),
        {
          vault: {
            start: call("vault.start"),
            getRoot: call("vault.getRoot"),
            list: call("vault.list"),
            readAll: call("vault.readAll"),
            write: call("vault.write", true),
          },
        },
      );
    };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: 1, target: 9, esModuleInterop: true },
      }).outputText,
      {
        exports,
        require(name) {
          if (name === "@/lib/api")
            return { userDataApiFor: apiFor, api: { showSystemNotification: async () => {} } };
          if (name === "./api" && path.basename(file) === "chatPersistence.ts")
            return { userDataApiFor: apiFor };
          if (name === "@/lib/noise") return { startNoise() {}, stopNoise() {} };
          if (name.startsWith("@/")) return load(name.slice(2));
          if (name.startsWith("."))
            return load(
              path.relative(path.join(root, "src"), path.resolve(path.dirname(file), name)),
            );
          return requireRenderer(name);
        },
        crypto: require("node:crypto").webcrypto,
        structuredClone,
        console,
        AbortController,
        localStorage: {
          getItem: (key) => localStorage.get(key) || null,
          setItem: (key, value) => localStorage.set(key, value),
        },
        setTimeout: (fn) => {
          timers.add(fn);
          return fn;
        },
        clearTimeout: (fn) => timers.delete(fn),
      },
      { filename: file },
    );
    return exports;
  }
  return {
    load,
    files,
    calls,
    failSave: (value) => {
      failSave = value;
    },
  };
}

test("data transitions flush matching owners, preserve failed drafts and restore A/B/A", async () => {
  const f = fixture(),
    runtime = f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime;
  const calendar = f.load("store/useCalendarStore").useCalendarStore;
  const tasks = f.load("store/useTasksStore").useTasksStore;
  const focus = f.load("store/useFocusStore").useFocusStore;
  const vault = f.load("store/useVaultStore").useVaultStore;
  const chat = f.load("lib/chatPersistence").chatPersistence;
  const lifecycle = f.load("lib/userDataLifecycle");
  runtime.activate("A", 1);
  f.files.set("A", { vault: { "note.md": "original" } });
  await Promise.all([
    calendar.getState().init(),
    tasks.getState().init(),
    focus.getState().init(),
    vault.getState().init(),
    chat.init(),
  ]);
  await vault.getState().openNote("note.md");
  vault.getState().setDraft("unsaved A");
  tasks.getState().addTask({ title: "A task" });
  f.failSave(true);
  let switched = false;
  await assert.rejects(
    lifecycle.withUserDataTransition(
      async () => {
        switched = true;
        runtime.activate("B", 2);
      },
      { reload: true },
    ),
    /fixture save failure/,
  );
  assert.equal(switched, false);
  assert.equal(vault.getState().draft, "unsaved A");
  assert.equal(vault.getState().dirty, true);
  f.failSave(false);
  await lifecycle.withUserDataTransition(async () => runtime.activate("B", 2), { reload: true });
  assert.equal(f.files.get("A").vault["note.md"], "unsaved A");
  assert.equal(f.files.get("A").Tasks.tasks[0].title, "A task");
  assert.equal(tasks.getState().tasks.length, 0);
  assert.deepEqual(Object.keys(vault.getState().rawByPath), []);
  await lifecycle.withUserDataTransition(async () => runtime.activate("A", 3), { reload: true });
  assert.equal(tasks.getState().tasks[0].title, "A task");
  assert.equal(vault.getState().rawByPath["note.md"], "unsaved A");
});

test("URL-prefixed chat buckets stay untouched and are never adopted by a new account", async () => {
  const f = fixture(),
    runtime = f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  f.files.set("A", {
    ChatHistory: {
      conversations: {
        "https://legacy.invalid\u0000room:x": [{ id: "old", timestamp: "2026-01-01", text: "old" }],
      },
    },
  });
  const chat = f.load("lib/chatPersistence").chatPersistence;
  await assert.rejects(chat.init(), /确认归属/);
  chat.schedule();
  await chat.flushPending();
  assert.equal(
    f.calls.some((c) => c.name === "saveChatHistory"),
    false,
  );
});
