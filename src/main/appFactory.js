const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Notification, WebContentsView, clipboard, ipcMain, session, shell } = require("electron");
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
    homeUrl: "https://chatgpt.com/auth/login",
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
const GPT_TAB_TITLE_LIMIT = 48;
const DIRECT_PROXY_CONFIG = {
  mode: "direct",
  proxyRules: "",
  proxyBypassRules: "",
};

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

function copyMissingUserDataEntries(sourceDir, targetDir) {
  if (!sourceDir || !targetDir) return;
  const from = path.resolve(sourceDir);
  const to = path.resolve(targetDir);
  if (from === to || !fs.existsSync(from)) return;

  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (fs.existsSync(targetPath)) continue;
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true, errorOnExist: false });
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function applyStableUserDataPath(appInstance) {
  const legacyUserDataDir = appInstance.getPath("userData");
  const stableUserDataDir = path.join(appInstance.getPath("appData"), "ShareGPT");

  try {
    copyMissingUserDataEntries(legacyUserDataDir, stableUserDataDir);
  } catch (err) {
    console.warn("Unable to migrate existing user data:", err.message || err);
  }

  appInstance.setPath("userData", stableUserDataDir);
}

async function flushAiSessionStorage() {
  const partitions = Object.values(AI_WORKSPACE_POLICIES).map((policy) => policy.partition);
  await Promise.all(partitions.map(async (partition) => {
    try {
      await session.fromPartition(partition).flushStorageData();
    } catch (err) {
      console.warn(`Unable to flush ${partition}:`, err.message || err);
    }
  }));
}

async function forceDirectSessionProxy(targetSession, label = "session") {
  if (!targetSession || typeof targetSession.setProxy !== "function") return;
  try {
    await targetSession.setProxy(DIRECT_PROXY_CONFIG);
  } catch (err) {
    console.warn(`Unable to force direct proxy for ${label}:`, err.message || err);
  }
}

function safeText(value) {
  return String(value || "").trim();
}

function guessMimeType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".heic": "image/heic",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".7z": "application/x-7z-compressed",
    ".rar": "application/vnd.rar",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".csv": "text/csv",
  };
  return map[ext] || "application/octet-stream";
}

function normalizeClipboardFilePath(raw) {
  const value = safeText(raw).replace(/\u0000/g, "");
  if (!value) return "";

  if (/^file:\/\//i.test(value)) {
    try {
      let pathname = decodeURIComponent(new URL(value).pathname || "");
      if (process.platform === "win32" && /^\/[a-z]:/i.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return path.normalize(pathname);
    } catch {
      return "";
    }
  }

  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }
  return "";
}

function decodeWindowsClipboardPaths(buffer) {
  const text = Buffer.from(buffer || []).toString("utf16le").replace(/\u0000+$/, "");
  return text
    .split(/\u0000+/)
    .map(normalizeClipboardFilePath)
    .filter(Boolean);
}

function decodeUtf8ClipboardPaths(buffer) {
  const text = Buffer.from(buffer || []).toString("utf8").replace(/\u0000/g, "").trim();
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(normalizeClipboardFilePath)
    .filter(Boolean);
}

function readClipboardFilePaths() {
  const formats = typeof clipboard.availableFormats === "function" ? clipboard.availableFormats() : [];
  const lowerToActual = new Map(formats.map((item) => [String(item).toLowerCase(), item]));

  if (lowerToActual.has("filenamew")) {
    const values = decodeWindowsClipboardPaths(clipboard.readBuffer(lowerToActual.get("filenamew")));
    if (values.length) return values;
  }

  if (lowerToActual.has("public.file-url")) {
    const values = decodeUtf8ClipboardPaths(clipboard.readBuffer(lowerToActual.get("public.file-url")));
    if (values.length) return values;
  }

  const textFallback = normalizeClipboardFilePath(clipboard.readText());
  if (textFallback) {
    return [textFallback];
  }

  return [];
}

