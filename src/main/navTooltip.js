const EMPTY_BOUNDS = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const MAX_TOOLTIP_WIDTH_CSS = 320;
const MAX_TOOLTIP_HEIGHT_CSS = 96;
const TOOLTIP_GUTTER_CSS = 12;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 5000;
const DEFAULT_ACK_TIMEOUT_MS = 2000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCssRect(rawRect) {
  if (!rawRect || typeof rawRect !== "object") return null;
  const x = finiteNumber(rawRect.x);
  const y = finiteNumber(rawRect.y);
  const width = finiteNumber(rawRect.width);
  const height = finiteNumber(rawRect.height);
  if (x === null || y === null || width === null || height === null || width <= 1 || height <= 1) {
    return null;
  }
  return { x, y, width, height };
}

function normalizeTooltipSizeCss(rawSize) {
  if (!rawSize || typeof rawSize !== "object") return null;
  const width = finiteNumber(rawSize.width);
  const height = finiteNumber(rawSize.height);
  if (width === null || height === null || width <= 1 || height <= 1) return null;
  return {
    width: Math.min(MAX_TOOLTIP_WIDTH_CSS - TOOLTIP_GUTTER_CSS, width),
    height: Math.min(MAX_TOOLTIP_HEIGHT_CSS - TOOLTIP_GUTTER_CSS, height),
  };
}

function normalizeNavTooltipIntent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const identifier = (value) => {
    const text = String(value || "").trim();
    return /^[a-z0-9][a-z0-9:._-]{0,79}$/i.test(text) ? text : "";
  };
  const reason = String(payload.reason || "unknown")
    .trim()
    .slice(0, 80);
  if (payload.action === "hide") {
    const scope = payload.scope === "interaction" ? "interaction" : "all";
    const interactionId = identifier(payload.interactionId);
    const triggerId = identifier(payload.triggerId);
    if (scope === "interaction" && (!interactionId || !triggerId)) return null;
    return { action: "hide", scope, interactionId, triggerId, reason };
  }
  if (payload.action !== "show") return null;
  const source =
    payload.source === "pointer"
      ? "pointer"
      : payload.source === "keyboard-focus"
        ? "keyboard-focus"
        : "";
  const interactionId = identifier(payload.interactionId);
  const triggerId = identifier(payload.triggerId);
  const label = String(payload.label || "")
    .trim()
    .slice(0, 80);
  const anchorRectCss = normalizeCssRect(payload.anchorRectCss);
  if (!source || !interactionId || !triggerId || !label || !anchorRectCss) return null;
  return {
    action: "show",
    source,
    interactionId,
    triggerId,
    label,
    side: payload.side === "left" ? "left" : "right",
    theme: payload.theme === "light" ? "light" : "dark",
    anchorRectCss,
  };
}

function normalizeZoomFactor(value) {
  const zoom = finiteNumber(value);
  return zoom && zoom > 0 ? zoom : 1;
}

