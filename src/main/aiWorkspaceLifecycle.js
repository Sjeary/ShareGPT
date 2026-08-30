function safeText(value) {
  return String(value ?? "").trim();
}

function workspaceScopeKey(kind, environmentId = "") {
  return `${safeText(kind)}:${safeText(environmentId) || "default"}`;
}

function workspaceRecordKey(kind, environmentId, tabId) {
  return `${workspaceScopeKey(kind, environmentId)}:${safeText(tabId)}`;
}

function isWorkspaceViewUsable(workspace) {
  if (!workspace || workspace.viewDead) return false;
  const webContents = workspace.view?.webContents;
  if (!webContents) return false;
  try {
    return !webContents.isDestroyed();
  } catch {
    return false;
  }
}

function workspaceHostIsReady(hostState) {
  const bounds = hostState?.bounds;
  return Boolean(
    hostState?.visible && bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0,
  );
}

function routeBindingFingerprint(route) {
  if (!route || typeof route !== "object") return "";
  return JSON.stringify([
    safeText(route.id),
    safeText(route.mode),
    safeText(route.host),
    Number(route.port) || 0,
    safeText(route.inboundTag),
    safeText(route.outboundTag),
    safeText(route.dnsTag),
    route.expected && typeof route.expected === "object" ? route.expected : {},
    route.outbound && typeof route.outbound === "object" ? route.outbound : {},
  ]);
}

function shouldValidateRouteBinding(workspace, fingerprint) {
  const next = safeText(fingerprint);
  return Boolean(next && safeText(workspace?.verifiedRouteBinding) !== next);
}

function workspaceTargetEquals(left, right) {
  return Boolean(
    left &&
    right &&
    safeText(left.kind) === safeText(right.kind) &&
    safeText(left.environmentId) === safeText(right.environmentId) &&
    safeText(left.tabId) === safeText(right.tabId),
  );
}

function workspaceEnsureIsCurrent(workspace, expected, current) {
  return Boolean(
    expected?.runtimeEpoch === current?.runtimeEpoch &&
    current?.logicalWorkspace === workspace &&
    Number(workspace?.viewGeneration) === Number(expected?.viewGeneration) &&
    Number(workspace?.ensureGeneration) === Number(expected?.ensureGeneration) &&
    workspaceTargetEquals(expected?.target, current?.target) &&
    isWorkspaceViewUsable(workspace),
  );
}

function workspaceOwnerIsCurrent(workspace, principal, runtimeEpoch) {
  return Boolean(
    workspace &&
    !workspace.closing &&
    Number(workspace.runtimeEpoch) === Number(runtimeEpoch) &&
    safeText(workspace.ownerPrincipalId) === safeText(principal?.principalId) &&
    Number(workspace.ownerPrincipalGeneration) === Number(principal?.generation || 0),
  );
}

function retireWorkspaceView(view, attached, hostContentView) {
  if (!view) return;
  if (attached) {
    try {
      hostContentView?.removeChildView?.(view);
    } catch {}
  }
  try {
    if (!view.webContents?.isDestroyed?.()) {
      view.webContents?.close?.({ waitForBeforeUnload: false });
    }
  } catch {}
}