function buildClipboardAttachmentPayload() {
  const filePath = readClipboardFilePaths().find((item) => {
    try {
      return fs.existsSync(item) && fs.statSync(item).isFile();
    } catch {
      return false;
    }
  });

  if (filePath) {
    const stat = fs.statSync(filePath);
    const mime = guessMimeType(filePath);
    const buffer = fs.readFileSync(filePath);
    return {
      source: "file",
      preferredMode: "attachment",
      kind: mime.startsWith("image/") ? "image" : "file",
      name: path.basename(filePath),
      mime,
      size: stat.size,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  }

  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const buffer = image.toPNG();
    return {
      source: "bitmap",
      preferredMode: "inline-image",
      kind: "image",
      name: "pasted-image.png",
      mime: "image/png",
      size: buffer.length,
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
  }

  return null;
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

function sanitizeEmbeddedUserAgent(rawUserAgent) {
  return String(rawUserAgent || "")
    .replace(/\s*Electron\/[^\s]+/ig, "")
    .replace(/\s*ShareGPT\/[^\s]+/ig, "")
    .replace(/\s*ChatPortal(?:\s+X1)?(?:\s+V\d+)?\/[^\s]+/ig, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function detectRawChatGptDocument(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    const payload = await webContents.executeJavaScript(`
      (() => ({
        contentType: String(document.contentType || ""),
        text: String(document.body?.innerText || "").slice(0, 1200),
      }))();
    `, true);
    const contentType = safeText(payload?.contentType).toLowerCase();
    const text = String(payload?.text || "");
    return (
      contentType.startsWith("text/plain")
      || (
        text.startsWith('ChatGPT{"@context":"https://schema.org"')
        && text.includes("window.__reactRouterContext")
      )
    );
  } catch {
    return false;
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
  app.setName("ShareGPT");
  if (typeof app.setAppUserModelId === "function") {
    app.setAppUserModelId("ShareGPT");
  }

  let mainWindow = null;
  let profileWindow = null;
  let backend = null;
  let appMode = normalizeMode(baseMode, process.argv);
  const configuredAiPartitions = new Set();
  const aiWorkspaces = new Map();
  const gptTabOrder = [];
  let activeGptTabId = "";
  let gptTabCounter = 0;
  let gptHostState = {
    visible: false,
    bounds: null,
  };

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

  function emitAppEvent(type, payload = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const eventPayload = {
      type,
      ...payload,
    };
    mainWindow.webContents.send("app:event", eventPayload);
    return eventPayload;
  }

  function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }

  function getAiPolicy(kind) {
    return AI_WORKSPACE_POLICIES[safeText(kind)] || null;
  }

  function workspaceKey(kind, tabId = "") {
    const targetKind = safeText(kind);
    if (targetKind === "gpt") {
      return `gpt:${safeText(tabId) || "default"}`;
    }
    return targetKind;
  }

  function getWorkspace(kind, tabId = "") {
    const targetKind = safeText(kind);
    if (targetKind === "gpt") {
      const targetTabId = safeText(tabId) || activeGptTabId;
      if (!targetTabId) return null;
      return aiWorkspaces.get(workspaceKey(targetKind, targetTabId)) || null;
    }
    return aiWorkspaces.get(workspaceKey(targetKind)) || null;
  }

  function listGptWorkspaces() {
    return gptTabOrder
      .map((tabId) => getWorkspace("gpt", tabId))
      .filter(Boolean);
  }

  function normalizeGptTabTitle(rawTitle, fallbackTitle) {
    const title = safeText(rawTitle).replace(/\s+/g, " ").slice(0, GPT_TAB_TITLE_LIMIT);
    return title || fallbackTitle || "ChatGPT";
  }

  async function configureAiSession(targetSession, policy) {
    if (!targetSession || !policy || configuredAiPartitions.has(policy.partition)) {
      return;
    }

    configuredAiPartitions.add(policy.partition);
    await forceDirectSessionProxy(targetSession, policy.partition);

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
      tabId: safeText(workspace.id),
      title: safeText(workspace.title) || safeText(workspace.defaultTitle),
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

  function attachWorkspaceView(workspace) {
    if (!mainWindow || mainWindow.isDestroyed() || workspace.attached) {
      return;
    }
    mainWindow.contentView.addChildView(workspace.view);
    workspace.attached = true;
  }

  function detachWorkspaceView(workspace) {
    if (!workspace) return;
    if (workspace.attached) {
      try {
        mainWindow?.contentView?.removeChildView(workspace.view);
      } catch {}
      workspace.attached = false;
    }
    workspace.view.setVisible(false);
    workspace.view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  }

  function listGptTabsPayload() {
    return {
      tabs: listGptWorkspaces().map((workspace) => ({
        ...getAiStatePayload(workspace),
        id: safeText(workspace.id),
      })),
      activeTabId: activeGptTabId,
    };
  }

  function emitGptTabsChanged() {
    return emitAiEvent("gpt", "tabs-changed", listGptTabsPayload());
  }

  function syncActiveGptWorkspace() {
    const activeWorkspace = getWorkspace("gpt", activeGptTabId);

    for (const workspace of listGptWorkspaces()) {
      if (workspace.id !== activeGptTabId) {
        detachWorkspaceView(workspace);
      }
    }

    if (!activeWorkspace) {
      return false;
    }

    return syncAiBounds(activeWorkspace, gptHostState);
  }

  function createGptWorkspace(options = {}) {
    const workspace = getOrCreateAiWorkspace("gpt", safeText(options.tabId), {
      title: safeText(options.title),
      lastUrl: safeText(options.lastUrl),
    });

    if (!gptTabOrder.includes(workspace.id)) {
      gptTabOrder.push(workspace.id);
    }

    if (!activeGptTabId) {
      activeGptTabId = workspace.id;
    }

    emitGptTabsChanged();
    return workspace;
  }

  function closeGptWorkspace(tabId) {
    const targetId = safeText(tabId);
    const workspace = getWorkspace("gpt", targetId);
    if (!workspace) {
      return {
        ...listGptTabsPayload(),
        activeState: getWorkspace("gpt", activeGptTabId) ? getAiStatePayload(getWorkspace("gpt", activeGptTabId)) : null,
      };
    }

    detachWorkspaceView(workspace);
    aiWorkspaces.delete(workspaceKey("gpt", targetId));

    const orderIndex = gptTabOrder.indexOf(targetId);
    if (orderIndex >= 0) {
      gptTabOrder.splice(orderIndex, 1);
    }

    try {
      if (!workspace.view.webContents.isDestroyed()) {
        workspace.view.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {}

      if (activeGptTabId === targetId) {
        activeGptTabId = gptTabOrder[Math.max(0, orderIndex - 1)] || gptTabOrder[0] || "";
      }

    syncActiveGptWorkspace();
    const activeWorkspace = getWorkspace("gpt", activeGptTabId);
    emitGptTabsChanged();
    return {
      ...listGptTabsPayload(),
      activeState: activeWorkspace ? getAiStatePayload(activeWorkspace) : null,
    };
  }

  function syncAiBounds(workspace, options = {}) {
    const visible = Boolean(options.visible);
    const bounds = options.bounds || null;

    workspace.visible = visible;

    if (!visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      if (workspace.kind === "gpt") {
        detachWorkspaceView(workspace);
      } else {
        detachWorkspaceView(workspace);
      }
      return false;
    }

    attachWorkspaceView(workspace);
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

    wc.on("did-finish-load", () => {
      if (workspace.kind !== "gpt") return;
      void detectRawChatGptDocument(wc).then((isRawDocument) => {
        if (!isRawDocument) {
          workspace.rawDocumentRecoveryAttempted = false;
          return;
        }
        if (workspace.rawDocumentRecoveryAttempted) {
          emitAiEvent(workspace.kind, "raw-document-detected", {
            ...getAiStatePayload(workspace),
            url: safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl,
          });
          return;
        }
        workspace.rawDocumentRecoveryAttempted = true;
        workspace.loading = true;
        workspace.initialized = true;
        workspace.lastUrl = workspace.policy.homeUrl;
        if (workspace.userAgent) {
          wc.setUserAgent(workspace.userAgent);
        }
        emitAiState(workspace, "did-start-loading", { url: workspace.policy.homeUrl });
        void wc.loadURL(workspace.policy.homeUrl).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url: workspace.policy.homeUrl,
            errorDescription: err.message || String(err),
          });
        });
      }).catch(() => {});
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

    wc.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (workspace.kind !== "gpt") return;
      workspace.title = normalizeGptTabTitle(title, workspace.defaultTitle);
      emitGptTabsChanged();
    });

    wc.on("console-message", (_event, _level, message) => {
      emitAiEvent(workspace.kind, "console-message", { message: String(message || "") });
    });
  }

  function getOrCreateAiWorkspace(kind, tabId = "", options = {}) {
    const targetKind = safeText(kind);
    const targetTabId = targetKind === "gpt" ? (safeText(tabId) || `tab-${++gptTabCounter}`) : "";
    const existing = getWorkspace(targetKind, targetTabId);
    if (existing) {
      return existing;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("主窗口尚未就绪");
    }

    const policy = getAiPolicy(targetKind);
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
      id: targetKind === "gpt" ? targetTabId : targetKind,
      kind: targetKind,
      policy,
      view,
      attached: false,
      initialized: false,
      loading: false,
      visible: false,
      lastUrl: safeText(options.lastUrl) || policy.homeUrl,
      defaultTitle: targetKind === "gpt"
        ? normalizeGptTabTitle(safeText(options.title), "ChatGPT")
        : safeText(options.title),
      title: targetKind === "gpt"
        ? normalizeGptTabTitle(safeText(options.title), "ChatGPT")
        : safeText(options.title),
      proxySignature: "",
      userAgent: "",
      rawDocumentRecoveryAttempted: false,
    };

    bindAiWorkspaceEvents(workspace);
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    view.setVisible(false);
    aiWorkspaces.set(workspaceKey(targetKind, workspace.id), workspace);
    return workspace;
  }

  function disposeAiWorkspaces() {
    for (const workspace of aiWorkspaces.values()) {
      detachWorkspaceView(workspace);

      try {
        if (!workspace.view.webContents.isDestroyed()) {
          workspace.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {}
    }

    aiWorkspaces.clear();
    gptTabOrder.length = 0;
    activeGptTabId = "";
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
      title: "ShareGPT",
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
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(true);
    }
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
    ipcMain.handle("chat-history:load", () => backend.loadChatHistory());
    ipcMain.handle("chat-history:save", (_event, payload) => backend.saveChatHistory(payload));
    ipcMain.handle("user-data:export", () => backend.exportUserData());
    ipcMain.handle("user-data:import", () => backend.importUserData());
    ipcMain.handle("clipboard:read-attachment", () => buildClipboardAttachmentPayload());
    ipcMain.handle("service:status", () => backend.getStatus());
    ipcMain.handle("app:paths", () => backend.getPaths());
    ipcMain.handle("app:meta", () => backend.getAppMeta());
    ipcMain.handle("app:device-info", () => backend.getDeviceInfo());
    ipcMain.handle("app:mode", () => appMode);
    ipcMain.handle("app:update-download", async (event, payload) => {
      return backend.downloadUpdatePackage(payload || {}, (progress) => {
        event.sender.send("app:update-progress", progress);
      });
    });
    ipcMain.handle("app:update-open", async (_event, payload) => {
      const filePath = safeText(payload?.filePath);
      if (!filePath) {
        throw new Error("缺少更新包路径");
      }
      await flushAiSessionStorage();
      const backup = backend.createUpdateBackup("before-open-update");
      const result = await shell.openPath(filePath);
      if (result) {
        throw new Error(result);
      }
      shell.showItemInFolder(filePath);
      if (payload?.quitAfterOpen !== false) {
        setTimeout(() => {
          app.quit();
        }, 1500);
      }
      return { ok: true, backupDir: backup.backupDir, willQuit: payload?.quitAfterOpen !== false };
    });
    ipcMain.handle("notifications:show", (_event, payload) => {
      if (!Notification.isSupported()) {
        return false;
      }

      const title = safeText(payload?.title) || "ShareGPT";
      const body = safeText(payload?.body) || "";
      const route = payload?.route && typeof payload.route === "object" ? payload.route : {};
      const notification = new Notification({
        title,
        body,
        silent: true,
      });
      notification.on("click", () => {
        focusMainWindow();
        emitAppEvent("notification-click", route);
      });
      notification.show();
      return true;
    });
    ipcMain.handle("shell:open-external", async (_event, rawUrl) => {
      const url = safeText(rawUrl);
      if (!url) return false;
      return openExternalUrl(url);
    });

    ipcMain.handle("gpt-tabs:list", () => {
      return {
        ...listGptTabsPayload(),
        activeState: getWorkspace("gpt", activeGptTabId) ? getAiStatePayload(getWorkspace("gpt", activeGptTabId)) : null,
      };
    });

    ipcMain.handle("gpt-tabs:create", (_event, payload) => {
      const workspace = createGptWorkspace({
        title: safeText(payload?.title),
        lastUrl: safeText(payload?.lastUrl),
      });
      activeGptTabId = workspace.id;
      syncActiveGptWorkspace();
      emitGptTabsChanged();
      return {
        ...listGptTabsPayload(),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("gpt-tabs:switch", (_event, payload) => {
      const tabId = safeText(payload?.tabId);
      const workspace = getWorkspace("gpt", tabId);
      if (!workspace) {
        throw new Error("目标 GPT 会话不存在");
      }
      activeGptTabId = workspace.id;
      syncActiveGptWorkspace();
      emitGptTabsChanged();
      return {
        ...listGptTabsPayload(),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("gpt-tabs:close", (_event, payload) => {
      return closeGptWorkspace(payload?.tabId);
    });

    ipcMain.handle("ai:ensure", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const requestedTabId = safeText(payload?.tabId);
      if (kind === "gpt" && !requestedTabId && !activeGptTabId) {
        return null;
      }
      const workspace = kind === "gpt"
        ? getOrCreateAiWorkspace(kind, requestedTabId || activeGptTabId, {
          lastUrl: safeText(payload?.lastUrl),
        })
        : getOrCreateAiWorkspace(kind);
      if (kind === "gpt" && !activeGptTabId) {
        activeGptTabId = workspace.id;
      }
      const host = safeText(payload?.host || "127.0.0.1") || "127.0.0.1";
      const port = Number.parseInt(String(payload?.port || "1080"), 10);
      const userAgent = sanitizeEmbeddedUserAgent(payload?.userAgent);
      const homeUrl = safeText(payload?.homeUrl);
      const lastUrl = safeText(payload?.lastUrl);
      const forceReload = Boolean(payload?.forceReload);

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("内嵌页面代理端口不合法");
      }

      const targetSession = session.fromPartition(workspace.policy.partition);
      await configureAiSession(targetSession, workspace.policy);

      const proxySignature = `${host}:${port}`;
      if (workspace.proxySignature !== proxySignature) {
        await targetSession.setProxy({
          proxyRules: `socks5://${host}:${port}`,
          proxyBypassRules: "",
        });
        workspace.proxySignature = proxySignature;
      }

      if (userAgent) {
        workspace.userAgent = userAgent;
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

      if (kind === "gpt") {
        emitGptTabsChanged();
      }
      return getAiStatePayload(workspace);
    });

    ipcMain.handle("ai:sync-host", (_event, payload) => {
      const kind = safeText(payload?.kind);
      const bounds = payload?.bounds;
      const visible = Boolean(payload?.visible);
      if (kind === "gpt") {
        gptHostState = { bounds, visible };
        return syncActiveGptWorkspace();
      }

      const workspace = getWorkspace(kind);
      if (!workspace) return false;
      return syncAiBounds(workspace, { bounds, visible });
    });

    ipcMain.handle("ai:navigate", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const action = safeText(payload?.action);
      const url = safeText(payload?.url);
      const workspace = getWorkspace(kind, safeText(payload?.tabId));
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

      if (kind === "gpt") {
        emitGptTabsChanged();
      }
      return getAiStatePayload(workspace);
    });

    ipcMain.handle("ai:execute-javascript", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const code = String(payload?.code || "");
      const workspace = getWorkspace(kind, safeText(payload?.tabId));
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
        title: "ShareGPT 个人资料",
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
      if (process.platform === "darwin") {
        profileWindow.setWindowButtonVisibility(true);
      }
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

  app.whenReady().then(async () => {
    applyStableUserDataPath(app);
    await forceDirectSessionProxy(session.defaultSession, "defaultSession");
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
