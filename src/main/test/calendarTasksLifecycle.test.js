const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");

const rendererRoot = path.resolve(__dirname, "../../renderer-next");
const requireRenderer = createRequire(path.join(rendererRoot, "package.json"));

function fixture(apiOverrides = {}, runtimeOverrides = {}) {
  const saved = { calendar: [], tasks: [] };
  const timers = new Map();
  let timerId = 0;
  const api = {
    loadCalendar: async () => null,
    loadTasks: async () => null,
    saveCalendar: async (value) => {
      saved.calendar.push(value);
      return value;
    },
    saveTasks: async (value) => {
      saved.tasks.push(value);
      return value;
    },
    ...apiOverrides,
  };
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(rendererRoot, "src", relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(
      compiled,
      {
        exports: module.exports,
        require(name) {
          if (Object.hasOwn(runtimeOverrides, name)) return runtimeOverrides[name];
          if (name === "@/lib/api") return { api };
          if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
          if (name.startsWith("."))
            return load(
              path.relative(
                path.join(rendererRoot, "src"),
                path.resolve(path.dirname(file), `${name}.ts`),
              ),
            );
          return requireRenderer(name);
        },
        crypto,
        structuredClone,
        console,
        AbortController,
        fetch: runtimeOverrides.fetch,
        window: {
          setTimeout: () => 1,
          clearTimeout() {},
          setInterval: () => 1,
          clearInterval() {},
        },
        localStorage: { getItem: () => null, setItem() {} },
        setTimeout(callback) {
          timers.set(++timerId, callback);
          return timerId;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      },
      { filename: file },
    );
    return module.exports;
  }
  return {
    load,
    saved,
    async drain() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("fresh personal stores create only stable empty containers without sample content", async () => {
  for (let launch = 0; launch < 2; launch++) {
    const app = fixture();
    const calendar = app.load("store/useCalendarStore.ts").useCalendarStore;
    const tasks = app.load("store/useTasksStore.ts").useTasksStore;
    await calendar.getState().init();
    await tasks.getState().init();
    assert.equal(calendar.getState().calendars[0].id, "default-personal");
    assert.equal(tasks.getState().lists[0].id, "default-inbox");
    assert.equal(calendar.getState().events.length, 0);
    assert.equal(tasks.getState().tasks.length, 0);
    assert.equal(tasks.getState().memos.length, 0);
  }
});

test("calendar removal persists child tombstones and stale cloud snapshots cannot restore them", async () => {
  const app = fixture();
  const store = app.load("store/useCalendarStore.ts").useCalendarStore;
  await store.getState().init();
  const calendar = store.getState().addCalendar({ name: "trip", color: "#123456" });
  const event = store.getState().addEvent({
    calendarId: calendar.id,
    title: "booking",
    start: "2026-01-02",
    end: "2026-01-03",
    allDay: true,
  });
  const stale = { calendars: store.getState().calendars, events: store.getState().events };
  store.getState().removeCalendar(calendar.id);
  const sync = app.load("lib/cloudSync.ts").KIND_CONFIGS.calendar;
  sync.apply(sync.merge(sync.getLocal(), stale));
  assert.equal(
    store.getState().calendars.some((entry) => entry.id === calendar.id),
    false,
  );
  assert.equal(store.getState().events.length, 0);
  assert.ok(store.getState().deleted.events[event.id]);
  await app.drain();
  const saved = app.saved.calendar.at(-1);
  assert.ok(saved.deleted.calendars[calendar.id]);
  assert.ok(saved.deleted.events[event.id]);
});

test("list removal preserves tasks in the inbox while explicit tasks and memos stay deleted", async () => {
  const app = fixture();
  const store = app.load("store/useTasksStore.ts").useTasksStore;
  await store.getState().init();
  const list = store.getState().addList({ name: "project", color: "#123456" });
  const kept = store.getState().addTask({ listId: list.id, title: "keep task" });
  const removed = store.getState().addTask({ title: "remove task" });
  const memo = store.getState().addMemo({ body: "remove memo" });
  const stale = {
    lists: store.getState().lists,
    tasks: store.getState().tasks,
    memos: store.getState().memos,
  };
  store.getState().removeList(list.id);
  store.getState().removeTask(removed.id);
  store.getState().removeMemo(memo.id);
  const sync = app.load("lib/cloudSync.ts").KIND_CONFIGS.tasks;
  sync.apply(sync.merge(sync.getLocal(), stale));
  assert.equal(store.getState().tasks.length, 1);
  assert.equal(store.getState().tasks[0].id, kept.id);
  assert.equal(store.getState().tasks[0].listId, "default-inbox");
  assert.equal(store.getState().memos.length, 0);
  await app.drain();
  const saved = app.saved.tasks.at(-1);
  assert.ok(saved.deleted.lists[list.id]);
  assert.ok(saved.deleted.tasks[removed.id]);
  assert.ok(saved.deleted.memos[memo.id]);
});

function deferred() {
  let resolve = (_value = undefined) => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("personal save queue captures payloads and never starts queued writes after an account switch", async () => {
  const app = fixture();
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  const { createPrincipalDebouncedSave } = app.load("lib/principalDebouncedSave.ts");
  const pending = deferred();
  const writes = [];
  const queue = createPrincipalDebouncedSave((payload) => {
    writes.push(payload);
    return pending.promise;
  });
  const snapshot = runtime.activate("A", 1);
  const first = { title: "first" };
  queue.schedule(first, snapshot);
  first.title = "mutated after scheduling";
  const firstFlush = queue.flushPending();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes[0].title, "first");
  queue.schedule({ title: "queued" }, snapshot);
  const secondFlush = queue.flushPending();
  runtime.activate("B", 2);
  pending.resolve();
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(writes.length, 1);
});

for (const [kind, name, collection] of [
  ["Calendar", "useCalendarStore", "calendars"],
  ["Tasks", "useTasksStore", "lists"],
]) {
  test(`${kind}: delayed old-account initialization cannot replace the new account`, async () => {
    const first = deferred();
    let loadCalls = 0;
    const fixtureData =
      kind === "Calendar"
        ? { calendars: [{ id: "b", name: "B", color: "#123456" }], events: [] }
        : {
            lists: [{ id: "b", name: "B", color: "#123456", isInbox: true }],
            tasks: [],
            memos: [],
          };
    const app = fixture({
      [`load${kind}`]: () => (++loadCalls === 1 ? first.promise : Promise.resolve(fixtureData)),
    });
    const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
    const store = app.load(`store/${name}.ts`)[name];
    runtime.activate("A", 1);
    const oldInit = store.getState().init();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loadCalls, 1, "the old request must have started before the account changes");
    runtime.activate("B", 2);
    store.getState().resetForPrincipal();
    await store.getState().init();
    first.resolve(null);
    await oldInit;
    assert.equal(store.getState()[collection][0].id, "b");
    assert.equal(app.saved.calendar.length + app.saved.tasks.length, 0);
  });

  test(`${kind}: flush owns one save and reset cancels old-account pending writes`, async () => {
    const app = fixture();
    const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
    const store = app.load(`store/${name}.ts`)[name];
    runtime.activate("A", 1);
    await store.getState().init();
    const saves = kind === "Calendar" ? app.saved.calendar : app.saved.tasks;
    saves.length = 0;
    const add = () =>
      kind === "Calendar"
        ? store.getState().addCalendar({ name: "A", color: "#123456" })
        : store.getState().addList({ name: "A", color: "#123456" });
    add();
    await Promise.all([store.getState().flushPending(), store.getState().flushPending()]);
    assert.equal(saves.length, 1);
    assert.equal(saves[0][collection].length, 2);
    add();
    runtime.activate("B", 2);
    store.getState().resetForPrincipal();
    await app.drain();
    assert.equal(saves.length, 1);
    assert.equal(store.getState()[collection].length, 0);
    assert.equal(store.getState().loaded, false);
  });

  test(`${kind}: old cloud apply and failed reads never seed replacement data`, async () => {
    const app = fixture({
      [`load${kind}`]: async () => {
        throw new Error("test load failed");
      },
    });
    const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
    const store = app.load(`store/${name}.ts`)[name];
    const snapshot = runtime.activate("A", 1);
    await store.getState().init();
    assert.equal(store.getState().loaded, false);
    assert.equal(app.saved.calendar.length + app.saved.tasks.length, 0);
    runtime.activate("A", 2);
    store.getState().resetForPrincipal();
    const sync = app.load("lib/cloudSync.ts").KIND_CONFIGS[kind.toLowerCase()];
    assert.throws(() => sync.apply(sync.getLocal(), snapshot), {
      name: "StaleSettingsPrincipalError",
    });
    assert.equal(store.getState()[collection].length, 0);
  });

  test(`${kind}: concurrent initialization shares one load and leaves both callers ready`, async () => {
    const pending = deferred();
    let loads = 0;
    const app = fixture({
      [`load${kind}`]: () => {
        loads++;
        return pending.promise;
      },
    });
    const store = app.load(`store/${name}.ts`)[name];
    const panel = store.getState().init();
    const cloud = store.getState().init();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loads, 1);
    assert.equal(store.getState().loaded, false);
    pending.resolve(null);
    await Promise.all([panel, cloud]);
    assert.equal(store.getState().loaded, true);
    assert.equal((kind === "Calendar" ? app.saved.calendar : app.saved.tasks).length, 1);
  });
}

test("failed new-account loads stay unavailable to cloud sync and can retry", async () => {
  let account = "A";
  let failLoads = false;
  const uploads = [];
  let cleanup = () => {};
  let receiveRealtime = (_payload) => {};
  const getCalendar = () => ({
    calendars: [{ id: account, name: account, color: "#123456" }],
    events: [],
  });
  const getTasks = () => ({
    lists: [{ id: account, name: account, color: "#123456", isInbox: true }],
    tasks: [],
    memos: [],
  });
  const app = fixture(
    {
      loadCalendar: async () => {
        if (failLoads) throw new Error("fixture read failure");
        return getCalendar();
      },
      loadTasks: async () => {
        if (failLoads) throw new Error("fixture read failure");
        return getTasks();
      },
    },
    {
      react: {
        useEffect(fn) {
          cleanup = fn();
        },
      },
      "@/store/useChatStore": {
        useChatStore: (selector) =>
          selector({
            identity: { serverUrl: "http://fixture.invalid", username: account, token: account },
          }),
      },
      "@/lib/wsBus": {
        wsBus: {
          subscribe: (handler) => {
            receiveRealtime = handler;
            return () => {
              receiveRealtime = () => {};
            };
          },
        },
      },
      fetch: async (_url, options) => {
        if (options.method === "PUT") uploads.push(JSON.parse(options.body).data);
        return {
          ok: true,
          json: async () => ({ rev: options.method === "PUT" ? 1 : 0, data: null }),
        };
      },
    },
  );
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  const calendar = app.load("store/useCalendarStore.ts").useCalendarStore;
  const tasks = app.load("store/useTasksStore.ts").useTasksStore;
  runtime.activate("A", 1);
  await Promise.all([calendar.getState().init(), tasks.getState().init()]);
  account = "B";
  failLoads = true;
  runtime.activate("B", 2);
  const hook = app.load("hooks/useCloudSync.ts");
  hook.useCloudSync();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calendar.getState().loaded, false);
  assert.equal(tasks.getState().loaded, false);
  assert.equal(uploads.length, 0);
  const calendarBeforeRealtime = JSON.stringify(calendar.getState().calendars);
  const tasksBeforeRealtime = JSON.stringify(tasks.getState().lists);
  receiveRealtime({ type: "user_store_updated", kind: "calendar", rev: 7, data: getCalendar() });
  receiveRealtime({ type: "user_store_updated", kind: "tasks", rev: 7, data: getTasks() });
  assert.equal(calendar.getState().loaded, false);
  assert.equal(tasks.getState().loaded, false);
  assert.equal(JSON.stringify(calendar.getState().calendars), calendarBeforeRealtime);
  assert.equal(JSON.stringify(tasks.getState().lists), tasksBeforeRealtime);
  assert.equal(uploads.length, 0);
  failLoads = false;
  await Promise.all([calendar.getState().init(), tasks.getState().init()]);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calendar.getState().loaded, true);
  assert.equal(tasks.getState().loaded, true);
  assert.equal(calendar.getState().calendars[0].id, "B");
  assert.equal(tasks.getState().lists[0].id, "B");
  assert.equal(uploads.length, 2);
  assert.equal(JSON.stringify(uploads).includes('"A"'), false);
  cleanup();
});