function cssRectToContentDip(rawRect, rawZoomFactor) {
  const rect = normalizeCssRect(rawRect);
  if (!rect) return null;
  const zoom = normalizeZoomFactor(rawZoomFactor);
  const left = Math.floor(rect.x * zoom);
  const top = Math.floor(rect.y * zoom);
  const right = Math.ceil((rect.x + rect.width) * zoom);
  const bottom = Math.ceil((rect.y + rect.height) * zoom);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function contentRectToScreenDip(rawRect, rawContentBounds) {
  const rect = normalizeCssRect(rawRect);
  const originX = finiteNumber(rawContentBounds?.x);
  const originY = finiteNumber(rawContentBounds?.y);
  if (!rect || originX === null || originY === null) return null;
  return { ...rect, x: originX + rect.x, y: originY + rect.y };
}

function pointInsideRect(rawPoint, rawRect, tolerance = 1) {
  const x = finiteNumber(rawPoint?.x);
  const y = finiteNumber(rawPoint?.y);
  const rect = normalizeCssRect(rawRect);
  const inset = Math.max(0, finiteNumber(tolerance) ?? 0);
  if (x === null || y === null || !rect) return false;
  return (
    x >= rect.x - inset &&
    x < rect.x + rect.width + inset &&
    y >= rect.y - inset &&
    y < rect.y + rect.height + inset
  );
}

function resolveTooltipBoundsContentDip({
  anchorRectCss,
  tooltipSizeCss,
  side,
  zoomFactor,
  viewportDip,
}) {
  const anchor = cssRectToContentDip(anchorRectCss, zoomFactor);
  const size = normalizeTooltipSizeCss(tooltipSizeCss);
  const viewportWidth = finiteNumber(viewportDip?.width);
  const viewportHeight = finiteNumber(viewportDip?.height);
  if (!anchor || !size || viewportWidth === null || viewportHeight === null) return null;
  if (viewportWidth <= 1 || viewportHeight <= 1) return null;

  const zoom = normalizeZoomFactor(zoomFactor);
  const width = Math.min(
    Math.round(viewportWidth),
    Math.max(2, Math.ceil((size.width + TOOLTIP_GUTTER_CSS) * zoom)),
  );
  const height = Math.min(
    Math.round(viewportHeight),
    Math.max(2, Math.ceil((size.height + TOOLTIP_GUTTER_CSS) * zoom)),
  );
  const offset = Math.round(4 * zoom);
  const rawX = side === "left" ? anchor.x - width - offset : anchor.x + anchor.width + offset;
  const rawY = anchor.y + (anchor.height - height) / 2;
  return {
    x: Math.round(Math.max(0, Math.min(viewportWidth - width, rawX))),
    y: Math.round(Math.max(0, Math.min(viewportHeight - height, rawY))),
    width,
    height,
  };
}

function createDeferred() {
  let settled = false;
  /** @type {(value: unknown) => void} */
  let resolvePromise = () => {};
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

function waitForBootstrap(signal, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Boolean(value));
    };
    const timer = setTimeout(() => finish(false), Math.max(1, Number(timeoutMs) || 1));
    signal.promise.then(finish, () => finish(false));
  });
}