function createDurableWorkspaceRegistry() {
  const records = new Map();
  const orderByScope = new Map();
  const activeByScope = new Map();
  const environmentByKind = new Map();

  function environmentFor(kind) {
    return safeText(environmentByKind.get(safeText(kind)));
  }

  function activateEnvironment(kind, environmentId = "") {
    const targetKind = safeText(kind);
    const targetEnvironmentId = safeText(environmentId);
    const changed = environmentFor(targetKind) !== targetEnvironmentId;
    environmentByKind.set(targetKind, targetEnvironmentId);
    return { changed, environmentId: targetEnvironmentId };
  }

  function scope(kind, environmentId) {
    return workspaceScopeKey(
      kind,
      environmentId === undefined ? environmentFor(kind) : safeText(environmentId),
    );
  }

  function add(workspace) {
    const key = workspaceRecordKey(workspace.kind, workspace.environmentId, workspace.id);
    records.set(key, workspace);
    const scopeKey = scope(workspace.kind, workspace.environmentId);
    const order = orderByScope.get(scopeKey) || [];
    if (!order.includes(workspace.id)) order.push(workspace.id);
    orderByScope.set(scopeKey, order);
    if (!activeByScope.get(scopeKey)) activeByScope.set(scopeKey, workspace.id);
    return workspace;
  }

  function getLogical(kind, tabId = "", environmentId) {
    const scopeKey = scope(kind, environmentId);
    const targetTabId = safeText(tabId) || safeText(activeByScope.get(scopeKey));
    if (!targetTabId) return null;
    return records.get(`${scopeKey}:${targetTabId}`) || null;
  }

  function getUsable(kind, tabId = "", environmentId) {
    const workspace = getLogical(kind, tabId, environmentId);
    return isWorkspaceViewUsable(workspace) ? workspace : null;
  }

  function list(kind, environmentId) {
    const scopeKey = scope(kind, environmentId);
    return (orderByScope.get(scopeKey) || [])
      .map((tabId) => records.get(`${scopeKey}:${tabId}`))
      .filter(Boolean);
  }

  function all(kind) {
    const targetKind = safeText(kind);
    return [...records.values()].filter(
      (workspace) => !targetKind || safeText(workspace.kind) === targetKind,
    );
  }

  function activeId(kind, environmentId) {
    return safeText(activeByScope.get(scope(kind, environmentId)));
  }

  function setActive(kind, tabId, environmentId) {
    const workspace = getLogical(kind, tabId, environmentId);
    if (!workspace) return null;
    activeByScope.set(scope(kind, environmentId), workspace.id);
    return workspace;
  }

  function remove(kind, tabId, environmentId) {
    const scopeKey = scope(kind, environmentId);
    const targetId = safeText(tabId);
    const key = `${scopeKey}:${targetId}`;
    const workspace = records.get(key) || null;
    if (!workspace) return { workspace: null, activeTabId: activeId(kind, environmentId) };
    records.delete(key);
    const order = orderByScope.get(scopeKey) || [];
    const index = order.indexOf(targetId);
    if (index >= 0) order.splice(index, 1);
    orderByScope.set(scopeKey, order);
    if (activeByScope.get(scopeKey) === targetId) {
      activeByScope.set(scopeKey, order[Math.max(0, index - 1)] || order[0] || "");
    }
    return { workspace, activeTabId: activeId(kind, environmentId) };
  }

  function clear(kind, environmentId) {
    const targets =
      environmentId === undefined ? all(kind) : [...list(kind, safeText(environmentId))];
    for (const workspace of targets) {
      records.delete(workspaceRecordKey(workspace.kind, workspace.environmentId, workspace.id));
    }
    if (environmentId === undefined) {
      const prefix = `${safeText(kind)}:`;
      for (const key of [...orderByScope.keys()]) {
        if (key.startsWith(prefix)) {
          orderByScope.delete(key);
          activeByScope.delete(key);
        }
      }
    } else {
      const scopeKey = scope(kind, environmentId);
      orderByScope.delete(scopeKey);
      activeByScope.delete(scopeKey);
    }
    return targets;
  }

  function reset() {
    records.clear();
    orderByScope.clear();
    activeByScope.clear();
    environmentByKind.clear();
  }

  return {
    activateEnvironment,
    activeId,
    add,
    all,
    clear,
    environmentFor,
    getLogical,
    getUsable,
    list,
    remove,
    reset,
    setActive,
  };
}

/**
 * @param {(intent: any, context: { isCurrent: () => boolean, reason: string, revision: number }) => Promise<any>} reconcile
 * @param {(error: unknown, item: any) => void} [onError]
 */
function createLastIntentReconciler(reconcile, onError = () => {}) {
  let revision = 0;
  let running = false;
  const queue = [];
  let idleWaiters = [];

  function settleIdle() {
    if (running || queue.length) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue.shift();
      if (item.revision !== revision) {
        item.resolve({ applied: false, stale: true, revision: item.revision });
        continue;
      }
      const isCurrent = () => item.revision === revision;
      try {
        const value = await reconcile(item.intent, {
          isCurrent,
          reason: item.reason,
          revision: item.revision,
        });
        item.resolve({
          applied: isCurrent(),
          stale: !isCurrent(),
          revision: item.revision,
          value,
        });
      } catch (error) {
        if (!isCurrent()) {
          item.resolve({
            applied: false,
            stale: true,
            revision: item.revision,
          });
          continue;
        }
        onError(error, item);
        item.reject(error);
      }
    }
    running = false;
    settleIdle();
  }

  function submit(intent, reason = "unspecified") {
    const immutableIntent = Object.freeze({
      kind: safeText(intent?.kind),
      tabId: safeText(intent?.tabId),
      environmentId: safeText(intent?.environmentId),
    });
    const itemRevision = ++revision;
    const promise = new Promise((resolve, reject) => {
      queue.push({
        intent: immutableIntent,
        reason: safeText(reason) || "unspecified",
        revision: itemRevision,
        resolve,
        reject,
      });
    });
    queueMicrotask(() => void drain());
    return promise;
  }

  function idle() {
    if (!running && !queue.length) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  return { idle, submit };
}

module.exports = {
  createDurableWorkspaceRegistry,
  createLastIntentReconciler,
  isWorkspaceViewUsable,
  retireWorkspaceView,
  routeBindingFingerprint,
  shouldValidateRouteBinding,
  workspaceHostIsReady,
  workspaceEnsureIsCurrent,
  workspaceOwnerIsCurrent,
  workspaceRecordKey,
  workspaceScopeKey,
};
