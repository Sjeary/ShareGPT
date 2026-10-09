const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createTerminalManager, shellLaunch } = require("../terminalManager");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-terminal-unit-"));
  let principal = {
    principalId: "A",
    generation: 1,
    username: "Alice",
    serverUrl: "https://team.invalid",
  };
  let profile = { username: "Alice", advancedAiAllowed: true };
  let clock = 0;
  let responder = async () => profile;
  const events = [],
    children = [];
  const manager = createTerminalManager({
    context: () => principal,
    directory: (id) => path.join(root, id),
    fetchProfile: () => responder(),
    emit: (e) => events.push(e),
    now: () => clock,
    launch: () => ({ shell: "/bin/zsh", args: ["-il"], env: {} }),
    spawn: () => {
      const child = {
        killed: false,
        input: [],
        paused: false,
        size: [],
        onData(fn) {
          this.data = fn;
          return { dispose() {} };
        },
        onExit(fn) {
          this.exit = fn;
          return { dispose() {} };
        },
        write(data) {
          this.input.push(data);
        },
        resize(...size) {
          this.size = size;
        },
        pause() {
          this.paused = true;
        },
        resume() {
          this.paused = false;
        },
        kill() {
          this.killed = true;
        },
      };
      children.push(child);
      return child;
    },
  });
  t.after(() => {
    manager.reset();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const call = (action, payload = {}, snapshot = { ...principal }) =>
    manager.handle(action, payload, snapshot);
  return {
    manager,
    call,
    events,
    children,
    root,
    principal: () => principal,
    switch() {
      principal = { ...principal, principalId: "B", generation: 2, username: "Bob" };
      manager.reset();
    },
    profile(value) {
      profile = value;
    },
    responder(fn) {
      responder = fn;
    },
    expire() {
      clock += 31000;
    },
  };
}

test("terminal requires server-confirmed advanced approval; local and forged profiles cannot grant access", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.call("create"), /登录/);
  f.profile({ username: "Alice", advancedAiAllowed: false });
  await assert.rejects(f.call("authorize", { token: "token", isAdmin: true }), /管理员批准/);
  f.profile({ username: "Other", isAdmin: true });
  await assert.rejects(f.call("authorize", { token: "token" }), /管理员批准/);
  await assert.rejects(
    f.call(
      "authorize",
      { token: "token" },
      { ...f.principal(), principalId: "local-device", generation: 1 },
    ),
    /账号/,
  );
  assert.equal(f.children.length, 0);
});
test("approved sessions stream, resize, apply backpressure and stop on revocation", async (t) => {
  const f = fixture(t);
  await f.call("authorize", { token: "token" });
  const session = await f.call("create");
  await f.call("attach", { id: session.id });
  f.children[0].data("x".repeat(70000));
  assert.equal(f.children[0].paused, true);
  await f.call("ack", { id: session.id, count: 70000 });
  assert.equal(f.children[0].paused, false);
  await f.call("write", { id: session.id, data: "ssh my-host\r" });
  await f.call("resize", { id: session.id, cols: 100, rows: 30 });
  assert.deepEqual(f.children[0].input, ["ssh my-host\r"]);
  assert.deepEqual(f.children[0].size, [100, 30]);
  f.profile({ username: "Alice", advancedAiAllowed: false });
  await assert.rejects(f.call("authorize", { token: "token" }), /批准/);
  assert.equal(f.children[0].killed, true);
  await assert.rejects(f.call("write", { id: session.id, data: "secret" }), /权限/);
});
test("late authorization cannot start a shell after switching accounts; settings remain isolated", async (t) => {
  const f = fixture(t);
  await f.call("authorize", { token: "token" });
  await f.call("settings", { startupCommand: "export WORK=one" });
  /** @type {(value: unknown) => void} */
  let release = () => {};
  f.responder(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const creating = f.call("create");
  f.switch();
  release({ username: "Alice", advancedAiAllowed: true });
  await assert.rejects(creating, /账号/);
  assert.equal(f.children.length, 0);
  f.responder(async () => ({ username: "Bob", advancedAiAllowed: true }));
  const result = await f.call("authorize", { token: "B-token" });
  assert.equal(result.settings.startupCommand, "");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, "A/terminal.json"), "utf8")).startupCommand,
    "export WORK=one",
  );
});
test("expired or failed authorization blocks input and does not delete saved configuration", async (t) => {
  const f = fixture(t);
  await f.call("authorize", { token: "token" });
  await f.call("settings", { startupCommand: "pwd" });
  const session = await f.call("create");
  f.expire();
  await assert.rejects(f.call("write", { id: session.id, data: "ls\r" }), /过期/);
  f.responder(async () => {
    throw new Error("fixture HTTP 503");
  });
  await assert.rejects(f.call("authorize", { token: "token" }), /503/);
  assert.equal(f.children[0].killed, true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, "A/terminal.json"), "utf8")).startupCommand,
    "pwd",
  );
});
test("shell inherits local environment without injecting proxy or startup commands", () => {
  const config = shellLaunch("", "darwin", {
    SHELL: process.execPath,
    PATH: "/fixture/bin",
    SSH_AUTH_SOCK: "/fixture/agent",
    HTTPS_PROXY: "http://existing",
    ELECTRON_RUN_AS_NODE: "1",
    SHAREGPT_USER_DATA: "/private",
  });
  assert.equal(config.shell, process.execPath);
  assert.deepEqual(config.args, ["-il"]);
  assert.equal(config.env.PATH, "/fixture/bin");
  assert.equal(config.env.SSH_AUTH_SOCK, "/fixture/agent");
  assert.equal(config.env.HTTPS_PROXY, "http://existing");
  assert.equal(config.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(config.env.SHAREGPT_USER_DATA, undefined);
  assert.deepEqual(shellLaunch("", "win32", {}).args, ["-NoLogo"]);
});

test("session quota and input bounds are enforced in main; closing permits a new session", async (t) => {
  const f = fixture(t);
  await f.call("authorize", { token: "token" });
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push(await f.call("create"));
  await assert.rejects(f.call("create"), /最多/);
  const id = sessions[0].id;
  await assert.rejects(f.call("write", { id, data: "x".repeat(65537) }), /64 KB/);
  await assert.rejects(f.call("resize", { id, cols: -1, rows: 40 }), /尺寸/);
  await assert.rejects(f.call("settings", { startupCommand: "bad\0command" }), /指令/);
  await f.call("close", { id });
  assert.equal(f.children[0].killed, true);
  await f.call("create");
  assert.equal(f.children.length, 9);
});

test("an older denial cannot revoke a newer successful authorization", async (t) => {
  const f = fixture(t);
  /** @type {(value: unknown) => void} */
  let release = () => {};
  f.responder(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const old = f.call("authorize", { token: "old" });
  f.responder(async () => ({ username: "Alice", advancedAiAllowed: true }));
  await f.call("authorize", { token: "new" });
  release({ username: "Alice", advancedAiAllowed: false });
  await assert.rejects(old, /过期/);
  await f.call("create");
  assert.equal(f.children.length, 1);
});

test("Windows terminal exit releases worker and input handles without killing an exited PID", () => {
  const { trackTerminalExit } = require("../terminalManager");
  const calls = [];
  let exited = () => {
    throw new Error("exit listener was not registered");
  };
  const pty = {
    onExit(callback) {
      exited = callback;
      return {
        dispose() {
          calls.push("unsubscribe");
        },
      };
    },
    kill() {
      throw new Error("must not kill an exited PID");
    },
    _agent: {
      inSocket: {
        destroy() {
          calls.push("input");
        },
      },
      _conoutSocketWorker: {
        dispose() {
          calls.push("worker");
        },
      },
    },
  };
  assert.equal(trackTerminalExit(pty, "win32"), pty);
  exited();
  assert.deepEqual(calls, ["unsubscribe", "input", "worker"]);
  calls.length = 0;
  trackTerminalExit(pty, "darwin");
  assert.deepEqual(calls, []);
});
