const EMPTY_BOUNDS = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const MAX_TOOLTIP_WIDTH = 320;
const MAX_TOOLTIP_HEIGHT = 96;
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNavTooltipBounds(rawBounds, rawViewport) {
  if (!rawBounds || typeof rawBounds !== "object") return null;
  const x = finiteNumber(rawBounds.x);
  const y = finiteNumber(rawBounds.y);
  const width = finiteNumber(rawBounds.width);
  const height = finiteNumber(rawBounds.height);
  const viewportWidth = finiteNumber(rawViewport?.width);
  const viewportHeight = finiteNumber(rawViewport?.height);
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    viewportWidth === null ||
    viewportHeight === null ||
    width <= 1 ||
    height <= 1 ||
    viewportWidth <= 1 ||
    viewportHeight <= 1
  ) {
    return null;
  }

  const safeWidth = Math.min(MAX_TOOLTIP_WIDTH, Math.max(2, Math.round(width)));
  const safeHeight = Math.min(MAX_TOOLTIP_HEIGHT, Math.max(2, Math.round(height)));
  return {
    x: Math.round(Math.max(0, Math.min(viewportWidth - safeWidth, x))),
    y: Math.round(Math.max(0, Math.min(viewportHeight - safeHeight, y))),
    width: Math.min(Math.round(viewportWidth), safeWidth),
    height: Math.min(Math.round(viewportHeight), safeHeight),
  };
}

function createNavTooltipController({
  createView,
  getHost,
  loadView,
  renderView,
  resolveBounds,
  watchPointerExit = null,
}) {
  let view = null;
  let ready = null;
  let requestToken = 0;
  let stopPointerExitWatch = null;

  function stopWatchingPointerExit() {
    const stop = stopPointerExitWatch;
    stopPointerExitWatch = null;
    if (typeof stop === "function") stop();
  }

  function isUsable(candidate) {
    return Boolean(candidate && !candidate.webContents?.isDestroyed?.());
  }

  function disposeView(candidate) {
    if (!candidate) return;
    try {
      getHost()?.contentView?.removeChildView(candidate);
    } catch {
      // The host may already be tearing down.
    }
    try {
      candidate.setVisible(false);
      candidate.setBounds(EMPTY_BOUNDS);
    } catch {
      // The native view may already have been detached.
    }
    try {
      if (!candidate.webContents?.isDestroyed?.()) {
        candidate.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {
      // Closing an already-destroying WebContents is harmless here.
    }
  }

  function discard(candidate) {
    if (candidate === view) {
      view = null;
      ready = null;
    }
    disposeView(candidate);
  }

  function ensureView() {
    if (isUsable(view)) return { view, ready };
    if (view) discard(view);

    const candidate = createView();
    view = candidate;
    ready = Promise.resolve()
      .then(() => loadView(candidate))
      .catch((error) => {
        discard(candidate);
        throw error;
      });
    return { view: candidate, ready };
  }

  function hide() {
    requestToken += 1;
    stopWatchingPointerExit();
    if (!isUsable(view)) return false;
    view.setVisible(false);
    view.setBounds(EMPTY_BOUNDS);
    return true;
  }

  function close() {
    requestToken += 1;
    stopWatchingPointerExit();
    const candidate = view;
    view = null;
    ready = null;
    disposeView(candidate);
    return Boolean(candidate);
  }

  function setZoomLevel(level) {
    if (isUsable(view)) view.webContents.setZoomLevel(level);
    hide();
  }

  function bringToFrontIfVisible() {
    const host = getHost();
    if (!isUsable(view) || !view.getVisible?.() || !host || host.isDestroyed?.()) return false;
    host.contentView.addChildView(view);
    return true;
  }

  async function show(payload) {
    const host = getHost();
    if (!host || host.isDestroyed?.()) return false;
    if (!resolveBounds(payload.bounds, host)) return hide();

    const token = ++requestToken;
    stopWatchingPointerExit();
    const current = ensureView();
    await current.ready;
    if (token !== requestToken || !isUsable(current.view)) return false;

    try {
      await renderView(current.view, payload);
    } catch (error) {
      discard(current.view);
      throw error;
    }
    if (token !== requestToken || !isUsable(current.view)) return false;

    const currentHost = getHost();
    if (!currentHost || currentHost.isDestroyed?.()) return false;
    const currentBounds = resolveBounds(payload.bounds, currentHost);
    if (!currentBounds) return hide();
    current.view.setBounds(currentBounds);
    currentHost.contentView.addChildView(current.view);
    current.view.setVisible(true);
    if (payload.dismissOnPointerExit && typeof watchPointerExit === "function") {
      stopPointerExitWatch = watchPointerExit(payload.anchorBounds, currentHost, () => {
        if (token === requestToken) hide();
      });
    }
    return true;
  }

  return { bringToFrontIfVisible, close, hide, setZoomLevel, show };
}

module.exports = {
  createNavTooltipController,
  normalizeNavTooltipBounds,
};
