const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");
const { normalizeBrowserPrivacySettings } = require("../browserPrivacy");

function fixture(t, auto = false) {
  const pending = deferred(),
    writes = [],
    busy = [];
  let owner = "A",
    applies = 0,
    requests = 0,
    cleanup = () => {},
    deps;
  let ref;
  const state = {
    status: { senderRunning: true },
    settings: {
      sender: { proxy_mode: "personal", personal_proxy_host: "node-a" },
      browserPrivacy: normalizeBrowserPrivacySettings({
        environment: { mode: auto ? "proxy" : "system", locale: "zh-CN", autoSyncFromProxy: auto },
        lastClearedAt: { claude: "kept" },
      }),
    },
  };
  const store = Object.assign((select) => select(state), {
    getState: () => ({
      ...state,
      patchSection: async (section, value, snapshot) => {
        assert.equal(snapshot.principalId, owner);
        writes.push({
          section,
          value: structuredClone(value),
          snapshot: structuredClone(snapshot),
        });
        state.settings.browserPrivacy = normalizeBrowserPrivacySettings(value);
      },
    }),
  });
  const app = rendererStoreHarness({
    modules: {
      "@/store/useAppStore": { useAppStore: store },
      react: {
        useRef: (initial) => (ref ??= { current: initial }),
        useState: () => [false, (value) => busy.push(value)],
        useEffect: (fn, next) => {
          if (deps && next.every((value, i) => Object.is(value, deps[i]))) return;
          cleanup();
          cleanup = fn() || (() => {});
          deps = next;
        },
      },
    },
    api: {
      detectProxyEnvironment: () => {
        requests++;
        return pending.promise;
      },
      applyBrowserPrivacy: async () => {
        applies++;
        return { ok: true };
      },
    },
  });
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  const scopes = app.load("lib/accountSync.ts");
  const service = app.load("lib/browserPrivacyRuntime.ts");
  const scope = scopes.createAccountScope();
  t.after(() => {
    cleanup();
    scope.close();
  });
  const detected = {
    ip: "1.1.1.1",
    timezone: "America/New_York",
    latitude: 40.7,
    longitude: -74,
    accuracy: 20,
    countryCode: "US",
    country: "United States",
    region: "NY",
    city: "New York",
    checkedAt: "2026-11-22T00:00:00Z",
  };
  return {
    app,
    state,
    writes,
    busy,
    scope,
    service,
    resolve: () => pending.resolve(detected),
    switchAccount: () => {
      owner = "B";
      runtime.activate("B", 2);
    },
    requests: () => requests,
    applies: () => applies,
    settle: async () => {
      for (let i = 0; i < 10; i++) await app.settle();
    },
  };
}

test("manual exit detection retains its starting account and preserves local-only data", async (t) => {
  const f = fixture(t);
  const pending = f.service.synchronizeProxyEnvironment(f.scope, true);
  f.resolve();
  await pending;
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].snapshot.principalId, "A");
  assert.equal(f.state.settings.browserPrivacy.environment.mode, "proxy");
  assert.equal(f.state.settings.browserPrivacy.environment.locale, "en-US");
  assert.equal(f.state.settings.browserPrivacy.lastClearedAt.claude, "kept");
  assert.equal(f.applies(), 1);
});

test("manual exit detection cannot save after switching accounts without a React cleanup", async (t) => {
  const f = fixture(t);
  const pending = f.service.synchronizeProxyEnvironment(f.scope, true);
  f.switchAccount();
  f.resolve();
  await assert.rejects(pending, /旧操作已取消/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.applies(), 0);
});

test("exit detection rejects results from a route that changed while awaiting the response", async (t) => {
  const f = fixture(t);
  const pending = f.service.synchronizeProxyEnvironment(f.scope, true);
  f.state.settings.sender.personal_proxy_host = "node-b";
  f.resolve();
  await assert.rejects(pending, /代理线路已变化/);
  assert.equal(f.writes.length, 0);
});

test("automatic detection survives unrelated status updates without cancelling or duplicating work", async (t) => {
  const f = fixture(t, true);
  const hook = f.app.load("hooks/useBrowserPrivacyAutoSync.ts");
  hook.useBrowserPrivacyAutoSync();
  await f.settle();
  f.state.status = Object.assign({}, f.state.status, { unrelated: "changed" });
  hook.useBrowserPrivacyAutoSync();
  f.resolve();
  await f.settle();
  assert.equal(f.requests(), 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.settings.browserPrivacy.environment.locale, "zh-CN");
});

test("manual UI operation quietly cancels old-account completion", async (t) => {
  const f = fixture(t);
  const action = f.app.load("hooks/useProxyEnvironmentSync.ts").useProxyEnvironmentSync();
  const pending = action.synchronize();
  f.switchAccount();
  f.resolve();
  assert.equal(await pending, null);
  assert.equal(f.writes.length, 0);
  assert.equal(f.applies(), 0);
});
