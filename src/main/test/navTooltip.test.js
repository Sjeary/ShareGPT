const test = require("node:test");
const assert = require("node:assert/strict");
const {
  contentRectToScreenDip,
  createNavTooltipController,
  cssRectToContentDip,
  normalizeNavTooltipIntent,
  pointInsideRect,
  resolveTooltipBoundsContentDip,
} = require("../navTooltip");

function fakeView() {
  let visible = false;
  let destroyed = false;
  return {
    bounds: null,
    closeCount: 0,
    getVisible: () => visible,
    setBounds(bounds) {
      this.bounds = bounds;
    },
    setVisible(next) {
      visible = next;
    },
    webContents: {
      close() {
        destroyed = true;
      },
      isDestroyed: () => destroyed,
      setZoomLevel() {},
    },
  };
}

function pointerIntent(id = "gpt:1", triggerId = "gpt") {
  return {
    action: "show",
    source: "pointer",
    interactionId: id,
    triggerId,
    label: "ChatGPT",
    side: "right",
    theme: "dark",
    anchorRectCss: { x: 10, y: 20, width: 48, height: 52 },
  };
}

/** @param {{ bootstrapTimeoutMs?: number, ackTimeoutMs?: number }} [options] */
function controllerHarness({ bootstrapTimeoutMs, ackTimeoutMs } = {}) {
  const views = [];
  const renders = [];
  const commits = [];
  const placed = [];
  /** @type {(payload: unknown) => void} */
  let overlayMessage = () => {};
  let valid = true;
  let pointerExit = () => {};
  let activeWatches = 0;
  const host = {
    added: [],
    removed: [],
    contentView: {
      addChildView(view) {
        host.added.push(view);
      },
      removeChildView(view) {
        host.removed.push(view);
      },
    },
    isDestroyed: () => false,
  };
  const controller = createNavTooltipController({
    createView(onMessage) {
      const view = fakeView();
      views.push(view);
      overlayMessage = onMessage;
      return view;
    },
    getHost: () => host,
    loadView: async () => {},
    prepareView(view) {
      view.setBounds({ x: 0, y: 0, width: 320, height: 96 });
      view.setVisible(false);
      host.contentView.addChildView(view);
    },
    sendRenderModel(_view, payload) {
      renders.push(payload);
    },
    sendCommit(_view, payload) {
      commits.push(payload);
    },
    placeView(_view, intent, sizeCss) {
      placed.push({ intent, sizeCss });
      return { x: 60, y: 20, width: 90, height: 40 };
    },
    reconcileViewOrder(view) {
      host.contentView.addChildView(view);
    },
    validateIntent: () => valid,
    watchPointerExit(_intent, _host, onExit) {
      activeWatches += 1;
      pointerExit = onExit;
      return () => {
        activeWatches -= 1;
      };
    },
    bootstrapTimeoutMs,
    ackTimeoutMs,
  });
  return {
    commits,
    controller,
    emit: (payload) => overlayMessage(payload),
    getActiveWatches: () => activeWatches,
    host,
    placed,
    pointerExit: () => pointerExit(),
    renders,
    setValid: (value) => {
      valid = value;
    },
    views,
  };
}

async function prewarm(harness) {
  const warming = harness.controller.prewarm();
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ type: "bootstrap-ready" });
  assert.equal(await warming, true);
}

async function beginShow(harness, intent = pointerIntent()) {
  await prewarm(harness);
  assert.equal(await harness.controller.show(intent), true);
  const revision = harness.controller.getDebugState().renderRevision;
  assert.equal(harness.renders.at(-1).revision, revision);
  return revision;
}

test("tooltip intent validation uses a discriminated, bounded payload", () => {
  assert.deepEqual(normalizeNavTooltipIntent(pointerIntent()), pointerIntent());
  assert.equal(normalizeNavTooltipIntent({ action: "show", source: "pointer" }), null);
  assert.equal(
    normalizeNavTooltipIntent({
      ...pointerIntent(),
      interactionId: "<script>",
    }),
    null,
  );
  assert.deepEqual(
    normalizeNavTooltipIntent({
      action: "hide",
      scope: "interaction",
      interactionId: "gpt:1",
      triggerId: "gpt",
      reason: "pointer-leave",
    }),
    {
      action: "hide",
      scope: "interaction",
      interactionId: "gpt:1",
      triggerId: "gpt",
      reason: "pointer-leave",
    },
  );
});

