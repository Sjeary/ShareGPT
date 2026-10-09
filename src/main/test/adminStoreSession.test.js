const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const requireRenderer = createRequire(path.resolve(__dirname, "../../renderer-next/package.json"));
const { create } = requireRenderer("zustand");

class AuthExpiredError extends Error {}
function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  /** @type {(reason?: any) => void} */
  let reject = () => {};
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const requests = [],
    messages = [],
    prefs = [];
  const controls = { request: null, login: null, loadPrefs: null };
  function result(server) {
    return {
      routes: [{ id: server }],
      users: [{ username: server }],
      reports: [{ id: server }],
      feedback: [{ id: server }],
      domains: [{ host: server }],
      release: { version: server },
      marker: server,
    };
  }
  const exports = {};
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../admin_console/ui/src/store/useAdminStore.ts"),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      URLSearchParams,
      require(name) {
        if (name === "zustand") return { create };
        if (name === "sonner")
          return {
            toast: {
              error: (message) => messages.push(message),
              success: (message) => messages.push(message),
            },
          };
        if (name === "@/types/admin") return { AuthExpiredError };
        if (name === "@/lib/api")
          return {
            normalizeServerUrl: (value) => value,
            adminApi: {
              loadPrefs: () => controls.loadPrefs?.promise || Promise.resolve({}),
              savePrefs: async (value) => prefs.push(value),
            },
            serverFetch: async (server, token, endpoint, options) => {
              const request = { server, token, endpoint, options };
              requests.push(request);
              const delay = controls.request?.(request);
              return delay ? delay.promise : result(server);
            },
          };
        throw new Error(`Unexpected import: ${name}`);
      },
      localStorage: { getItem: () => null, setItem() {} },
      document: { documentElement: { classList: { toggle() {} } } },
      fetch: async (url) => {
        if (controls.login) await controls.login(url)?.promise;
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              token: url,
              profile: { username: "admin" },
              release: { version: url },
            }),
        };
      },
    },
  );
  const store = exports.useAdminStore;
  return {
    store,
    controls,
    result,
    requests,
    messages,
    prefs,
    login: (server) => store.getState().login(server, "admin", "fixture"),
  };
}

const loads = [
  ["loadUsers", "/api/admin/users", "users"],
  ["loadBootstrap", "/api/admin/bootstrap", "bootstrap"],
  ["loadFeedback", "/api/admin/feedback", "feedback"],
  ["loadProxyMissing", "/api/admin/proxy-missing", "proxyMissing"],
  ["loadProxyRoutes", "/api/admin/proxy-routes", "proxyRoutes"],
  ["loadProxyRouteHealth", "/api/admin/proxy-route-health", "proxyRouteHealth"],
  ["loadTranslationProfiles", "/api/admin/translation-profiles", "translationCatalog"],
  ["loadTranslationUsage", "/api/admin/translation-usage", "translationUsage"],
  ["loadAiUsage", "/api/admin/ai-usage?service=gpt", "aiUsage"],
];
for (const [action, endpoint, field] of loads) {
  test(`${action}: A results cannot overwrite B, including loading and auth failures`, async () => {
    for (const outcome of ["success", "unauthorized", "failure"]) {
      const f = fixture();
      await f.login("https://a");
      const old = deferred(),
        current = deferred();
      f.controls.request = (r) =>
        r.endpoint === endpoint ? (r.server === "https://a" ? old : current) : null;
      const pending = f.store.getState()[action]();
      const loginB = f.login("https://b");
      // Login only refreshes some resources. An explicit B request also proves A's
      // finally cannot clear the current in-flight loading flag.
      await new Promise((resolve) => setImmediate(resolve));
      const pendingB = f.store.getState()[action]();
      const before = f.store.getState();
      if (outcome === "success") old.resolve(f.result("https://a"));
      else
        old.reject(
          outcome === "unauthorized" ? new AuthExpiredError("old 401") : new Error("old failed"),
        );
      await pending;
      assert.equal(f.store.getState().token, before.token);
      assert.equal(f.store.getState().authed, true);
      assert.equal(f.store.getState()[field], before[field]);
      for (const key of Object.keys(before).filter((key) => key.endsWith("Loading")))
        assert.equal(f.store.getState()[key], before[key]);
      assert.equal(f.messages.length, 0);
      current.resolve(f.result("https://b"));
      await Promise.all([pendingB, loginB]);
      assert.match(JSON.stringify(f.store.getState()[field]), /https:\/\/b/);
    }
  });
}

