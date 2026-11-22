const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

function fixture(t, overrides = {}) {
  const requests = [],
    states = [],
    revisions = [],
    timers = new Map(),
    polls = new Map();
  let nextTimer = 0,
    notify = () => {},
    receive = (message) => void message,
    transition = 0;
  let remote = { rev: 1, data: { items: ["remote"] } };
  let local = { items: ["local"] };
  let getStatus = 200,
    putStatus = 200,
    ready = true;
  const app = rendererStoreHarness({
    modules: {
      "@/lib/userDataTransitionState": {
        userDataTransitionState: { isSuspended: () => false, revision: () => transition },
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
    window: {
      setTimeout: (fn) => {
        timers.set(++nextTimer, fn);
        return nextTimer;
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn) => {
        polls.set(++nextTimer, fn);
        return nextTimer;
      },
      clearInterval: (id) => polls.delete(id),
    },
    fetch: async (_url, options) => {
      requests.push({
        method: options.method,
        payload: options.body && JSON.parse(options.body),
        signal: options.signal,
      });
      if (overrides.fetch) return overrides.fetch(options, remote);
      if (options.method === "GET") {
        if (!getStatus) throw new Error("offline");
        return {
          ok: getStatus === 200,
          status: getStatus,
          json: async () => structuredClone(remote),
        };
      }
      if (putStatus !== 200)
        return { ok: false, status: putStatus, json: async () => structuredClone(remote) };
      const payload = JSON.parse(options.body);
      assert.equal(payload.baseRev, remote.rev);
      remote = { rev: remote.rev + 1, data: payload.data };
      return { ok: true, status: 200, json: async () => ({ rev: remote.rev }) };
    },
  });
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  const sync = app.load("lib/accountSync.ts").createAccountSync({
    kind: "fixture",
    serverUrl: "https://fixture.invalid",
    token: "synthetic-A",
    pollMs: 20000,
    debounceMs: 800,
    isReady: () => ready,
    getLocal: () => local,
    getRevision: () => 0,
    setRevision: (rev) => revisions.push(rev),
    mergeRemote: (record, { scope }) => {
      scope.assertCurrent();
      local = { items: [...new Set([...local.items, ...(record.data?.items || [])])] };
      notify();
    },
    subscribeLocal: (fn) => {
      notify = fn;
      return () => {};
    },
    setState: (state) => states.push(state),
  });
  t.after(() => sync.stop());
  const settle = async () => {
    for (let i = 0; i < 12; i++) await app.settle();
  };
  return {
    sync,
    requests,
    states,
    revisions,
    polls,
    timers,
    runtime,
    local: () => local,
    remote: () => remote,
    getStatus: (value) => {
      getStatus = value;
    },
    putStatus: (value) => {
      putStatus = value;
    },
    setReady: (value) => {
      ready = value;
    },
    transition: () => {
      transition++;
    },
    change: (item) => {
      local = { items: [...local.items, item] };
      notify();
    },
    pushTimers: async () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
      await settle();
    },
    poll: async () => {
      for (const fn of polls.values()) fn();
      await settle();
    },
    receive: (rev) => receive({ type: "user_store_updated", kind: "fixture", rev }),
    settle,
  };
}

test("shared sync acknowledges server state and retains the local/remote union", async (t) => {
  const f = fixture(t);
  await f.sync.start();
  assert.deepEqual(f.remote().data.items, ["local", "remote"]);
  assert.deepEqual(f.revisions, [1, 2]);
  assert.equal(f.states.at(-1), "synced");
});

for (const status of [503, 0])
  test(`shared sync retries initial ${status || "network"} failure without remounting`, async (t) => {
    const f = fixture(t);
    f.getStatus(status);
    await f.sync.start();
    assert.equal(f.states.at(-1), "error");
    assert.equal(f.polls.size, 1);
    f.getStatus(200);
    await f.poll();
    assert.equal(f.states.at(-1), "synced");
    assert.deepEqual(f.remote().data.items, ["local", "remote"]);
  });

for (const status of [404, 405, 501])
  test(`shared sync preserves unsupported endpoint ${status} as local`, async (t) => {
    const f = fixture(t);
    f.getStatus(status);
    await f.sync.start();
    await f.poll();
    assert.equal(f.states.at(-1), "local");
    assert.equal(f.requests.length, 1);
    assert.equal(f.polls.size, 0);
    assert.deepEqual(f.local().items, ["local"]);
  });

test("failed uploads keep a confirmed remote baseline and retry on the next poll", async (t) => {
  const f = fixture(t);
  f.putStatus(503);
  await f.sync.start();
  assert.equal(f.states.at(-1), "error");
  assert.deepEqual(f.revisions, [1]);
  f.putStatus(200);
  await f.poll();
  assert.equal(f.states.at(-1), "synced");
  assert.deepEqual(f.remote().data.items, ["local", "remote"]);
});

test("revision conflicts have a bounded retry count and retain local changes", async (t) => {
  const f = fixture(t);
  f.putStatus(409);
  await f.sync.start();
  assert.equal(f.requests.filter((r) => r.method === "PUT").length, 3);
  assert.equal(f.states.at(-1), "error");
  assert.ok(f.local().items.includes("local"));
});

for (const boundary of ["account", "same-account transition", "stop"])
  test(`late responses stop before applying across ${boundary}`, async (t) => {
    const response = deferred();
    const f = fixture(t, { fetch: () => response.promise });
    const start = f.sync.start();
    await f.settle();
    if (boundary === "account") f.runtime.activate("B", 2);
    else if (boundary === "same-account transition") f.transition();
    else f.sync.stop();
    if (boundary === "stop") assert.equal(f.requests[0].signal.aborted, true);
    response.resolve({
      ok: true,
      status: 200,
      json: async () => ({ rev: 8, data: { items: ["old-account"] } }),
    });
    await start;
    assert.deepEqual(f.local().items, ["local"]);
    assert.deepEqual(f.revisions, []);
    assert.equal(f.requests.length, 1);
    assert.equal(f.polls.size, 0);
  });

test("unreadable local stores are not uploaded as empty and can become ready later", async (t) => {
  const f = fixture(t);
  f.setReady(false);
  await f.sync.start();
  assert.equal(f.requests.length, 0);
  assert.equal(f.states.at(-1), "error");
  f.setReady(true);
  await f.poll();
  assert.equal(f.states.at(-1), "synced");
});

test("concurrent refresh triggers serialize requests rather than racing versions", async (t) => {
  const first = deferred();
  let gets = 0;
  const f = fixture(t, {
    fetch: async () => {
      gets++;
      if (gets === 1) return first.promise;
      return {
        ok: true,
        status: 200,
        json: async () => ({ rev: 2, data: { items: ["local", "remote"] } }),
      };
    },
  });
  const start = f.sync.start();
  await f.settle();
  const refresh = f.sync.refresh();
  await f.settle();
  assert.equal(gets, 1);
  first.resolve({
    ok: true,
    status: 200,
    json: async () => ({ rev: 1, data: { items: ["local"] } }),
  });
  await Promise.all([start, refresh]);
  assert.equal(f.states.at(-1), "synced");
  assert.deepEqual(f.local().items, ["local", "remote"]);
});

test("ownership is checked again after a delayed response body finishes parsing", async (t) => {
  const body = deferred();
  let parsing = false;
  const f = fixture(t, {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: () => {
        parsing = true;
        return body.promise;
      },
    }),
  });
  const start = f.sync.start();
  await f.settle();
  assert.equal(parsing, true);
  f.runtime.activate("B", 2);
  body.resolve({ rev: 8, data: { items: ["old account"] } });
  await start;
  assert.deepEqual(f.local().items, ["local"]);
  assert.deepEqual(f.revisions, []);
  assert.equal(f.requests.length, 1);
});

test("edits made while an upload is awaiting confirmation are uploaded with the next revision", async (t) => {
  const first = deferred();
  let puts = 0;
  const f = fixture(t, {
    fetch: async (options) => {
      if (options.method === "GET")
        return {
          ok: true,
          status: 200,
          json: async () => ({ rev: 1, data: { items: ["remote"] } }),
        };
      puts++;
      return puts === 1 ? first.promise : { ok: true, status: 200, json: async () => ({ rev: 3 }) };
    },
  });
  const start = f.sync.start();
  await f.settle();
  assert.equal(puts, 1);
  f.change("latest edit");
  first.resolve({ ok: true, status: 200, json: async () => ({ rev: 2 }) });
  await start;
  assert.equal(f.states.at(-1), "syncing");
  await f.pushTimers();
  const uploads = f.requests.filter((request) => request.method === "PUT");
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].payload.baseRev, 2);
  assert.deepEqual(uploads[1].payload.data.items, ["local", "remote", "latest edit"]);
  assert.equal(f.states.at(-1), "synced");
});
