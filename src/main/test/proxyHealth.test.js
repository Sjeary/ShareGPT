const test = require("node:test");
const assert = require("node:assert/strict");
const { rendererStoreHarness, deferred } = require("./helpers/rendererStoreHarness.cjs");

function fixture(t) {
  const states = [],
    refs = [],
    memos = [],
    effects = [],
    requests = [],
    writes = [],
    timers = new Map();
  let stateIndex = 0,
    refIndex = 0,
    memoIndex = 0,
    effectIndex = 0,
    nextEffects = [],
    timerId = 0;
  let active = "tab-a";
  const same = (a, b) =>
    Boolean(a && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const memo = (get, deps) => {
    const index = memoIndex++;
    if (!memos[index] || !same(memos[index].deps, deps)) memos[index] = { deps, value: get() };
    return memos[index].value;
  };
  const app = rendererStoreHarness({
    modules: {
      react: {
        useRef: (initial) => {
          const index = refIndex++;
          return (refs[index] ??= { current: initial });
        },
        useState: (initial) => {
          const index = stateIndex++;
          if (!(index in states)) states[index] = initial;
          return [
            states[index],
            (value) => {
              states[index] = typeof value === "function" ? value(states[index]) : value;
            },
          ];
        },
        useCallback: (fn, deps) => memo(() => fn, deps),
        useMemo: memo,
        useEffect: (fn, deps) => nextEffects.push({ index: effectIndex++, fn, deps }),
      },
      sonner: { toast: { success() {} } },
      "./reportGptUsage": { reportMissingDomains: async () => {} },
      "@/store/useAiStore": {
        useAiStore: { getState: () => ({ activeTabIdByKind: { gpt: active } }) },
      },
      "@/store/useAppStore": {
        useAppStore: {
          getState: () => ({
            settings: { sender: { auto_domains: [] } },
            patchSection: async (...args) => writes.push(args),
          }),
        },
      },
    },
    api: {
      checkAiProxy: () => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      },
      startSender: async () => ({}),
    },
    window: {
      setTimeout: (fn) => {
        timers.set(++timerId, fn);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  const runtime = app.load("lib/settingsPrincipalRuntime.ts").settingsPrincipalRuntime;
  runtime.activate("A", 1);
  const hook = app.load("components/panels/ai/useProxyHealth.ts");
  const render = (tabId = active) => {
    active = tabId;
    stateIndex = refIndex = memoIndex = effectIndex = 0;
    nextEffects = [];
    const result = hook.useProxyHealth({
      kind: "gpt",
      tabId,
      environmentId: "",
      networkReady: true,
      initialized: true,
      advancedMode: false,
    });
    for (const effect of nextEffects)
      if (!effects[effect.index] || !same(effects[effect.index].deps, effect.deps)) {
        effects[effect.index]?.cleanup?.();
        effects[effect.index] = { deps: effect.deps, cleanup: effect.fn() };
      }
    return result;
  };
  t.after(() => effects.forEach((effect) => effect?.cleanup?.()));
  return {
    render,
    requests,
    writes,
    timers,
    runtime,
    settle: async () => {
      for (let i = 0; i < 8; i++) await app.settle();
    },
  };
}

test("proxy health coalesces a poll/manual check and keeps presentation state after completion", async (t) => {
  const f = fixture(t);
  const view = f.render();
  const first = view.runProxyCheck(),
    second = view.runProxyCheck();
  await f.settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.render().proxyChecking, true);
  f.requests[0].resolve({ ok: true, sessionProxied: true, hosts: [] });
  await Promise.all([first, second]);
  assert.equal(f.render().proxyReport.ok, true);
  assert.equal(f.render().proxyChecking, false);
});

test("late proxy diagnostics never change the next account's report or domains", async (t) => {
  const f = fixture(t);
  const pending = f.render().runProxyCheck();
  await f.settle();
  f.runtime.activate("B", 2);
  f.requests[0].resolve({ ok: false, hosts: [{ host: "old.example", via: "fallback" }] });
  await pending;
  assert.equal(f.render().proxyReport, null);
  assert.equal(f.render().proxyChecking, false);
  assert.equal(f.writes.length, 0);
});

test("A/B/A tab switches cancel old diagnostics and permit a fresh request without stale busy state", async (t) => {
  const f = fixture(t);
  const old = f.render().runProxyCheck();
  await f.settle();
  f.render("tab-b");
  const fresh = f.render("tab-a").runProxyCheck();
  await f.settle();
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve({ ok: false, reason: "old" });
  await old;
  assert.equal(f.render().proxyChecking, true);
  f.requests[1].resolve({ ok: true, reason: "fresh" });
  await fresh;
  assert.equal(f.render().proxyReport.reason, "fresh");
  assert.equal(f.render().proxyChecking, false);
});

test("missing-domain persistence carries the checked account rather than claiming a new owner", async (t) => {
  const f = fixture(t);
  const pending = f.render().runProxyCheck();
  await f.settle();
  f.requests[0].resolve({ ok: true, hosts: [{ host: "needed.example", via: "fallback" }] });
  await pending;
  f.render();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], "sender");
  assert.deepEqual([...f.writes[0][1].auto_domains], ["needed.example"]);
  assert.equal(f.writes[0][2].principalId, "A");
});

test("leaving the diagnostic target cancels its delayed post-restart check", async (t) => {
  const f = fixture(t);
  await f.render().applyMissingDomains();
  assert.equal(f.timers.size, 1);
  f.render("tab-b");
  assert.equal(f.timers.size, 0);
});
