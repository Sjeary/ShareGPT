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
  let failRead = false;
  let pickedRoot = null;
  let beforeWrite = null;
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
          if (!write && failRead) throw new Error("fixture read failure");
          if (write && failSave) throw new Error("fixture save failure");
          if (name === "vault.pickFolder") return pickedRoot;
          if (name === "vault.setRoot") {
            scope.roots ||= { [snapshot.principalId]: scope.vault || {} };
            scope.root = value;
            scope.vault = scope.roots[value] ||= {};
            return { root: value };
          }
          if (name === "vault.remove") {
            delete scope.vault[value];
            return;
          }
          if (name === "vault.write") {
            if (beforeWrite) await beforeWrite(value, content);
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
            pickFolder: call("vault.pickFolder"),
            setRoot: call("vault.setRoot", true),
            remove: call("vault.remove", true),
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
    pickRoot: (root) => {
      pickedRoot = root;
    },
    beforeWrite: (fn) => {
      beforeWrite = fn;
    },
    failRead: (value) => {
      failRead = value;
    },
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

test("same-account calendar import preserves the active note and ongoing focus session", async () => {
  const f = fixture();
  const runtime = f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  f.files.set("A", { vault: { "note.md": "original" } });
  const calendar = f.load("store/useCalendarStore").useCalendarStore;
  const vault = f.load("store/useVaultStore").useVaultStore;
  const focus = f.load("store/useFocusStore").useFocusStore;
  await Promise.all([calendar.getState().init(), vault.getState().init(), focus.getState().init()]);
  await vault.getState().openNote("note.md");
  vault.getState().setDraft("current draft");
  focus.getState().start();
  const endAt = focus.getState().endAt;
  await f.load("lib/userDataLifecycle").withUserDataTransition(
    async () => {
      f.files.get("A").Calendar = {
        calendars: [{ id: "imported", name: "Imported", color: "#123456" }],
        events: [],
      };
    },
    { reload: ["calendar"] },
  );
  assert.equal(calendar.getState().calendars[0].id, "imported");
  assert.equal(vault.getState().currentPath, "note.md");
  assert.equal(vault.getState().draft, "current draft");
  assert.equal(f.files.get("A").vault["note.md"], "current draft");
  assert.equal(focus.getState().running, true);
  assert.equal(focus.getState().endAt, endAt);
});

test("an unreadable vault never publishes a partial snapshot or an editable empty note", async () => {
  const f = fixture();
  f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime.activate("A", 1);
  f.files.set("A", { vault: { "kept.md": "saved" } });
  const vault = f.load("store/useVaultStore").useVaultStore;
  f.failRead(true);
  await vault.getState().init();
  assert.equal(vault.getState().loaded, false);
  assert.match(vault.getState().loadError, /无法完整读取/);
  f.failRead(false);
  await vault.getState().init();
  await vault.getState().openNote("kept.md");
  f.failRead(true);
  await assert.rejects(vault.getState().reload(), /fixture read failure/);
  assert.equal(vault.getState().rawByPath["kept.md"], "saved");
  assert.equal(vault.getState().draft, "saved");
  await assert.rejects(vault.getState().openNote("missing.md"));
  assert.equal(vault.getState().currentPath, "kept.md");
});

test("switching vault flushes the old draft and never reuses it for a same-name destination", async () => {
  const f = fixture();
  f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime.activate("A", 1);
  const original = { "same.md": "old disk" };
  const destination = { "same.md": "destination" };
  f.files.set("A", { vault: original, roots: { A: original, next: destination } });
  const vault = f.load("store/useVaultStore").useVaultStore;
  await vault.getState().init();
  await vault.getState().openNote("same.md");
  vault.getState().setDraft("saved to original only");
  f.pickRoot("next");
  f.failSave(true);
  await assert.rejects(vault.getState().setRootViaDialog(), /fixture save failure/);
  assert.equal(vault.getState().draft, "saved to original only");
  assert.equal(vault.getState().root, "A");
  f.failSave(false);
  await vault.getState().setRootViaDialog();
  assert.equal(original["same.md"], "saved to original only");
  assert.equal(destination["same.md"], "destination");
  assert.equal(vault.getState().currentPath, null);
  await vault.getState().openNote("same.md");
  assert.equal(vault.getState().draft, "destination");
});

test("cloud deletion includes dirty notes and a late local edit survives the merge", async () => {
  const f = fixture();
  f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime.activate("A", 1);
  f.files.set("A", { vault: { "note.md": "base", "other.md": "other" } });
  const vault = f.load("store/useVaultStore").useVaultStore;
  await vault.getState().init();
  await vault.getState().openNote("note.md");
  vault.getState().setDraft("local unsaved");
  const report = await vault.getState().mergeFromCloud({ "note.md": "base" }, {});
  assert.equal(report.merged["note.md"], "local unsaved");
  assert.equal(vault.getState().draft, "local unsaved");
  assert.equal(f.files.get("A").vault["note.md"], "local unsaved");
  let release;
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  f.beforeWrite(async () => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  const merging = vault
    .getState()
    .mergeFromCloud({ "note.md": "local unsaved" }, { "note.md": "cloud update" });
  await pending;
  vault.getState().setDraft("typing during merge");
  release();
  await merging;
  assert.equal(vault.getState().draft, "typing during merge");
  assert.equal(vault.getState().dirty, true);
  f.beforeWrite(null);
  await vault.getState().flushPending();
  assert.equal(f.files.get("A").vault["note.md"], "typing during merge");
});

test("navigation waits for edits made while the previous save is still in flight", async () => {
  const f = fixture();
  f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime.activate("A", 1);
  f.files.set("A", { vault: { "a.md": "a", "b.md": "b" } });
  const vault = f.load("store/useVaultStore").useVaultStore;
  await vault.getState().init();
  await vault.getState().openNote("a.md");
  vault.getState().setDraft("first change");
  let release;
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  f.beforeWrite(async () => {
    f.beforeWrite(null);
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  const opening = vault.getState().openNote("b.md");
  await pending;
  vault.getState().setDraft("second change during save");
  release();
  await opening;
  assert.equal(vault.getState().currentPath, "b.md");
  assert.equal(vault.getState().draft, "b");
  assert.equal(f.files.get("A").vault["a.md"], "second change during save");
});

test("Principal transitions clear the Notes comparison report before loading the next account", async () => {
  const f = fixture();
  const runtime = f.load("lib/settingsPrincipalRuntime").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  const sync = f.load("store/useNotesSyncStore").useNotesSyncStore;
  sync
    .getState()
    .showReport({
      fromCloud: ["A-private.md"],
      conflicts: [],
      deleted: [],
      merged: {},
      keptLocal: [],
      autoMerged: [],
      changed: true,
    });
  assert.equal(sync.getState().compareOpen, true);
  await f
    .load("lib/userDataLifecycle")
    .withUserDataTransition(async () => runtime.activate("B", 2), { reload: true });
  assert.equal(sync.getState().compareOpen, false);
  assert.equal(sync.getState().lastReport, null);
});
