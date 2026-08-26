const test = require("node:test");
const assert = require("node:assert/strict");
const { createNavTooltipController, normalizeNavTooltipBounds } = require("../navTooltip");

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

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
        this.owner.closeCount += 1;
      },
      isDestroyed: () => destroyed,
      owner: null,
      setZoomLevel() {},
    },
  };
}

function controllerHarness(
  loads = [],
  renderView = async () => {},
  resolveBounds = (bounds) => bounds,
) {
  const views = [];
  const host = {
    added: [],
    removed: [],
    viewportWidth: 0,
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
    createView() {
      const view = fakeView();
      view.webContents.owner = view;
      views.push(view);
      return view;
    },
    getHost: () => host,
    loadView: () => loads.shift()?.promise,
    renderView,
    resolveBounds,
  });
  return { controller, host, views };
}

test("tooltip bounds reject non-finite input and stay inside the renderer viewport", () => {
  assert.equal(
    normalizeNavTooltipBounds(
      { x: Number.NaN, y: 0, width: 120, height: 40 },
      { width: 800, height: 600 },
    ),
    null,
  );
  assert.deepEqual(
    normalizeNavTooltipBounds(
      { x: 790, y: -10, width: 900, height: 200 },
      { width: 800, height: 600 },
    ),
    { x: 480, y: 0, width: 320, height: 96 },
  );
});

test("a failed tooltip load is disposed and the next show creates a fresh view", async () => {
  const first = deferred();
  const second = deferred();
  const { controller, host, views } = controllerHarness([first, second]);

  const failed = controller.show({ bounds: { x: 1, y: 2, width: 80, height: 40 } });
  first.reject(new Error("load failed"));
  await assert.rejects(failed, /load failed/);
  assert.equal(views[0].closeCount, 1);

  const recovered = controller.show({ bounds: { x: 3, y: 4, width: 90, height: 40 } });
  second.resolve();
  assert.equal(await recovered, true);
  assert.equal(views.length, 2);
  assert.equal(host.added.at(-1), views[1]);
  assert.equal(views[1].getVisible(), true);
});

test("hide and close cancel a pending show before it can attach", async () => {
  const hiddenLoad = deferred();
  const hidden = controllerHarness([hiddenLoad]);
  const hiddenShow = hidden.controller.show({
    bounds: { x: 1, y: 2, width: 80, height: 40 },
  });
  assert.equal(hidden.controller.hide(), true);
  hiddenLoad.resolve();
  assert.equal(await hiddenShow, false);
  assert.equal(hidden.host.added.length, 0);
  assert.equal(hidden.views[0].getVisible(), false);

  const closedLoad = deferred();
  const closed = controllerHarness([closedLoad]);
  const closedShow = closed.controller.show({
    bounds: { x: 1, y: 2, width: 80, height: 40 },
  });
  assert.equal(closed.controller.close(), true);
  closedLoad.resolve();
  assert.equal(await closedShow, false);
  assert.equal(closed.host.added.length, 0);
  assert.equal(closed.views[0].closeCount, 1);
});

test("a pending show recalculates bounds against the resized host before attaching", async () => {
  const load = deferred();
  const { controller, host, views } = controllerHarness(
    [load],
    async () => {},
    (bounds, currentHost) => ({ ...bounds, width: currentHost.viewportWidth }),
  );
  host.viewportWidth = 120;
  const shown = controller.show({ bounds: { x: 1, y: 2, width: 80, height: 40 } });
  host.viewportWidth = 240;
  load.resolve();

  assert.equal(await shown, true);
  assert.deepEqual(views[0].bounds, { x: 1, y: 2, width: 240, height: 40 });
});

test("a failed render is disposed and the next show rebuilds the view", async () => {
  let renderAttempts = 0;
  const { controller, views } = controllerHarness([], async () => {
    renderAttempts += 1;
    if (renderAttempts === 1) throw new Error("render failed");
  });

  await assert.rejects(
    controller.show({ bounds: { x: 1, y: 2, width: 80, height: 40 } }),
    /render failed/,
  );
  assert.equal(views[0].closeCount, 1);
  assert.equal(await controller.show({ bounds: { x: 3, y: 4, width: 90, height: 40 } }), true);
  assert.equal(views.length, 2);
  assert.equal(views[1].getVisible(), true);
});

test("close is idempotent and destroys the owned WebContentsView", async () => {
  const load = deferred();
  const { controller, host, views } = controllerHarness([load]);
  const shown = controller.show({ bounds: { x: 1, y: 2, width: 80, height: 40 } });
  load.resolve();
  assert.equal(await shown, true);

  assert.equal(controller.close(), true);
  assert.equal(controller.close(), false);
  assert.equal(views[0].closeCount, 1);
  assert.equal(host.removed.at(-1), views[0]);
});
