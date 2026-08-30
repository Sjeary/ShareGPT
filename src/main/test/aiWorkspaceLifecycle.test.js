const test = require("node:test");
const assert = require("node:assert/strict");
const {
  advanceWorkspaceDocument,
  createDurableWorkspaceRegistry,
  createLastIntentReconciler,
  invalidateWorkspaceDocumentState,
  isWorkspaceViewUsable,
  markWorkspaceDocumentReady,
  resetWorkspaceDocumentState,
  retireWorkspaceView,
  routeBindingFingerprint,
  shouldValidateRouteBinding,
  workspaceHostIsReady,
  workspaceEnsureIsCurrent,
  workspaceOwnerIsCurrent,
} = require("../aiWorkspaceLifecycle");

test("workspace document epochs invalidate full and same-document navigation targets", () => {
  const target = {};
  assert.equal(resetWorkspaceDocumentState(target), true);
  assert.deepEqual(target, { documentEpoch: 0, documentUrl: "", documentReady: false });

  assert.equal(advanceWorkspaceDocument(target, "https://chatgpt.com/c/a"), 1);
  assert.equal(target.documentReady, false);
  assert.equal(markWorkspaceDocumentReady(target, "https://chatgpt.com/c/a"), true);
  assert.equal(target.documentReady, true);

  assert.equal(advanceWorkspaceDocument(target, "https://chatgpt.com/c/b", { ready: true }), 2);
  assert.equal(target.documentReady, true);
  assert.equal(markWorkspaceDocumentReady(target, "https://chatgpt.com/c/a"), false);
});

test("renderer loss invalidates readiness and recreation resets the document identity", () => {
  const target = {
    documentEpoch: 4,
    documentUrl: "https://claude.ai/chat/a",
    documentReady: true,
  };
  assert.equal(invalidateWorkspaceDocumentState(target, { clearUrl: true }), true);
  assert.deepEqual(target, { documentEpoch: 4, documentUrl: "", documentReady: false });
  resetWorkspaceDocumentState(target);
  assert.deepEqual(target, { documentEpoch: 0, documentUrl: "", documentReady: false });
});

function fakeView(id) {
  let destroyed = false;
  return {
    id,
    webContents: {
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
      },
      close: () => {
        destroyed = true;
      },
    },
  };
}

test("a superseded ensure cannot become current after a target or generation change", () => {
  const target = workspace("a", "team-a", "persist:gpt-a");
  target.viewGeneration = 3;
  target.ensureGeneration = 7;
  const expected = {
    runtimeEpoch: 4,
    viewGeneration: 3,
    ensureGeneration: 7,
    target: { kind: "gpt", environmentId: "team-a", tabId: "a" },
  };
  const current = {
    runtimeEpoch: 4,
    logicalWorkspace: target,
    target: { kind: "gpt", environmentId: "team-a", tabId: "a" },
  };

  assert.equal(workspaceEnsureIsCurrent(target, expected, current), true);
  target.ensureGeneration = 8;
  assert.equal(workspaceEnsureIsCurrent(target, expected, current), false);
  target.ensureGeneration = 7;
  assert.equal(
    workspaceEnsureIsCurrent(target, expected, {
      ...current,
      target: { kind: "gpt", environmentId: "team-a", tabId: "b" },
    }),
    false,
  );
});

test("a workspace stays bound to its creation Principal and runtime epoch", () => {
  const target = {
    ownerPrincipalId: "principal-a",
    ownerPrincipalGeneration: 7,
    runtimeEpoch: 3,
    closing: false,
  };
  assert.equal(
    workspaceOwnerIsCurrent(target, { principalId: "principal-a", generation: 7 }, 3),
    true,
  );
  assert.equal(
    workspaceOwnerIsCurrent(target, { principalId: "principal-b", generation: 8 }, 3),
    false,
    "an event from A must not be relabeled for B",
  );
  assert.equal(
    workspaceOwnerIsCurrent(target, { principalId: "principal-a", generation: 7 }, 4),
    false,
  );
  target.closing = true;
  assert.equal(
    workspaceOwnerIsCurrent(target, { principalId: "principal-a", generation: 7 }, 3),
    false,
  );
});

test("retiring a replaced view detaches and destroys the old renderer", () => {
  const oldView = fakeView("old");
  const removed = [];
  retireWorkspaceView(oldView, true, {
    removeChildView(view) {
      removed.push(view.id);
    },
  });
  assert.deepEqual(removed, ["old"]);
  assert.equal(oldView.webContents.isDestroyed(), true);
});

function workspace(id, environmentId, partition) {
  return {
    id,
    kind: "gpt",
    environmentId,
    policy: { partition },
    lastUrl: `https://chatgpt.com/c/${id}`,
    view: fakeView(`${id}-view-1`),
    viewDead: false,
  };
}

test("a dead renderer is never returned but its logical tab survives for reconstruction", () => {
  const registry = createDurableWorkspaceRegistry();
  registry.activateEnvironment("gpt", "team-a");
  const original = registry.add(workspace("tab-a", "team-a", "persist:gpt-team-a"));

  original.view.webContents.destroy();
  original.viewDead = true;
  assert.equal(registry.getUsable("gpt", "tab-a"), null);
  assert.equal(registry.getLogical("gpt", "tab-a"), original);

  const previousPartition = original.policy.partition;
  const previousUrl = original.lastUrl;
  original.view = fakeView("tab-a-view-2");
  original.viewDead = false;

  assert.equal(registry.getUsable("gpt", "tab-a"), original);
  assert.equal(original.policy.partition, previousPartition);
  assert.equal(original.lastUrl, previousUrl);
});