test("CSS coordinates convert once to content and screen DIP", () => {
  assert.deepEqual(cssRectToContentDip({ x: 10.2, y: 20.2, width: 30.2, height: 40.2 }, 1.2), {
    x: 12,
    y: 24,
    width: 37,
    height: 49,
  });
  assert.deepEqual(
    contentRectToScreenDip({ x: 12, y: 24, width: 37, height: 49 }, { x: 100, y: 200 }),
    { x: 112, y: 224, width: 37, height: 49 },
  );
  assert.equal(
    pointInsideRect({ x: 111, y: 223 }, { x: 112, y: 224, width: 37, height: 49 }),
    true,
  );
  assert.equal(
    pointInsideRect({ x: 109, y: 223 }, { x: 112, y: 224, width: 37, height: 49 }),
    false,
  );
});

test("tooltip bounds use overlay size, side, zoom and viewport clamping", () => {
  assert.deepEqual(
    resolveTooltipBoundsContentDip({
      anchorRectCss: { x: 60, y: 40, width: 48, height: 52 },
      tooltipSizeCss: { width: 70, height: 28 },
      side: "right",
      zoomFactor: 1,
      viewportDip: { width: 800, height: 600 },
    }),
    { x: 112, y: 46, width: 82, height: 40 },
  );
  assert.deepEqual(
    resolveTooltipBoundsContentDip({
      anchorRectCss: { x: 760, y: 2, width: 48, height: 52 },
      tooltipSizeCss: { width: 70, height: 28 },
      side: "right",
      zoomFactor: 1,
      viewportDip: { width: 800, height: 600 },
    }),
    { x: 718, y: 8, width: 82, height: 40 },
  );
});

test("bootstrap and layout gate presentation while frame acknowledgement finalizes it", async () => {
  const harness = controllerHarness();
  const revision = await beginShow(harness);
  assert.equal(harness.views[0].getVisible(), false);
  assert.equal(harness.controller.getDebugState().phase, "rendering");

  harness.emit({
    type: "layout-ready",
    revision,
    sizeCss: { width: 70, height: 28 },
  });
  assert.deepEqual(harness.views[0].bounds, { x: 60, y: 20, width: 90, height: 40 });
  assert.equal(harness.commits.at(-1).revision, revision);
  assert.equal(harness.views[0].getVisible(), true);
  assert.equal(harness.controller.getDebugState().visible, false);

  harness.emit({ type: "frame-ready", revision });
  assert.deepEqual(harness.views[0].bounds, { x: 60, y: 20, width: 90, height: 40 });
  assert.equal(harness.views[0].getVisible(), true);
  assert.equal(harness.controller.getDebugState().phase, "visible");
  assert.equal(harness.controller.getDebugState().visible, true);
  assert.equal(harness.host.added.at(-1), harness.views[0]);
});

test("a completed frame stays visible after the acknowledgement deadline", async () => {
  const harness = controllerHarness({ ackTimeoutMs: 5 });
  const revision = await beginShow(harness);
  harness.emit({
    type: "layout-ready",
    revision,
    sizeCss: { width: 70, height: 28 },
  });
  harness.emit({ type: "frame-ready", revision });
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(harness.views[0].webContents.isDestroyed(), false);
  assert.equal(harness.views[0].getVisible(), true);
  assert.deepEqual(harness.views[0].bounds, { x: 60, y: 20, width: 90, height: 40 });
  assert.equal(harness.controller.getDebugState().phase, "visible");
});

test("stale layout and frame acknowledgements cannot complete a newer interaction", async () => {
  const harness = controllerHarness();
  const firstRevision = await beginShow(harness, pointerIntent("gpt:1"));
  assert.equal(await harness.controller.show(pointerIntent("claude:2", "claude")), true);
  const secondRevision = harness.controller.getDebugState().renderRevision;
  assert.ok(secondRevision > firstRevision);

  harness.emit({
    type: "layout-ready",
    revision: firstRevision,
    sizeCss: { width: 70, height: 28 },
  });
  harness.emit({ type: "frame-ready", revision: firstRevision });
  assert.equal(harness.views[0].getVisible(), false);
  assert.equal(harness.commits.length, 0);

  harness.emit({
    type: "layout-ready",
    revision: secondRevision,
    sizeCss: { width: 76, height: 28 },
  });
  harness.emit({ type: "frame-ready", revision: secondRevision });
  assert.equal(harness.views[0].getVisible(), true);
});

