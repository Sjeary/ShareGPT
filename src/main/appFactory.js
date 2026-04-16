const path = require("node:path");
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require("electron/main");
const { Backend } = require("./backend");

const GPT_ALLOWED_HOSTS = [
  "chatgpt.com",
  "openai.com",
  "auth0.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "gravatar.com",
  "cloudflare.com",
  "wp.com",
];

const GEMINI_ALLOWED_HOSTS = [
  "gemini.google.com",
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "gvt1.com",
];

const AI_WORKSPACE_POLICIES = {
  gpt: {
    kind: "gpt",
    partition: "persist:gpt-chat",
    homeUrl: "https://chatgpt.com/",
    allowedHosts: GPT_ALLOWED_HOSTS,
  },
  gemini: {
    kind: "gemini",
    partition: "persist:gemini-chat",
    homeUrl: "https://gemini.google.com/",
    allowedHosts: GEMINI_ALLOWED_HOSTS,
  },
};

const AI_ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

function getEventWindow(event, fallbackWindow) {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }
  return fallbackWindow && !fallbackWindow.isDestroyed() ? fallbackWindow : null;
}

function parseModeArg(argv) {
  const modeArg = (argv || []).find((item) => String(item).startsWith("--mode="));
  const value = modeArg ? String(modeArg).split("=")[1] : "";
  return value === "sender" || value === "receiver" ? value : null;
}

function normalizeMode(baseMode, argv) {
  if (baseMode === "sender" || baseMode === "receiver") {
    return baseMode;
  }
  const argMode = parseModeArg(argv);
  return argMode || "all";
}

function safeText(value) {
  return String(value || "").trim();
}