test("A/B/A environment activation preserves tab and partition identity", () => {
  const registry = createDurableWorkspaceRegistry();
  registry.activateEnvironment("gpt", "team-a");
  const a = registry.add(workspace("a", "team-a", "persist:gpt-a"));
  registry.activateEnvironment("gpt", "team-b");
  const b = registry.add(workspace("b", "team-b", "persist:gpt-b"));

  assert.equal(registry.getLogical("gpt", "b"), b);
  registry.activateEnvironment("gpt", "team-a");
  assert.equal(registry.getLogical("gpt", "a"), a);
  assert.equal(registry.activeId("gpt"), "a");
  assert.equal(a.policy.partition, "persist:gpt-a");
  assert.equal(b.policy.partition, "persist:gpt-b");
});

test("route preflight runs only for a first or changed binding", () => {
  const target = { verifiedRouteBinding: "" };
  const first = routeBindingFingerprint({ id: "route-a", host: "127.0.0.1", port: 1080 });
  const changed = routeBindingFingerprint({ id: "route-b", host: "127.0.0.1", port: 1081 });

  assert.equal(shouldValidateRouteBinding(target, first), true);
  target.verifiedRouteBinding = first;
  assert.equal(shouldValidateRouteBinding(target, first), false);
  assert.equal(shouldValidateRouteBinding(target, changed), true);
});

test("resume-style repeated reconcile is idempotent for the same fixed target", async () => {
  let attached = "";
  const reconciler = createLastIntentReconciler(async (intent) => {
    attached = `${intent.environmentId}/${intent.tabId}`;
    return attached;
  });
  const target = { kind: "gpt", environmentId: "team-a", tabId: "a" };

  await reconciler.submit(target, "resume");
  await reconciler.submit(target, "focus");
  await reconciler.submit(target, "relayout");
  assert.equal(attached, "team-a/a");
});

test("100 rapid switches are serialized and last intent wins", async () => {
  let attached = "";
  const applied = [];
  const reconciler = createLastIntentReconciler(async (intent, context) => {
    await Promise.resolve();
    if (context.isCurrent()) attached = intent.tabId;
    applied.push({ tabId: intent.tabId, current: context.isCurrent() });
  });
  const requests = [];
  for (let index = 0; index < 100; index += 1) {
    requests.push(
      reconciler.submit(
        { kind: "gpt", environmentId: "team-a", tabId: index % 2 ? "b" : "a" },
        "rapid-switch",
      ),
    );
  }
  await Promise.all(requests);

  assert.equal(attached, "b");
  assert.deepEqual(
    applied.filter((item) => item.current),
    [{ tabId: "b", current: true }],
  );
});

test("A/B/A intent sequence attaches only the final A target", async () => {
  const attachments = [];
  const reconciler = createLastIntentReconciler(async (intent, context) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (context.isCurrent()) attachments.push(`${intent.environmentId}/${intent.tabId}`);
  });
  const requests = [
    reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "a" }),
    reconciler.submit({ kind: "gpt", environmentId: "team-b", tabId: "b" }),
    reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "a" }),
  ];

  const results = await Promise.all(requests);
  assert.deepEqual(attachments, ["team-a/a"]);
  assert.equal(results[0].stale, true);
  assert.equal(results[1].stale, true);
  assert.equal(results[2].applied, true);
});

test("an in-flight older intent cannot attach after a newer target arrives", async () => {
  let releaseFirst = () => {};
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = () => resolve(undefined);
  });
  const attachments = [];
  const reconciler = createLastIntentReconciler(async (intent, context) => {
    if (intent.tabId === "a") await firstBlocked;
    if (context.isCurrent()) attachments.push(intent.tabId);
  });

  const first = reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "a" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "b" });
  releaseFirst();
  const [oldResult, newResult] = await Promise.all([first, second]);

  assert.equal(oldResult.stale, true);
  assert.equal(newResult.applied, true);
  assert.deepEqual(attachments, ["b"]);
});

test("an error from stale in-flight work resolves quietly as stale", async () => {
  let releaseFirst = () => {};
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = () => resolve(undefined);
  });
  const reconciler = createLastIntentReconciler(async (intent) => {
    if (intent.tabId === "a") {
      await firstBlocked;
      throw new Error("obsolete renderer failed");
    }
  });

  const first = reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "a" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = reconciler.submit({ kind: "gpt", environmentId: "team-a", tabId: "b" });
  releaseFirst();

  const [oldResult, newResult] = await Promise.all([first, second]);
  assert.equal(oldResult.stale, true);
  assert.equal(newResult.applied, true);
});

test("view usability rejects missing, marked-dead, and destroyed views", () => {
  const target = workspace("a", "team-a", "persist:gpt-a");
  assert.equal(isWorkspaceViewUsable(target), true);
  target.viewDead = true;
  assert.equal(isWorkspaceViewUsable(target), false);
  target.viewDead = false;
  target.view.webContents.destroy();
  assert.equal(isWorkspaceViewUsable(target), false);
});

test("a hidden or unmeasured host cannot trigger workspace attachment or rebuild", () => {
  assert.equal(workspaceHostIsReady(null), false);
  assert.equal(
    workspaceHostIsReady({ visible: false, bounds: { width: 800, height: 600 } }),
    false,
  );
  assert.equal(workspaceHostIsReady({ visible: true, bounds: null }), false);
  assert.equal(workspaceHostIsReady({ visible: true, bounds: { width: 0, height: 600 } }), false);
  assert.equal(workspaceHostIsReady({ visible: true, bounds: { width: 800, height: 600 } }), true);
});