test("an old trigger hide cannot cancel a newer trigger", async () => {
  const harness = controllerHarness();
  await beginShow(harness, pointerIntent("gpt:1"));
  await harness.controller.show(pointerIntent("claude:2", "claude"));
  assert.equal(
    harness.controller.hide({
      scope: "interaction",
      interactionId: "gpt:1",
      triggerId: "gpt",
      reason: "pointer-leave",
    }),
    false,
  );
  assert.equal(harness.controller.getDebugState().triggerId, "claude");
});

test("host invalidation cancels an in-flight frame and rejects its late ack", async () => {
  const harness = controllerHarness();
  const revision = await beginShow(harness);
  harness.emit({
    type: "layout-ready",
    revision,
    sizeCss: { width: 70, height: 28 },
  });
  harness.controller.invalidate("window-blurred");
  harness.emit({ type: "frame-ready", revision });
  assert.equal(harness.views[0].getVisible(), false);
  assert.equal(harness.controller.getDebugState().phase, "ready-hidden");
  assert.equal(harness.getActiveWatches(), 0);
});

test("pointer watcher belongs to one pointer interaction; focus starts none", async () => {
  const harness = controllerHarness();
  await beginShow(harness);
  assert.equal(harness.getActiveWatches(), 1);
  harness.pointerExit();
  assert.equal(harness.getActiveWatches(), 0);
  assert.equal(harness.controller.getDebugState().phase, "ready-hidden");

  assert.equal(
    await harness.controller.show({ ...pointerIntent("gpt:2"), source: "keyboard-focus" }),
    true,
  );
  assert.equal(harness.getActiveWatches(), 0);
});

test("overlay failure cancels state and the next prewarm creates a fresh view", async () => {
  const harness = controllerHarness();
  await beginShow(harness);
  assert.equal(harness.controller.handleOverlayUnavailable(harness.views[0]), true);
  assert.equal(harness.views[0].webContents.isDestroyed(), true);
  assert.equal(harness.controller.getDebugState().phase, "cold");

  const warming = harness.controller.prewarm();
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ type: "bootstrap-ready" });
  assert.equal(await warming, true);
  assert.equal(harness.views.length, 2);
});

test("overlay bootstrap timeout discards the broken view and allows a retry", async () => {
  const harness = controllerHarness({ bootstrapTimeoutMs: 5 });
  assert.equal(await harness.controller.prewarm(), false);
  assert.equal(harness.views[0].webContents.isDestroyed(), true);
  assert.equal(harness.controller.getDebugState().phase, "cold");

  const retry = harness.controller.prewarm();
  await Promise.resolve();
  await Promise.resolve();
  harness.emit({ type: "bootstrap-ready" });
  assert.equal(await retry, true);
  assert.equal(harness.views.length, 2);
});

test("missing layout or frame acknowledgement discards the stuck overlay", async () => {
  const layoutHarness = controllerHarness({ ackTimeoutMs: 5 });
  await beginShow(layoutHarness);
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(layoutHarness.views[0].webContents.isDestroyed(), true);
  assert.equal(layoutHarness.controller.getDebugState().phase, "cold");

  const frameHarness = controllerHarness({ ackTimeoutMs: 5 });
  const revision = await beginShow(frameHarness);
  frameHarness.emit({
    type: "layout-ready",
    revision,
    sizeCss: { width: 70, height: 28 },
  });
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(frameHarness.views[0].webContents.isDestroyed(), true);
  assert.equal(frameHarness.views[0].getVisible(), false);
  assert.deepEqual(frameHarness.views[0].bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(frameHarness.getActiveWatches(), 0);
  assert.equal(frameHarness.host.removed.at(-1), frameHarness.views[0]);
  assert.equal(frameHarness.controller.getDebugState().phase, "cold");
});

test("final intent validation is repeated after renderer frame preparation", async () => {
  const harness = controllerHarness();
  const revision = await beginShow(harness);
  harness.emit({
    type: "layout-ready",
    revision,
    sizeCss: { width: 70, height: 28 },
  });
  harness.setValid(false);
  harness.emit({ type: "frame-ready", revision });
  assert.equal(harness.views[0].getVisible(), false);
  assert.equal(harness.controller.getDebugState().phase, "ready-hidden");
});