function createNavTooltipController({
  createView,
  getHost,
  loadView,
  prepareView,
  sendRenderModel,
  sendCommit,
  placeView,
  reconcileViewOrder,
  validateIntent,
  watchPointerExit,
  trace = (...args) => void args,
  bootstrapTimeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS,
}) {
  let view = null;
  let loadReady = null;
  let bootstrapReady = null;
  let transaction = null;
  let stopPointerExitWatch = null;
  let hostGeneration = 0;
  let overlayGeneration = 0;
  let renderRevision = 0;
  let disposed = false;

  function isUsable(candidate = view) {
    return Boolean(candidate && !candidate.webContents?.isDestroyed?.());
  }

  function stopWatchingPointerExit() {
    const stop = stopPointerExitWatch;
    stopPointerExitWatch = null;
    if (typeof stop === "function") stop();
  }

  function setHidden(candidate = view) {
    if (!isUsable(candidate)) return false;
    candidate.setVisible(false);
    candidate.setBounds(EMPTY_BOUNDS);
    return true;
  }

  function cancelTransaction() {
    stopWatchingPointerExit();
    if (transaction?.ackTimer) clearTimeout(transaction.ackTimer);
    transaction = null;
  }

  function armAckTimeout(captured, phase) {
    if (captured.ackTimer) clearTimeout(captured.ackTimer);
    const timer = setTimeout(() => {
      if (!isCurrent(captured) || captured.phase !== phase) return;
      trace("ack-timeout", { revision: captured.revision, phase });
      discardView(captured.view);
    }, Math.max(1, Number(ackTimeoutMs) || 1));
    timer.unref?.();
    captured.ackTimer = timer;
  }

  function disposeView(candidate) {
    if (!candidate) return;
    try {
      getHost()?.contentView?.removeChildView(candidate);
    } catch {
      // Teardown is best-effort after a renderer or host failure.
    }
    try {
      candidate.setVisible(false);
      candidate.setBounds(EMPTY_BOUNDS);
    } catch {
      // Teardown is best-effort after a renderer or host failure.
    }
    try {
      if (!candidate.webContents?.isDestroyed?.()) {
        candidate.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {
      // Teardown is best-effort after a renderer or host failure.
    }
  }

  function discardView(candidate = view) {
    if (candidate !== view) {
      disposeView(candidate);
      return;
    }
    bootstrapReady?.resolve(false);
    view = null;
    loadReady = null;
    bootstrapReady = null;
    overlayGeneration += 1;
    cancelTransaction();
    disposeView(candidate);
  }

  function ensureView() {
    if (isUsable()) return { view, loadReady, bootstrapReady, overlayGeneration };
    if (view) discardView(view);

    const generation = ++overlayGeneration;
    const readySignal = createDeferred();
    let candidate = null;
    candidate = createView((payload) => handleOverlayMessage(candidate, payload));
    view = candidate;
    bootstrapReady = readySignal;
    const host = getHost();
    if (host && !host.isDestroyed?.()) prepareView(candidate, host);
    loadReady = Promise.resolve()
      .then(() => loadView(candidate))
      .catch((error) => {
        if (candidate === view && generation === overlayGeneration) discardView(candidate);
        throw error;
      });
    return {
      view: candidate,
      loadReady,
      bootstrapReady: readySignal,
      overlayGeneration: generation,
    };
  }

  function isCurrent(captured) {
    return Boolean(
      captured &&
      transaction === captured &&
      captured.hostGeneration === hostGeneration &&
      captured.overlayGeneration === overlayGeneration &&
      isUsable(captured.view),
    );
  }

  async function prewarm() {
    if (disposed) return false;
    const host = getHost();
    if (!host || host.isDestroyed?.()) return false;
    const current = ensureView();
    await current.loadReady;
    const ready = await waitForBootstrap(current.bootstrapReady, bootstrapTimeoutMs);
    if (!ready && current.view === view && current.overlayGeneration === overlayGeneration) {
      discardView(current.view);
    }
    return Boolean(
      ready &&
      current.view === view &&
      current.overlayGeneration === overlayGeneration &&
      isUsable(current.view),
    );
  }

  function hide(options = {}) {
    if (
      options.scope === "interaction" &&
      transaction &&
      (transaction.interactionId !== options.interactionId ||
        transaction.triggerId !== options.triggerId)
    ) {
      return false;
    }
    trace("hide", {
      reason: options.reason || "hidden",
      revision: transaction?.revision || 0,
      source: transaction?.source || "",
      triggerId: transaction?.triggerId || "",
    });
    cancelTransaction();
    return setHidden();
  }

  function invalidate(reason = "host-invalidated") {
    hostGeneration += 1;
    hide({ scope: "all", reason });
    return hostGeneration;
  }

  function close() {
    disposed = true;
    hostGeneration += 1;
    cancelTransaction();
    const candidate = view;
    view = null;
    loadReady = null;
    bootstrapReady?.resolve(false);
    bootstrapReady = null;
    if (candidate) disposeView(candidate);
    return Boolean(candidate);
  }

  function setZoomLevel(level) {
    if (isUsable()) view.webContents.setZoomLevel(level);
    invalidate("zoom-changed");
  }

  function reconcileZOrder() {
    if (!isUsable()) return false;
    const host = getHost();
    if (!host || host.isDestroyed?.()) return false;
    reconcileViewOrder(view, host);
    return true;
  }

  async function show(intent) {
    if (disposed) return false;
    cancelTransaction();
    setHidden();

    const host = getHost();
    if (!host || host.isDestroyed?.() || !validateIntent(intent, host)) return false;

    const currentView = ensureView();
    const captured = {
      view: currentView.view,
      hostGeneration,
      overlayGeneration: currentView.overlayGeneration,
      revision: ++renderRevision,
      interactionId: intent.interactionId,
      triggerId: intent.triggerId,
      source: intent.source,
      intent,
      phase: "warming",
      ackTimer: null,
    };
    transaction = captured;
    trace("show-request", {
      revision: captured.revision,
      source: captured.source,
      triggerId: captured.triggerId,
      hostGeneration: captured.hostGeneration,
      overlayGeneration: captured.overlayGeneration,
    });

    if (intent.source === "pointer") {
      stopPointerExitWatch = watchPointerExit(intent, host, () => {
        if (isCurrent(captured)) {
          trace("pointer-outside", {
            revision: captured.revision,
            triggerId: captured.triggerId,
          });
          hide({
            scope: "interaction",
            interactionId: captured.interactionId,
            triggerId: captured.triggerId,
            reason: "pointer-outside",
          });
        }
      });
    }

    try {
      await currentView.loadReady;
      const ready = await waitForBootstrap(currentView.bootstrapReady, bootstrapTimeoutMs);
      if (!ready && isCurrent(captured)) discardView(captured.view);
      if (!ready || !isCurrent(captured) || !validateIntent(intent, getHost())) return false;
      prepareView(captured.view, getHost());
      captured.phase = "rendering";
      sendRenderModel(captured.view, {
        revision: captured.revision,
        label: intent.label,
        side: intent.side,
        theme: intent.theme,
      });
      armAckTimeout(captured, "rendering");
      trace("render-model", { revision: captured.revision });
      return true;
    } catch {
      if (isCurrent(captured)) discardView(captured.view);
      return false;
    }
  }

  function handleOverlayMessage(candidate, payload = {}) {
    if (candidate !== view || !isUsable(candidate)) return false;
    if (payload.type === "bootstrap-ready") {
      trace("bootstrap-ready", { overlayGeneration });
      bootstrapReady?.resolve(true);
      return true;
    }

    const captured = transaction;
    const revision = Number(payload.revision);
    if (!isCurrent(captured) || revision !== captured.revision) return false;

    if (payload.type === "layout-ready" && captured.phase === "rendering") {
      const sizeCss = normalizeTooltipSizeCss(payload.sizeCss);
      const host = getHost();
      if (!sizeCss || !host || !validateIntent(captured.intent, host)) {
        hide({ scope: "all", reason: "layout-invalid" });
        return false;
      }
      const bounds = placeView(candidate, captured.intent, sizeCss, host);
      if (!bounds) {
        hide({ scope: "all", reason: "bounds-invalid" });
        return false;
      }
      try {
        captured.finalBounds = bounds;
        candidate.setBounds(bounds);
        reconcileViewOrder(candidate, host);
        if (!validateIntent(captured.intent, host)) {
          hide({ scope: "all", reason: "pre-commit-intent-invalid" });
          return false;
        }
        // The overlay DOM remains transparent until commit. The native view must be
        // on-screen before commit because hidden or off-screen WebContentsViews can
        // suspend requestAnimationFrame and never acknowledge a painted frame.
        candidate.setVisible(true);
        captured.phase = "committing";
        sendCommit(candidate, { revision: captured.revision });
      } catch {
        if (isCurrent(captured)) discardView(candidate);
        return false;
      }
      armAckTimeout(captured, "committing");
      trace("layout-ready", { revision: captured.revision, sizeCss });
      return true;
    }

    if (payload.type === "frame-ready" && captured.phase === "committing") {
      const host = getHost();
      if (!host || !validateIntent(captured.intent, host)) {
        hide({ scope: "all", reason: "final-intent-invalid" });
        return false;
      }
      try {
        reconcileViewOrder(candidate, host);
      } catch {
        if (isCurrent(captured)) discardView(candidate);
        return false;
      }
      if (captured.ackTimer) clearTimeout(captured.ackTimer);
      captured.ackTimer = null;
      captured.phase = "visible";
      trace("visible", { revision: captured.revision, triggerId: captured.triggerId });
      return true;
    }
    return false;
  }

  function handleOverlayUnavailable(candidate) {
    if (candidate !== view) return false;
    hostGeneration += 1;
    discardView(candidate);
    return true;
  }

  function getDebugState() {
    return {
      phase: transaction?.phase || (isUsable() ? "ready-hidden" : disposed ? "disposed" : "cold"),
      hostGeneration,
      overlayGeneration,
      renderRevision,
      source: transaction?.source || "",
      triggerId: transaction?.triggerId || "",
      interactionId: transaction?.interactionId || "",
      visible: Boolean(
        transaction?.phase === "visible" && isUsable() && view.getVisible?.(),
      ),
    };
  }

  return {
    close,
    getDebugState,
    getView: () => (isUsable() ? view : null),
    handleOverlayMessage,
    handleOverlayUnavailable,
    hide,
    invalidate,
    prewarm,
    reconcileZOrder,
    setZoomLevel,
    show,
  };
}

module.exports = {
  EMPTY_BOUNDS,
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  MAX_TOOLTIP_HEIGHT_CSS,
  MAX_TOOLTIP_WIDTH_CSS,
  TOOLTIP_GUTTER_CSS,
  contentRectToScreenDip,
  createNavTooltipController,
  cssRectToContentDip,
  normalizeCssRect,
  normalizeNavTooltipIntent,
  normalizeTooltipSizeCss,
  pointInsideRect,
  resolveTooltipBoundsContentDip,
};
