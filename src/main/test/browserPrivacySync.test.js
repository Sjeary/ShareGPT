const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");
const { normalizeBrowserPrivacySettings } = require("../browserPrivacy");
const requireRenderer = createRequire(path.resolve(__dirname, "../../renderer-next/package.json"));
const { createStore } = requireRenderer("zustand/vanilla");

function fixture(t, pending) {
  let cleanup = () => {},
    current = "A",
    transition = 0,
    appStore;
  let getStatus = 200,
    applies = 0;
  const writes = [],
    requests = [],
    polls = new Map();
  const local = () =>
    normalizeBrowserPrivacySettings({
      updatedAt: "2026-01-01T00:00:00Z",
      environment: { mode: "system", locale: "zh-CN" },
    });
  const app = rendererStoreHarness({
    modules: {
      react: {
        useEffect: (fn) => {
          cleanup = fn();
        },
      },
      zustand: {
        create: (init) => {
          const store = createStore(init);
          return Object.assign((select) => select(store.getState()), store);
        },
      },
      "@/lib/userDataTransitionState": {
        useUserDataTransitionVersion: () => 0,
        userDataTransitionState: { isSuspended: () => false, revision: () => transition },
      },
      "@/store/useChatStore": {
        useChatStore: (select) =>
          select({
            identity: {
              serverUrl: "https://fixture.invalid",
              username: current,
              token: `synthetic-${current}`,
            },
          }),
      },
      "@/lib/wsBus": { wsBus: { subscribe: () => () => {} } },
    },
    api: {
      setThemeSource: async () => {},
      applyBrowserPrivacy: async () => {
        applies++;
      },
      patchSettings: async (request) => {
        assert.equal(request.expectedPrincipalId, current);
        writes.push(structuredClone(request));
        return {
          ...appStore.getState().settings,
          settingsRevision: 1,
          browserPrivacy: normalizeBrowserPrivacySettings(request.patch),
        };
      },
    },
    document: { documentElement: { classList: { toggle() {} } } },
    window: {
      setInterval: (fn) => {
        polls.set(1, fn);
        return 1;
      },
      clearInterval: (id) => polls.delete(id),
    },
    fetch: async (_url, options) => {
      requests.push({
        method: options.method,
        data: options.body && JSON.parse(options.body).data,
      });
      if (options.method === "GET") {
        if (pending) return pending.promise;
        return {
          ok: getStatus === 200,
          status: getStatus,
          json: async () => structuredClone(remote),
        };
      }
      const payload = JSON.parse(options.body);
      remote = { rev: remote.rev + 1, data: payload.data };
      return { ok: true, status: 200, json: async () => ({ rev: remote.rev }) };
    },
  });
  appStore = app.load("store/useAppStore.ts").useAppStore;
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  appStore.setState({ settings: { settingsRevision: 0, ui: {}, browserPrivacy: local() } });
  const policy = app.load("lib/browserPrivacySyncPolicy.ts");
  let remote = {
    rev: 8,
    data: policy.browserPrivacySyncPayload(
      normalizeBrowserPrivacySettings({
        updatedAt: "2026-06-01T00:00:00Z",
        environment: { mode: "system", locale: "en-US" },
      }),
    ),
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) await app.settle();
  };
  t.after(() => cleanup());
  return {
    start: async () => {
      app.load("hooks/useBrowserPrivacySync.ts").useBrowserPrivacySync();
      await settle();
    },
    switchAccount: (next) => {
      cleanup();
      current = next;
      runtime.activate(next, 3);
      appStore.setState({ settings: { settingsRevision: 0, ui: {}, browserPrivacy: local() } });
    },
    transition: () => {
      transition++;
    },
    settle,
    writes,
    requests,
    polls,
    remote: () => remote,
    setGetStatus: (status) => {
      getStatus = status;
    },
    emptyRemote: () => {
      remote = { rev: 0, data: null };
    },
    poll: async () => {
      for (const fn of polls.values()) fn();
      await settle();
    },
    privacy: () => appStore.getState().settings.browserPrivacy,
    applies: () => applies,
  };
}

for (const boundary of ["B", "A", "same-account transition"])
  test(`real privacy hook rejects a late response across ${boundary}`, async (t) => {
    const response = deferred();
    const f = fixture(t, response);
    await f.start();
    if (boundary === "same-account transition") f.transition();
    else f.switchAccount(boundary);
    response.resolve({ ok: true, status: 200, json: async () => f.remote() });
    await f.settle();
    assert.equal(f.writes.length, 0);
    assert.equal(f.privacy().environment.locale, "zh-CN");
    assert.equal(f.applies(), 0);
  });

test("real privacy hook saves and applies a current account response with its original owner", async (t) => {
  const f = fixture(t);
  await f.start();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedPrincipalId, "A");
  assert.equal(f.writes[0].expectedPrincipalGeneration, 1);
  assert.equal(f.privacy().environment.locale, "en-US");
  assert.equal(f.applies(), 1);
});

test("real privacy hook recovers from initial temporary failure without remounting", async (t) => {
  const f = fixture(t);
  f.setGetStatus(503);
  await f.start();
  assert.equal(f.writes.length, 0);
  assert.equal(f.polls.size, 1);
  f.setGetStatus(200);
  await f.poll();
  assert.equal(f.privacy().environment.locale, "en-US");
  assert.equal(f.applies(), 1);
});

test("real privacy hook uploads only public policy when initializing an empty server", async (t) => {
  const f = fixture(t);
  f.emptyRemote();
  await f.start();
  const upload = f.requests.find((r) => r.method === "PUT").data;
  for (const field of ["sourceIp", "latitude", "sourceUpdatedAt"])
    assert.equal(Object.hasOwn(upload.environment, field), false);
  for (const field of ["audit", "lastClearedAt", "localProfiles"])
    assert.equal(Object.hasOwn(upload, field), false);
});