function isAllowedUrlForHosts(rawUrl, allowedHosts) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (!/^https?:$/i.test(url.protocol)) return false;
    return allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function normalizeExternalUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    if (!/^https?:$/i.test(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

async function openExternalUrl(rawUrl) {
  const url = normalizeExternalUrl(rawUrl);
  if (!url) {
    throw new Error("仅允许打开 http/https 链接");
  }
  await shell.openExternal(url);
  return true;
}

function createElectronApp(baseMode = "all") {
  let mainWindow = null;
  let profileWindow = null;
  let backend = null;
  let appMode = normalizeMode(baseMode, process.argv);
  const configuredAiPartitions = new Set();
  const aiWorkspaces = new Map();

  function emitAiEvent(kind, type, payload = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const eventPayload = {
      kind,
      type,
      ...payload,
    };
    mainWindow.webContents.send("ai:event", eventPayload);
    return eventPayload;
  }

  function getAiPolicy(kind) {
    return AI_WORKSPACE_POLICIES[safeText(kind)] || null;
  }

  function configureAiSession(targetSession, policy) {
    if (!targetSession || !policy || configuredAiPartitions.has(policy.partition)) {
      return;
    }

    configuredAiPartitions.add(policy.partition);

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = safeText(details?.requestingUrl || webContents?.getURL?.());
      const allow = AI_ALLOWED_PERMISSIONS.has(permission) && isAllowedUrlForHosts(requestingUrl, policy.allowedHosts);
      callback(allow);
    });

    if (typeof targetSession.setPermissionCheckHandler === "function") {
      targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        return AI_ALLOWED_PERMISSIONS.has(permission) && isAllowedUrlForHosts(requestingOrigin, policy.allowedHosts);
      });
    }
  }

  function getAiStatePayload(workspace) {
    const wc = workspace.view.webContents;
    const currentUrl = safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl;
    if (currentUrl && isAllowedUrlForHosts(currentUrl, workspace.policy.allowedHosts)) {
      workspace.lastUrl = currentUrl;
    }

    let canGoBack = false;
    let canGoForward = false;
    try {
      canGoBack = wc.canGoBack();
    } catch {}
    try {
      canGoForward = wc.canGoForward();
    } catch {}

    return {
      kind: workspace.kind,
      url: workspace.lastUrl || workspace.policy.homeUrl,
      loading: Boolean(workspace.loading),
      initialized: Boolean(workspace.initialized),
      canGoBack: Boolean(canGoBack),
      canGoForward: Boolean(canGoForward),
    };
  }

  function emitAiState(workspace, type = "state", payload = {}) {
    return emitAiEvent(workspace.kind, type, {
      ...getAiStatePayload(workspace),
      ...payload,
    });
  }

  function syncAiBounds(workspace, options = {}) {
    const visible = Boolean(options.visible);
    const bounds = options.bounds || null;

    workspace.visible = visible;

    if (!visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      workspace.view.setVisible(false);
      workspace.view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      return false;
    }

    workspace.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    });
    workspace.view.setVisible(true);
    return true;
  }

  function handleBlockedAiNavigation(workspace, rawUrl) {
    const url = safeText(rawUrl);
    if (!url) return;
    void openExternalUrl(url).catch((err) => {
      emitAiEvent(workspace.kind, "external-open-failed", {
        url,
        message: err.message || String(err),
      });
    });
  }

  function bindAiWorkspaceEvents(workspace) {
    const wc = workspace.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
        workspace.loading = true;
        workspace.initialized = true;
        emitAiState(workspace, "did-start-loading", { url });
        void wc.loadURL(url).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url,
            errorDescription: err.message || String(err),
          });
        });
        return { action: "deny" };
      }

      handleBlockedAiNavigation(workspace, url);
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) return;
      event.preventDefault();
      handleBlockedAiNavigation(workspace, url);
    });

    wc.on("will-redirect", (event, url) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) return;
      event.preventDefault();
      handleBlockedAiNavigation(workspace, url);
    });

    wc.on("did-start-loading", () => {
      workspace.loading = true;
      workspace.initialized = true;
      emitAiState(workspace, "did-start-loading");
    });

    wc.on("dom-ready", () => {
      emitAiState(workspace, "dom-ready");
    });

    wc.on("did-stop-loading", () => {
      workspace.loading = false;
      workspace.initialized = true;
      emitAiState(workspace, "did-stop-loading");
    });

    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (Number(errorCode) === -3) return;
      workspace.loading = false;
      emitAiEvent(workspace.kind, "did-fail-load", {
        ...getAiStatePayload(workspace),
        url: safeText(validatedURL) || workspace.lastUrl,
        errorCode,
        errorDescription: errorDescription || "未知错误",
      });
    });

    wc.on("did-navigate", (_event, url) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
        workspace.lastUrl = url;
      }
      workspace.initialized = true;
      emitAiState(workspace, "did-navigate", { url });
    });

    wc.on("did-navigate-in-page", (_event, url) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
        workspace.lastUrl = url;
      }
      emitAiState(workspace, "did-navigate-in-page", { url });
    });

    wc.on("console-message", (_event, _level, message) => {
      emitAiEvent(workspace.kind, "console-message", { message: String(message || "") });
    });
  }

  function getOrCreateAiWorkspace(kind) {
    if (aiWorkspaces.has(kind)) {
      return aiWorkspaces.get(kind);
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("主窗口尚未就绪");
    }

    const policy = getAiPolicy(kind);
    if (!policy) {
      throw new Error("不支持的 AI 工作区");
    }

    const targetSession = session.fromPartition(policy.partition);
    configureAiSession(targetSession, policy);

    const view = new WebContentsView({
      webPreferences: {
        partition: policy.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    const workspace = {
      kind,
      policy,
      view,
      initialized: false,
      loading: false,
      visible: false,
      lastUrl: policy.homeUrl,
      proxySignature: "",
    };

    bindAiWorkspaceEvents(workspace);
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    view.setVisible(false);
    mainWindow.contentView.addChildView(view);
    aiWorkspaces.set(kind, workspace);
    return workspace;
  }

  function disposeAiWorkspaces() {
    for (const workspace of aiWorkspaces.values()) {
      try {
        mainWindow?.contentView?.removeChildView(workspace.view);
      } catch {}

      try {
        if (!workspace.view.webContents.isDestroyed()) {
          workspace.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {}
    }

    aiWorkspaces.clear();
    configuredAiPartitions.clear();
  }

  function attachWindowGuards(targetWindow) {
    if (!targetWindow) return;

    targetWindow.webContents.setWindowOpenHandler(({ url }) => {
      void openExternalUrl(url).catch(() => {});
      return { action: "deny" };
    });

    targetWindow.webContents.on("will-navigate", (event, url) => {
      if (String(url || "").startsWith("file://")) return;
      event.preventDefault();
      void openExternalUrl(url).catch(() => {});
    });
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 860,
      minHeight: 620,
      title: "ChatPortal X1 V4",
      backgroundColor: "#0b1220",
      frame: false,
      autoHideMenuBar: true,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    attachWindowGuards(mainWindow);
    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    mainWindow.on("closed", () => {
      disposeAiWorkspaces();
      mainWindow = null;
    });
  }

  function assertMode(need) {
    if (appMode === "all") return;
    if (appMode !== need) {
      throw new Error(`当前为 ${appMode} 模式，不支持 ${need} 操作`);
    }
  }

  function registerIpc() {
    ipcMain.handle("settings:load", () => backend.loadSettings());
    ipcMain.handle("settings:save", (_event, settings) => backend.saveSettings(settings));
    ipcMain.handle("settings:import", () => backend.importSettings());
    ipcMain.handle("service:status", () => backend.getStatus());
    ipcMain.handle("app:paths", () => backend.getPaths());
    ipcMain.handle("app:device-info", () => backend.getDeviceInfo());
    ipcMain.handle("app:mode", () => appMode);
    ipcMain.handle("shell:open-external", async (_event, rawUrl) => {
      const url = safeText(rawUrl);
      if (!url) return false;
      return openExternalUrl(url);
    });

    ipcMain.handle("ai:ensure", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const workspace = getOrCreateAiWorkspace(kind);
      const host = safeText(payload?.host || "127.0.0.1") || "127.0.0.1";
      const port = Number.parseInt(String(payload?.port || "1080"), 10);
      const userAgent = safeText(payload?.userAgent);
      const homeUrl = safeText(payload?.homeUrl);
      const lastUrl = safeText(payload?.lastUrl);
      const forceReload = Boolean(payload?.forceReload);

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("内嵌页面代理端口不合法");
      }

      const targetSession = session.fromPartition(workspace.policy.partition);
      configureAiSession(targetSession, workspace.policy);

      const proxySignature = `${host}:${port}`;
      if (workspace.proxySignature !== proxySignature) {
        await targetSession.setProxy({
          proxyRules: `socks5://${host}:${port}`,
          proxyBypassRules: "",
        });
        workspace.proxySignature = proxySignature;
      }

      if (userAgent) {
        workspace.view.webContents.setUserAgent(userAgent);
      }

      const targetUrl = isAllowedUrlForHosts(lastUrl, workspace.policy.allowedHosts)
        ? lastUrl
        : (isAllowedUrlForHosts(homeUrl, workspace.policy.allowedHosts) ? homeUrl : workspace.policy.homeUrl);

      if (!workspace.initialized || !safeText(workspace.view.webContents.getURL())) {
        workspace.initialized = true;
        workspace.loading = true;
        workspace.lastUrl = targetUrl;
        emitAiState(workspace, "did-start-loading", { url: targetUrl });
        void workspace.view.webContents.loadURL(targetUrl).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url: targetUrl,
            errorDescription: err.message || String(err),
          });
        });
      } else if (forceReload) {
        workspace.loading = true;
        emitAiState(workspace, "did-start-loading");
        workspace.view.webContents.reload();
      }

      return getAiStatePayload(workspace);
    });

    ipcMain.handle("ai:sync-host", (_event, payload) => {
      const kind = safeText(payload?.kind);
      const workspace = aiWorkspaces.get(kind);
      if (!workspace) return false;

      const bounds = payload?.bounds;
      const visible = Boolean(payload?.visible);
      return syncAiBounds(workspace, { bounds, visible });
    });

    ipcMain.handle("ai:navigate", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const action = safeText(payload?.action);
      const url = safeText(payload?.url);
      const workspace = aiWorkspaces.get(kind);
      if (!workspace) return null;

      const wc = workspace.view.webContents;
      switch (action) {
        case "back":
          if (wc.canGoBack()) wc.goBack();
          break;
        case "forward":
          if (wc.canGoForward()) wc.goForward();
          break;
        case "reload":
          workspace.loading = true;
          emitAiState(workspace, "did-start-loading");
          wc.reload();
          break;
        case "load":
          if (!isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
            throw new Error("不允许加载该页面");
          }
          workspace.loading = true;
          workspace.initialized = true;
          workspace.lastUrl = url;
          emitAiState(workspace, "did-start-loading", { url });
          void wc.loadURL(url).catch((err) => {
            workspace.loading = false;
            emitAiEvent(workspace.kind, "did-fail-load", {
              ...getAiStatePayload(workspace),
              url,
              errorDescription: err.message || String(err),
            });
          });
          break;
        default:
          break;
      }

      return getAiStatePayload(workspace);
    });

    ipcMain.handle("ai:execute-javascript", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const code = String(payload?.code || "");
      const workspace = aiWorkspaces.get(kind);
      if (!workspace || !code) return null;
      return workspace.view.webContents.executeJavaScript(code, true);
    });

    ipcMain.handle("profile:open", (_event, payload) => {
      if (profileWindow && !profileWindow.isDestroyed()) {
        profileWindow.focus();
        return true;
      }

      profileWindow = new BrowserWindow({
        width: 900,
        height: 680,
        minWidth: 760,
        minHeight: 560,
        title: "ChatPortal X1 V4 个人资料",
        parent: mainWindow || undefined,
        modal: false,
        backgroundColor: "#0b1220",
        frame: false,
        autoHideMenuBar: true,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      attachWindowGuards(profileWindow);
      const query = {
        serverUrl: String(payload?.serverUrl || ""),
        token: String(payload?.token || ""),
        username: String(payload?.username || ""),
      };

      profileWindow.removeMenu();
      profileWindow.loadFile(path.join(__dirname, "../renderer/profile.html"), { query });
      profileWindow.on("closed", () => {
        profileWindow = null;
      });
      return true;
    });

    ipcMain.on("profile:updated", (_event, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("profile:updated", payload || {});
      }
    });

    ipcMain.handle("window:minimize", (event) => {
      const targetWindow = getEventWindow(event, mainWindow);
      if (targetWindow) {
        targetWindow.minimize();
      }
      return true;
    });

    ipcMain.handle("window:toggle-maximize", (event) => {
      const targetWindow = getEventWindow(event, mainWindow);
      if (targetWindow) {
        if (targetWindow.isMaximized()) {
          targetWindow.unmaximize();
          return false;
        }
        targetWindow.maximize();
        return true;
      }
      return false;
    });

    ipcMain.handle("window:close", (event) => {
      const targetWindow = getEventWindow(event, mainWindow);
      if (targetWindow) {
        targetWindow.close();
      }
      return true;
    });

    ipcMain.handle("window:is-maximized", (event) => {
      const targetWindow = getEventWindow(event, mainWindow);
      if (!targetWindow) return false;
      return targetWindow.isMaximized();
    });

    ipcMain.handle("sender:start", (_event, senderSettings) => {
      assertMode("sender");
      return backend.startSender(senderSettings);
    });
    ipcMain.handle("sender:stop", () => {
      assertMode("sender");
      backend.stopSender();
      return backend.getStatus();
    });

    ipcMain.handle("receiver:start", (_event, receiverSettings) => {
      assertMode("receiver");
      return backend.startReceiver(receiverSettings);
    });
    ipcMain.handle("receiver:stop", () => {
      assertMode("receiver");
      backend.stopReceiver();
      return backend.getStatus();
    });
  }

  app.whenReady().then(() => {
    backend = new Backend(app, () => mainWindow, appMode);
    backend.init();

    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    disposeAiWorkspaces();
    if (backend) backend.stopAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = {
  createElectronApp,
};
