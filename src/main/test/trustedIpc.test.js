const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createTrustedIpc } = require("../trustedIpc");

function setup(assertPrincipal = null, serializeData = false) {
  const handles = new Map();
  const listeners = new Map();
  const ipc = createTrustedIpc({
    ipcMain: {
      handle: (name, fn) => handles.set(name, fn),
      on: (name, fn) => listeners.set(name, fn),
    },
    openExternal: async () => {},
    assertPrincipal,
    serializeData,
  });
  let nextId = 0;
  function windowFor(role, file = path.resolve(`${role}.html`)) {
    const contents = Object.assign(new EventEmitter(), {
      id: ++nextId,
      mainFrame: { url: pathToFileURL(file).href },
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
    });
    ipc.registerWindow({ webContents: contents }, { type: "file", target: file }, role);
    return { contents, event: { sender: contents, senderFrame: contents.mainFrame } };
  }
  return { ipc, handles, listeners, windowFor };
}

test("privileged IPC accepts the registered main document and rejects subframes, foreign windows and changed files", () => {
  const { ipc, handles, windowFor } = setup();
  const main = windowFor("main");
  const other = windowFor("profile");
  let writes = 0;
  ipc.handle("vault:write", () => ++writes);
  const write = handles.get("vault:write");
  assert.equal(write(main.event), 1);
  assert.throws(() => write({ ...main.event, senderFrame: { url: main.contents.mainFrame.url } }));
  assert.throws(() => write(other.event));
  assert.throws(() => write({ ...main.event, sender: { id: main.contents.id } }));
  main.contents.mainFrame.url += "?theme=dark#pane";
  assert.equal(write(main.event), 2);
  main.contents.mainFrame.url = pathToFileURL(path.resolve("untrusted.html")).href;
  assert.throws(() => write(main.event));
  assert.equal(writes, 2);
});

test("account activation waits for ongoing file IO and queued retired writes never start", async () => {
  let generation = 1;
  const { ipc, handles, windowFor } = setup((snapshot) => {
    if (snapshot?.generation !== generation) throw new Error("stale");
  }, true);
  const main = windowFor("main");
  const events = [];
  let release = () => {};
  ipc.handle("vault:write", async (_event, payload) => {
    events.push(`start:${payload}`);
    if (payload === "first")
      await new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    events.push(`end:${payload}`);
  });
  ipc.handle("settings:principal-activate", () => {
    generation++;
    events.push("switch");
  });
  const first = handles.get("vault:write")(main.event, "first", { generation: 1 });
  const switched = handles.get("settings:principal-activate")(main.event);
  const retired = handles.get("vault:write")(main.event, "retired", { generation: 1 });
  const rejected = assert.rejects(retired, /stale/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:first"]);
  release();
  await Promise.all([first, switched, rejected]);
  assert.deepEqual(events, ["start:first", "end:first", "switch"]);
  await handles.get("vault:write")(main.event, "current", { generation: 2 });
  assert.deepEqual(events.slice(-2), ["start:current", "end:current"]);
});

test("every data IPC keeps its existing payload and rejects stale generations", async () => {
  let generation = 1;
  const { ipc, handles, windowFor } = setup((snapshot) => {
    if (snapshot?.principalId !== "A" || snapshot.generation !== generation)
      throw new Error("stale");
  });
  const main = windowFor("main");
  const channels = [
    "chat-history:load",
    "chat-history:save",
    "calendar:load",
    "calendar:save",
    "tasks:load",
    "tasks:save",
    "focus:load",
    "focus:save",
    "vault:start",
    "vault:get-root",
    "vault:set-root",
    "vault:pick-folder",
    "vault:list",
    "vault:read-all",
    "vault:read",
    "vault:read-binary",
    "vault:write",
    "vault:create",
    "vault:rename",
    "vault:remove",
    "vault:import",
  ];
  for (const channel of channels) {
    let calls = 0;
    let complete = (_value) => {};
    const input = { value: channel };
    ipc.handle(channel, (_event, payload) => {
      assert.equal(payload, input);
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const handler = handles.get(channel);
    assert.throws(() => handler(main.event, input), /stale/);
    const snapshot = { principalId: "A", generation };
    const pending = handler(main.event, input, snapshot);
    generation++;
    assert.throws(() => handler(main.event, input, snapshot), /stale/);
    complete("old result");
    await assert.rejects(pending, /stale/);
    assert.equal(calls, 1);
    const valid = handler(main.event, input, { principalId: "A", generation });
    complete("current");
    assert.equal(await valid, "current");
  }
});

test("profile has only explicit grants and destroyed windows lose authorization", () => {
  const { ipc, handles, listeners, windowFor } = setup();
  const main = windowFor("main");
  const profile = windowFor("profile");
  ipc.handle("profile:theme", () => "light");
  ipc.handle("window:close", () => true);
  ipc.handle("settings:load", () => "secret");
  assert.equal(handles.get("profile:theme")(profile.event), "light");
  assert.equal(handles.get("window:close")(profile.event), true);
  assert.throws(() => handles.get("settings:load")(profile.event));
  assert.throws(() => handles.get("profile:theme")(main.event));
  let updates = 0;
  ipc.on("profile:updated", () => updates++);
  listeners.get("profile:updated")(main.event);
  listeners.get("profile:updated")(profile.event);
  assert.equal(updates, 1);
  profile.contents.emit("destroyed");
  assert.throws(() => handles.get("profile:theme")(profile.event));
});

test("window navigation and redirects cannot grant another local HTML file the preload", () => {
  const { windowFor } = setup();
  const main = windowFor("main");
  for (const type of ["will-navigate", "will-redirect"]) {
    for (const url of ["file:///untrusted.html", "https://example.com", "javascript:alert(1)"]) {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      main.contents.emit(type, event, url);
      assert.equal(event.defaultPrevented, true);
    }
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    main.contents.emit(type, event, `${main.contents.mainFrame.url}#settings`);
    assert.equal(event.defaultPrevented, false);
  }
});