test("logout immediately clears every session field; delayed logout cannot clear a new login", async () => {
  const f = fixture();
  await f.login("https://a");
  await Promise.all(loads.map(([name]) => f.store.getState()[name]()));
  const wait = deferred();
  f.controls.request = (r) => (r.endpoint.endsWith("logout") ? wait : null);
  const old = f.store.getState().logout();
  const state = f.store.getState();
  assert.equal(state.role, "none");
  assert.equal(state.token, "");
  for (const [, , field] of loads)
    assert.ok(state[field] === null || state[field].length === 0, field);
  assert.equal(state.busy, false);
  await f.login("https://b");
  wait.resolve({});
  await old;
  assert.equal(f.store.getState().authed, true);
  assert.equal(f.store.getState().serverUrl, "https://b");
});

test("late save results and follow-up reads stay with the initiating session", async () => {
  /** @type {Array<[string, any[], string]>} */
  const cases = [
    ["saveProxyRoutes", [[{ id: "a-secret" }]], "/api/admin/proxy-routes"],
    ["saveTranslationProfiles", ["a", []], "/api/admin/translation-profiles"],
    ["saveBootstrap", [{}], "/api/admin/bootstrap"],
    ["createUser", [{}], "/api/admin/users"],
    ["saveUser", ["user", {}], "/api/admin/users/user"],
  ];
  for (const [method, args, endpoint] of cases) {
    const f = fixture();
    await f.login("https://a");
    const wait = deferred();
    f.controls.request = (r) => (r.endpoint === endpoint && r.options?.method ? wait : null);
    const old = f.store.getState()[method](...args);
    await f.login("https://b");
    const count = f.requests.length;
    wait.resolve({ ...f.result("https://a"), user: { username: "a" }, bootstrap: {} });
    const returned = await old;
    assert.equal(f.requests.length, count, method);
    assert.equal(f.messages.length, 0, method);
    assert.equal(f.store.getState().proxyRoutes[0].id, "https://b");
    if (method === "createUser" || method === "saveBootstrap") assert.equal(returned, null);
  }
});

test("overlapping login/setup/dev login and delayed preferences cannot revive a cancelled session", async () => {
  for (const method of ["login", "setupFirstAdmin", "devLogin"]) {
    const f = fixture(),
      wait = deferred();
    f.controls.login = (url) => (url.startsWith("https://a") ? wait : null);
    const pending = f.store.getState()[method]("https://a", "admin", "fixture");
    await f.login("https://b");
    wait.resolve();
    await pending;
    assert.equal(f.store.getState().serverUrl, "https://b");
    assert.equal(f.store.getState().role, "admin");
    assert.equal(f.prefs.length, 1);
  }
  const f = fixture();
  f.controls.loadPrefs = deferred();
  const init = f.store.getState().init();
  await f.login("https://b");
  f.controls.loadPrefs.resolve({ serverUrl: "https://a", username: "old" });
  await init;
  assert.equal(f.store.getState().serverUrl, "https://b");
});

test("current auth expiry clears session while an old developer release response is ignored", async () => {
  const f = fixture();
  await f.store.getState().devLogin("https://a", "fixture");
  const wait = deferred();
  f.controls.request = (r) => (r.server === "https://a" ? wait : null);
  const old = f.store.getState().loadDevRelease();
  await f.login("https://b");
  wait.reject(new AuthExpiredError("old developer"));
  await old;
  assert.equal(f.store.getState().role, "admin");
  assert.equal(f.messages.length, 0);
  const expired = deferred();
  f.controls.request = () => expired;
  const current = f.store.getState().loadProxyRoutes();
  expired.reject(new AuthExpiredError("expired"));
  await current;
  assert.equal(f.store.getState().role, "none");
  assert.equal(f.store.getState().proxyRoutes.length, 0);
  assert.deepEqual(f.messages, ["expired"]);
});
