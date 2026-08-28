const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  WebContentsView,
  clipboard,
  ipcMain,
  nativeTheme,
  net: electronNet,
  session,
  shell,
} = require("electron");
const { Backend, DEFAULT_TARGET_DOMAINS } = require("./backend");
const appLog = require("./logger");
const {
  applyEnvironmentToWebContents,
  clearAiSessionData,
  detectProxyEnvironment,
  isAiKind,
  loadUrlWithTransientRetry,
  normalizeBrowserPrivacySettings,
  runtimeEnvironment,
} = require("./browserPrivacy");
const { collectPageFingerprint, snapshotDigest, newLocalProfile } = require("./browserFingerprint");
const { isAllowedUrlForHosts, isWorkspaceUrlAllowed, normalizeHttpUrl } = require("./aiNavigation");
const { translateText } = require("./translation");
const {
  COMPOSER_ISOLATED_WORLD_ID,
  armComposerEnterGate,
  assertExpectedComposerContextGeneration,
  composerGuardMarker,
  createComposerConfirmationRegistry,
  createComposerDocumentNonce,
  createComposerEnterGateToken,
  createComposerGuardToken,
  createOneShotComposerBypass,
  createSelectionTranslationRateLimiter,
  disableComposerClickGuard,
  hasClearlyNonTargetLanguage,
  installComposerClickGuard,
  installComposerDocumentNonce,
  installSelectionTranslation,
  invalidateComposerDocumentIdentity,
  inspectAiComposer,
  inspectComposerSubmit,
  isPlainComposerSubmit,
  parseComposerGuardConsoleMessage,
  parseSelectionTranslationConsoleMessage,
  readComposerEnterGateOutcome,
  replaceAiComposerText,
  selectionTranslationMarker,
  sendComposerEnter,
  waitForComposerEnterGateOutcome,
} = require("./aiComposer");
const { createAiEnvironmentGenerationGuard } = require("./aiEnvironmentGeneration");
const {
  createAuthorizationEpochGuard,
  fetchAuthenticatedJson,
  legacyCompatibleProxyRoutes,
  resolveAiSessionCapability,
} = require("./aiSessionAuthorization");
const { runSettingsPrincipalTransition } = require("./settingsPrincipalTransition");
const { createStorageFlushCoordinator } = require("./storageFlush");
const {
  normalizeAiEnvironmentId,
  normalizeAiRouteId,
  aiRouteFingerprint,
  evaluateAiRouteHealth,
  partitionForAiEnvironment,
  partitionForAiKind,
  partitionForAiProfile,
  resolvedProxyMatchesRoute,
  scaleAiHostBounds,
  shouldCloseAiWorkspacesForEnvironment,
  shouldPreflightAiRoute,
} = require("./aiEnvironments");

// 记录每个 AI 会话(按 partition)实际访问过的主机名, 供「代理检测」展示页面流量去向。
// 在 configureAiSession 内通过 webRequest 被动收集 (每个 partition 仅装一次)。
const aiContactedHostsByPartition = new Map();
const aiRouteHealthCache = new Map();
const PROFILE_IPC_CHANNELS = new Set([
  "profile:get-context",
  "window:minimize",
  "window:toggle-maximize",
  "window:close",
]);
const AI_ROUTE_HEALTH_TTL_MS = 5 * 60 * 1000;

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

const CLAUDE_ALLOWED_HOSTS = [
  "claude.ai",
  "anthropic.com",
  "claudeusercontent.com",
  "claudemcpcontent.com",
  "cloudflare.com",
  "challenges.cloudflare.com",
  "accounts.google.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "sentry.io",
  "stripe.com",
  "hcaptcha.com",
  "doubleclick.net",
  "datadoghq.com",
  "browser-intake-us5-datadoghq.com",
  "facebook.net",
  "intercom.io",
  "intercomcdn.com",
];

const AI_WORKSPACE_POLICIES = {
  gpt: {
    kind: "gpt",
    partition: "persist:gpt-chat",
    homeUrl: "https://chatgpt.com/auth/login",
    primaryHost: "chatgpt.com",
    allowedHosts: GPT_ALLOWED_HOSTS,
  },
  gemini: {
    kind: "gemini",
    partition: "persist:gemini-chat",
    homeUrl: "https://gemini.google.com/",
    primaryHost: "gemini.google.com",
    allowedHosts: GEMINI_ALLOWED_HOSTS,
  },
  claude: {
    kind: "claude",
    partition: "persist:claude-chat",
    homeUrl: "https://claude.ai/",
    primaryHost: "claude.ai",
    allowedHosts: CLAUDE_ALLOWED_HOSTS,
  },
};

// storage-access / top-level-storage-access: 允许 challenges.cloudflare.com 跨域 iframe 申请第三方存储,
// 让 Turnstile 能读写 cf_clearance(配合关闭第三方存储分区), 是 Claude 验证能通过的关键之一。
const AI_ALLOWED_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "storage-access",
  "top-level-storage-access",
]);
const GPT_TAB_TITLE_LIMIT = 48;
const COMPOSER_GUARD_WORLD_ID = COMPOSER_ISOLATED_WORLD_ID;
const COMPOSER_CONFIRM_TTL_MS = 2 * 60 * 1000;

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
  // 仅开发环境(未打包)且显式设置 SHAREGPT_USER_DATA 时, 使用隔离数据目录,
  // 避免与正在运行的生产客户端抢占 userData 目录与缓存锁。生产打包版永不进入此分支。
  const devUserDataDir = process.env.SHAREGPT_USER_DATA;
  if (devUserDataDir && !appInstance.isPackaged) {
    try {
      fs.mkdirSync(devUserDataDir, { recursive: true });
    } catch (err) {
      console.warn("Unable to create dev user data dir:", err.message || err);
    }
    appInstance.setPath("userData", devUserDataDir);
    return;
  }

  const legacyUserDataDir = appInstance.getPath("userData");
  const stableUserDataDir = path.join(appInstance.getPath("appData"), "ShareGPT");

  try {
    copyMissingUserDataEntries(legacyUserDataDir, stableUserDataDir);
  } catch (err) {
    console.warn("Unable to migrate existing user data:", err.message || err);
  }

  appInstance.setPath("userData", stableUserDataDir);
}

const storageFlushCoordinator = createStorageFlushCoordinator({
  fromPartition: (partition) => session.fromPartition(partition),
  timeoutMs: 5000,
  onWarning: (partition, error) =>
    console.warn(`Unable to flush ${partition}:`, error instanceof Error ? error.message : error),
});

function flushAiSessionStorage(extraPartitions = []) {
  const partitions = [
    ...new Set([
      ...Object.values(AI_WORKSPACE_POLICIES).map((policy) => policy.partition),
      ...extraPartitions.map((partition) => safeText(partition)).filter(Boolean),
    ]),
  ];
  return storageFlushCoordinator.flush(partitions);
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
  const text = Buffer.from(buffer || [])
    .toString("utf16le")
    .replace(/\u0000+$/, "");
  return text
    .split(/\u0000+/)
    .map(normalizeClipboardFilePath)
    .filter(Boolean);
}

function decodeUtf8ClipboardPaths(buffer) {
  const text = Buffer.from(buffer || [])
    .toString("utf8")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) return [];
  return text.split(/\r?\n/).map(normalizeClipboardFilePath).filter(Boolean);
}

function readClipboardFilePaths() {
  const formats =
    typeof clipboard.availableFormats === "function" ? clipboard.availableFormats() : [];
  const lowerToActual = new Map(formats.map((item) => [String(item).toLowerCase(), item]));

  if (lowerToActual.has("filenamew")) {
    const values = decodeWindowsClipboardPaths(
      clipboard.readBuffer(lowerToActual.get("filenamew")),
    );
    if (values.length) return values;
  }

  if (lowerToActual.has("public.file-url")) {
    const values = decodeUtf8ClipboardPaths(
      clipboard.readBuffer(lowerToActual.get("public.file-url")),
    );
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

function normalizeExternalUrl(rawUrl) {
  return normalizeHttpUrl(rawUrl);
}

// 把 Sec-CH-UA / Sec-CH-UA-Full-Version-List 里的 "Electron" 品牌洗成真实 Chrome:
// - 去掉 "Electron";v="..." 品牌项;
// - 若缺少 "Google Chrome" 品牌则按 Chromium 的版本补上(真实 Chrome 必有此品牌)。
// 版本号沿用引擎真实的 Chromium 版本, 保证与 UA / navigator.userAgentData 一致(避免触发 Turnstile 拒绝)。
function chromeifyClientHintBrands(rawValue) {
  const value = String(rawValue || "");
  if (!value) return value;
  const chromiumMatch = value.match(/"Chromium";v="([^"]+)"/i);
  if (!chromiumMatch) return value;
  const version = chromiumMatch[1];
  let out = value.replace(/,?\s*"Electron";v="[^"]*"/gi, "");
  if (!/"Google Chrome";v=/i.test(out)) {
    out = `${out}, "Google Chrome";v="${version}"`;
  }
  return out
    .replace(/^\s*,\s*/, "")
    .replace(/,\s*,/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// 内嵌页 UA: 仅去标识, 不改 Chrome 版本号。改写版本会与引擎真实的 Sec-CH-UA /
// navigator.userAgentData 不一致, 触发 Cloudflare Turnstile(Claude 用)的"特征不一致"拒绝 -> 卡验证。
function sanitizeEmbeddedUserAgent(rawUserAgent) {
  return String(rawUserAgent || "")
    .replace(/\s*Electron\/[^\s]+/gi, "")
    .replace(/\s*ShareGPT\/[^\s]+/gi, "")
    .replace(/\s*ChatPortal(?:\s+X1)?(?:\s+V\d+)?\/[^\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function detectRawChatGptDocument(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    const payload = await webContents.executeJavaScript(
      `
      (() => ({
        contentType: String(document.contentType || ""),
        text: String(document.body?.innerText || "").slice(0, 1200),
      }))();
    `,
      true,
    );
    const contentType = safeText(payload?.contentType).toLowerCase();
    const text = String(payload?.text || "");
    // 回退到 4.2.0 的窄判定: 必须同时命中前缀与 __reactRouterContext,
    // 避免误判 Cloudflare 挑战页/正常页为"裸文档"而触发自愈跳转。
    return (
      contentType.startsWith("text/plain") ||
      (text.startsWith('ChatGPT{"@context":"https://schema.org"') &&
        text.includes("window.__reactRouterContext"))
    );
  } catch {
    return false;
  }
}

function normalizeAiWorkspaceUrl(_workspace, rawUrl) {
  // 4.2.0 行为: 不改写已允许域名的 URL。
  // 之前把 chatgpt.com/ 改写成 /auth/login 并强制重载, 会打断 Cloudflare
  // 过完人机验证后回跳 chatgpt.com 根路径的流程, 导致反复弹验证。故移除改写。
  return safeText(rawUrl);
}

function htmlNavigationOptions(workspace) {
  const options = {
    extraHeaders: [
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Upgrade-Insecure-Requests: 1",
    ].join("\r\n"),
  };
  if (workspace?.appliedUserAgent || workspace?.userAgent) {
    options.userAgent = workspace.appliedUserAgent || workspace.userAgent;
  }
  return options;
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

  // Cloudflare Turnstile(Claude 用)在内嵌视图里死循环的两大根因 + 限流, 都在这里关掉:
  // (1) 第三方存储分区/Cookie 限制: Turnstile 跑在 challenges.cloudflare.com 跨域 iframe, 需要写入
  //     分区的 cf_clearance Cookie; Electron 默认开启第三方存储分区并拦第三方 Cookie -> 验证状态存不下
  //     -> 一直重新验证。关掉这些特征让 cf_clearance 能落盘。
  // (2) 遮挡/后台限流: 内嵌视图被判遮挡时 Chromium 会限流 timer/rAF, Turnstile 的计时器跑不完。
  // 注意: 多个 disable-features 必须合并到一个开关里, 重复 appendSwitch("disable-features", ...) 会互相覆盖!
  app.commandLine.appendSwitch(
    "disable-features",
    [
      "CalculateNativeWinOcclusion",
      "ThirdPartyStoragePartitioning",
      "PartitionedCookies",
      "ThirdPartyCookieDeprecation",
      "PartitionConnectionsByNetworkIsolationKey",
      "SplitCacheByNetworkIsolationKey",
    ].join(","),
  );
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");

  // (3) 禁用 HTTP/3(QUIC), 强制走 TCP/HTTP2。
  // 机场(shadowsocks)节点的 UDP 中继常不稳/被限, 浏览器对 Cloudflare 走 QUIC(UDP) 会卡死又
  // 不干净回落 -> 验证页白屏 (本机直连机场尤甚; Mac 的 Chromium 更激进用 QUIC, 故白屏更严重)。
  // 统一梯子是中转服务器重新发起干净 TCP, 不受影响; 这里禁 QUIC 对两种模式都安全。
  app.commandLine.appendSwitch("disable-quic");

  // 关键: 用 app.userAgentFallback 去掉 UA 里的 Electron/应用 标识, 用引擎真实的 Chrome 版本号。
  // 这是唯一能覆盖 Service Worker 的 UA 设置方式 —— setUserAgent / loadURL({userAgent}) /
  // onBeforeSendHeaders 都不影响 service worker, 而 Turnstile 的检测逻辑跑在 service worker 里,
  // 会一直拿到带 "Electron" 的原始 UA。必须在创建任何窗口前设置; 用真实 Chromium 版本(不伪造更高版本,
  // 否则与 TLS/JA4 的版本对不上)。
  try {
    const chromeVer = process.versions.chrome || "126.0.0.0";
    const platformToken =
      process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : process.platform === "win32"
          ? "Windows NT 10.0; Win64; x64"
          : "X11; Linux x86_64";
    app.userAgentFallback = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  } catch {}

  let mainWindow = null;
  let profileWindow = null;
  let profileContext = null;
  let backend = null;
  // electron-updater: 仅 Windows 打包版启用「原地无感更新」(NSIS)。
  // mac 未签名无法走 Squirrel 自动更新, 仍用下载 dmg 的方式; dev/未打包也不启用。
  let autoUpdater = null;
  let autoUpdaterBusy = false;
  let appMode = normalizeMode(baseMode, process.argv);
  const configuredAiPartitions = new Set();
  const aiWorkspaces = new Map();
  const translationRequests = new Map();
  const configuredComposerTtl = Number.parseInt(
    String(process.env.SHAREGPT_COMPOSER_CONFIRM_TTL_MS || ""),
    10,
  );
  const composerConfirmationTtl =
    !app.isPackaged && Number.isInteger(configuredComposerTtl) && configuredComposerTtl > 0
      ? Math.min(configuredComposerTtl, COMPOSER_CONFIRM_TTL_MS)
      : COMPOSER_CONFIRM_TTL_MS;
  const pendingComposerSends = createComposerConfirmationRegistry({
    ttlMs: composerConfirmationTtl,
    onExpire: (pending) => emitComposerSendInvalidated(pending, "expired"),
  });
  let composerEligibility = { principalId: "", eligible: false };
  const aiAuthorizationEpoch = createAuthorizationEpochGuard();
  let runningSenderAuthorizationFingerprint = "";
  let aiAuthorization = {
    principalId: "",
    principalGeneration: 0,
    authenticated: false,
    advancedAllowed: false,
    isAdmin: false,
    allowedRouteIds: new Set(),
    routes: [],
    sender: {},
  };
  // GPT 与 Gemini 均支持多标签: 标签顺序 / 活动标签 / 宿主矩形 均按 kind 索引。
  const tabOrderByKind = { gpt: [], gemini: [], claude: [] };
  const activeTabIdByKind = { gpt: "", gemini: "", claude: "" };
  let activeAiKind = "";
  const aiEnvironmentGuard = createAiEnvironmentGenerationGuard();
  let aiTabCounter = 0;
  const hostStateByKind = {
    gpt: { visible: false, bounds: null },
    gemini: { visible: false, bounds: null },
    claude: { visible: false, bounds: null },
  };
  const AI_ZOOM_MIN = -3;
  const AI_ZOOM_MAX = 5;

  function aiZoomAction(input) {
    if (input?.type !== "keyDown" || (!input.control && !input.meta) || input.alt) {
      return "";
    }
    const key = safeText(input.key).toLowerCase();
    if (key === "=" || key === "+") return "in";
    if (key === "-" || key === "_") return "out";
    if (key === "0") return "reset";
    return "";
  }

  function adjustAppZoom(action) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const shell = mainWindow.webContents;
    if (!shell || shell.isDestroyed()) return false;
    const current = shell.getZoomLevel();
    const delta = action === "in" ? 0.5 : action === "out" ? -0.5 : 0;
    const next =
      action === "reset" ? 0 : Math.max(AI_ZOOM_MIN, Math.min(AI_ZOOM_MAX, current + delta));
    if (action !== "reset" && !delta) return false;

    // getBoundingClientRect 使用外层页面的 CSS 像素，而 WebContentsView 需要窗口 DIP。
    // 缩放期间先摘下原生层，等待渲染层用新倍率重新同步边界，避免中间帧盖住工具栏。
    for (const workspace of aiWorkspaces.values()) {
      detachWorkspaceView(workspace);
      const wc = workspace?.view?.webContents;
      if (wc && !wc.isDestroyed()) wc.setZoomLevel(next);
    }
    for (const kind of Object.keys(hostStateByKind)) {
      hostStateByKind[kind] = {
        visible: hostStateByKind[kind].visible,
        bounds: null,
      };
    }
    shell.setZoomLevel(next);
    emitAppEvent("ai-zoom-changed", { zoomLevel: next });
    return true;
  }

  function setActiveAiKind(rawKind) {
    const nextKind = isAiKind(safeText(rawKind)) ? safeText(rawKind) : "";
    if (nextKind === activeAiKind) return activeAiKind;
    const previousWorkspace = getWorkspace(activeAiKind, activeTabIdByKind[activeAiKind]);
    if (previousWorkspace) invalidateComposerWorkspace(previousWorkspace, "workspace-switched");
    activeAiKind = nextKind;
    for (const workspace of aiWorkspaces.values()) {
      detachWorkspaceView(workspace);
    }
    return activeAiKind;
  }

  function assertCurrentAiEnvironmentOperation(payload) {
    return aiEnvironmentGuard.assert(payload);
  }

  function assertPrincipalUnchanged(expected) {
    const current = backend.getPrincipalContext();
    const principalId = typeof expected === "string" ? expected : expected?.principalId;
    const generation = typeof expected === "object" ? Number(expected?.generation) : null;
    if (
      current.principalId !== principalId ||
      (Number.isInteger(generation) && current.generation !== generation)
    ) {
      throw Object.assign(new Error("协作账号已切换，操作已终止"), {
        code: "PRINCIPAL_CHANGED",
      });
    }
  }

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

  function isComposerEligible() {
    const principalId = backend?.getPrincipalContext?.().principalId || "";
    return Boolean(
      composerEligibility.eligible &&
      principalId &&
      composerEligibility.principalId === principalId,
    );
  }

  function clearAiAuthorization(reason = "authorization-cleared") {
    const epoch = aiAuthorizationEpoch.advance();
    aiAuthorization = {
      principalId: "",
      principalGeneration: 0,
      authenticated: false,
      advancedAllowed: false,
      isAdmin: false,
      allowedRouteIds: new Set(),
      routes: [],
      sender: {},
    };
    composerEligibility = { principalId: "", eligible: false };
    invalidateAllComposerWorkspaces(reason);
    return epoch;
  }

  function currentAiAuthorization(options = {}) {
    const principal = backend?.getPrincipalContext?.() || {};
    const current =
      aiAuthorization.authenticated &&
      aiAuthorization.principalId === principal.principalId &&
      aiAuthorization.principalGeneration === Number(principal.generation)
        ? aiAuthorization
        : null;
    if (!current) throw new Error("当前协作会话尚未完成主进程授权校验");
    if (options.advanced && !current.advancedAllowed) {
      throw new Error("当前账号未获授权使用高级 AI 环境");
    }
    return current;
  }

  function aiAuthorizationFingerprint(authorization = aiAuthorization) {
    if (!authorization?.authenticated) return "";
    return JSON.stringify({
      principalId: authorization.principalId,
      principalGeneration: authorization.principalGeneration,
      advancedAllowed: authorization.advancedAllowed,
      isAdmin: authorization.isAdmin,
      allowedRouteIds: [...authorization.allowedRouteIds].sort(),
      routes: authorization.routes,
      sender: authorization.sender,
    });
  }

  function stopAuthorizedSender() {
    runningSenderAuthorizationFingerprint = "";
    backend.stopSender();
  }

  async function verifyAiSessionAuthorization(rawToken, authorizationEpoch) {
    const token = String(rawToken || "").trim();
    const principal = backend.getPrincipalContext();
    const serverUrl = String(principal.serverUrl || "").replace(/\/+$/, "");
    const username = String(principal.username || "");
    if (!token || token.length > 8192 || !serverUrl || !username) {
      throw new Error("协作会话授权信息不完整");
    }
    const payload = await fetchAuthenticatedJson(
      electronNet.fetch,
      `${serverUrl}/api/client/bootstrap`,
      token,
    );
    if (!Array.isArray(payload.proxyRoutes)) {
      payload.proxyRoutes = legacyCompatibleProxyRoutes(payload);
    }
    aiAuthorizationEpoch.assert(authorizationEpoch);
    assertPrincipalUnchanged(principal);
    const legacyProfile = payload?.authorization
      ? null
      : await fetchAuthenticatedJson(electronNet.fetch, `${serverUrl}/api/profile`, token);
    const authorization = resolveAiSessionCapability(payload, legacyProfile, username);
    aiAuthorizationEpoch.assert(authorizationEpoch);
    assertPrincipalUnchanged(principal);
    const allowedIds = new Set(
      (Array.isArray(authorization.allowedProxyRouteIds) ? authorization.allowedProxyRouteIds : [])
        .map((id) => normalizeAiRouteId(id))
        .filter(Boolean),
    );
    const routes = (Array.isArray(payload.proxyRoutes) ? payload.proxyRoutes : [])
      .map((route) => {
        const id = normalizeAiRouteId(route?.id);
        if (!id || !allowedIds.has(id) || route?.enabled === false) return null;
        return {
          id,
          name: safeText(route?.name) || id,
          enabled: true,
          kind: safeText(route?.kind) === "unified" ? "unified" : "managed",
          outbound:
            route?.outbound && typeof route.outbound === "object"
              ? structuredClone(route.outbound)
              : null,
          expected:
            route?.expected && typeof route.expected === "object"
              ? structuredClone(route.expected)
              : {},
        };
      })
      .filter(Boolean);
    const routeIds = new Set(routes.map((route) => route.id));
    aiAuthorization = {
      principalId: principal.principalId,
      principalGeneration: Number(principal.generation),
      authenticated: true,
      advancedAllowed: authorization.advancedAiAllowed,
      isAdmin: authorization.isAdmin,
      allowedRouteIds: routeIds,
      routes,
      sender:
        payload?.sender && typeof payload.sender === "object"
          ? structuredClone(payload.sender)
          : {},
    };
    composerEligibility = { principalId: principal.principalId, eligible: true };
    await syncAllComposerClickGuards();
    aiAuthorizationEpoch.assert(authorizationEpoch);
    assertPrincipalUnchanged(principal);
    return {
      ok: true,
      principalId: principal.principalId,
      eligible: true,
      advancedAllowed: aiAuthorization.advancedAllowed,
      isAdmin: aiAuthorization.isAdmin,
      allowedProxyRouteIds: [...routeIds],
      authorizedAiRoutes: aiAuthorization.routes.map((route) => ({
        id: route.id,
        name: route.name,
        mode: "singbox",
        configKey: crypto
          .createHash("sha256")
          .update(JSON.stringify([route, aiAuthorization.sender]))
          .digest("hex")
          .slice(0, 16),
      })),
    };
  }

  function authorizedSenderSettings(rawSettings) {
    const supplied = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const principal = backend.getPrincipalContext();
    if (!principal.serverUrl) return supplied;
    const authorization = currentAiAuthorization();
    const serverSender = authorization.sender || {};
    const next = { ...supplied };
    for (const key of [
      "proxy_server",
      "proxy_port",
      "proxy_uuid",
      "proxy_expected_ip",
      "proxy_expected_country",
      "proxy_expected_asn",
    ]) {
      next[key] = serverSender[key] || "";
    }
    next.managed_proxy_routes = authorization.routes
      .filter((route) => route.kind === "managed" && route.outbound)
      .map((route) => ({
        id: route.id,
        name: route.name,
        enabled: true,
        kind: "managed",
        outbound: structuredClone(route.outbound),
        expected: structuredClone(route.expected || {}),
      }));
    next.authorized_proxy_route_ids = [...authorization.allowedRouteIds];
    next.route_all = authorization.isAdmin && supplied.route_all === true;
    if (next.proxy_mode === "airport") {
      const route = authorization.routes.find(
        (item) => item.id === "internal-airport" && item.outbound,
      );
      if (!route) throw new Error("当前账号未获授权使用机场节点");
      next.airport_name = route.name;
      next.airport_outbound = structuredClone(route.outbound);
    } else {
      next.airport_name = "";
      next.airport_outbound = null;
    }
    return next;
  }

  function emitComposerSendInvalidated(pending, reason) {
    if (!pending) return;
    emitAiEvent(pending.kind, "composer-send-invalidated", {
      tabId: pending.tabId,
      requestId: pending.requestId,
      reason: safeText(reason),
    });
  }

  function invalidateComposerWorkspace(workspace, reason = "invalidated") {
    if (!workspace) return;
    const pending = pendingComposerSends.invalidateWorkspace(
      workspaceKey(workspace.kind, workspace.id),
    );
    emitComposerSendInvalidated(pending, reason);
    const documentNonce = workspace.composerDocumentNonce;
    const wc = workspace.view?.webContents;
    if (documentNonce && wc && !wc.isDestroyed()) {
      void invalidateComposerDocumentIdentity(wc, { documentNonce, reason }).catch(() => {});
    }
    workspace.composerContextGeneration = (workspace.composerContextGeneration || 0) + 1;
    workspace.composerGuardToken = "";
    workspace.selectionTranslationToken = "";
    workspace.composerDocumentNonce = "";
    workspace.composerDocumentUrl = "";
    workspace.composerGuardBypass?.clear?.();
    workspace.selectionTranslationRateLimiter?.clear?.();
  }

  function invalidateAllComposerWorkspaces(reason = "invalidated") {
    for (const workspace of aiWorkspaces.values()) invalidateComposerWorkspace(workspace, reason);
    for (const pending of pendingComposerSends.clear()) {
      emitComposerSendInvalidated(pending, reason);
    }
  }

  function captureComposerContext(workspace, options = {}) {
    const principalContext = backend?.getPrincipalContext?.() || {
      principalId: "",
      generation: -1,
    };
    const context = {
      workspace,
      kind: safeText(workspace?.kind),
      tabId: safeText(workspace?.id),
      environmentId: safeText(workspace?.environmentId),
      environmentGeneration: Number(workspace?.environmentGeneration || 0),
      principalId: principalContext.principalId,
      principalContext,
      composerContextGeneration: Number(workspace?.composerContextGeneration || 0),
      requireActive: options.requireActive !== false,
    };
    assertComposerContextCurrent(context);
    return context;
  }

  function assertComposerContextCurrent(context) {
    const workspace = context?.workspace;
    const wc = workspace?.view?.webContents;
    if (!isComposerEligible()) throw new Error("当前账号无网页翻译权限");
    assertPrincipalUnchanged(context.principalContext);
    if (
      !workspace ||
      !wc ||
      wc.isDestroyed() ||
      getWorkspace(context.kind, context.tabId) !== workspace ||
      safeText(workspace.environmentId) !== context.environmentId ||
      Number(workspace.environmentGeneration || 0) !== context.environmentGeneration ||
      Number(workspace.composerContextGeneration || 0) !== context.composerContextGeneration ||
      !isWorkspaceDocumentAllowed(workspace)
    ) {
      throw Object.assign(new Error("网页发送上下文已失效"), {
        code: "COMPOSER_CONTEXT_STALE",
      });
    }
    if (
      context.requireActive &&
      (activeAiKind !== context.kind || activeTabIdByKind[context.kind] !== context.tabId)
    ) {
      throw Object.assign(new Error("目标会话已切换，请重新操作"), {
        code: "COMPOSER_CONTEXT_STALE",
      });
    }
    if (
      !aiEnvironmentGuard.isCurrent({
        kind: context.kind,
        environmentId: context.environmentId,
        generation: context.environmentGeneration,
      })
    ) {
      throw Object.assign(new Error("AI 环境操作已失效"), {
        code: "AI_ENVIRONMENT_STALE",
      });
    }
    return workspace;
  }

  async function replayComposerEnter(context, options = {}) {
    const workspace = assertComposerContextCurrent(context);
    const wc = workspace.view.webContents;
    const documentNonce = workspace.composerDocumentNonce;
    const documentUrl = workspace.composerDocumentUrl;
    const token = options.enterGateToken || createComposerEnterGateToken();
    const assertGateCurrent = () => {
      assertComposerContextCurrent(context);
      if (
        workspace.composerDocumentNonce !== documentNonce ||
        workspace.composerDocumentUrl !== documentUrl
      ) {
        throw Object.assign(new Error("网页发送文档已经变化，请重新操作"), {
          code: "COMPOSER_ENTER_GATE_BLOCKED",
        });
      }
    };
    if (!options.gateArmed) {
      await armComposerEnterGate(wc, {
        documentNonce,
        documentUrl,
        token,
        expectedText: options.expectedText,
        findAny: options.findAny,
      });
    }
    assertGateCurrent();
    const preflight = await readComposerEnterGateOutcome(wc, token);
    assertGateCurrent();
    if (preflight?.status !== "pending") {
      throw Object.assign(new Error("网页发送保护已失效，请重新操作"), {
        code: "COMPOSER_ENTER_GATE_BLOCKED",
        reason: safeText(preflight?.reason || preflight?.status),
      });
    }
    workspace.composerGuardBypass.arm(context.composerContextGeneration);
    try {
      sendComposerEnter(wc);
      assertGateCurrent();
      const outcome = await waitForComposerEnterGateOutcome(wc, token);
      assertGateCurrent();
      if (outcome?.status !== "allowed") {
        throw Object.assign(new Error("网页发送焦点已经变化，未执行发送"), {
          code: "COMPOSER_ENTER_GATE_BLOCKED",
          reason: safeText(outcome?.reason || outcome?.status),
        });
      }
      return true;
    } finally {
      workspace.composerGuardBypass.clear();
    }
  }

  function queueComposerConfirmation(context, text, targetLanguage, options = {}) {
    const workspace = assertComposerContextCurrent(context);
    const { pending, replaced } = pendingComposerSends.queue(
      workspaceKey(workspace.kind, workspace.id),
      {
        kind: workspace.kind,
        tabId: workspace.id,
        environmentId: context.environmentId,
        environmentGeneration: context.environmentGeneration,
        principalId: context.principalId,
        composerContextGeneration: context.composerContextGeneration,
        context,
        text,
        findAny: Boolean(options.findAny),
      },
    );
    emitComposerSendInvalidated(replaced, "replaced");
    emitAiEvent(workspace.kind, "confirm-non-target-send", {
      tabId: workspace.id,
      requestId: pending.requestId,
      text,
      targetLanguage,
    });
    return pending;
  }

  function emitSelectionTranslation(context, text) {
    const workspace = assertComposerContextCurrent(context);
    const documentNonce = safeText(workspace.composerDocumentNonce);
    const documentUrl = safeText(workspace.composerDocumentUrl);
    if (!documentNonce || !documentUrl) {
      throw Object.assign(new Error("网页选区上下文尚未准备好"), {
        code: "COMPOSER_CONTEXT_STALE",
      });
    }
    return emitAiEvent(workspace.kind, "translate-selection", {
      tabId: workspace.id,
      text: String(text || "")
        .trim()
        .slice(0, 30000),
      principalId: context.principalId,
      principalGeneration: Number(context.principalContext?.generation || 0),
      environmentId: context.environmentId,
      environmentGeneration: context.environmentGeneration,
      navigationGeneration: context.composerContextGeneration,
      documentNonce,
      documentUrl,
    });
  }

  function guardComposerEnter(workspace, event, input) {
    if (!isPlainComposerSubmit(input)) return false;
    if (workspace.composerGuardBypass.consume(workspace.composerContextGeneration)) return false;
    if (!isComposerEligible()) return false;
    const translation = backend?.loadSettings()?.translation || {};
    if (translation.confirmNonTargetSend === false) return false;
    const targetLanguage = safeText(translation.siteLanguage) || "en";
    let context;
    try {
      context = captureComposerContext(workspace);
    } catch {
      return false;
    }

    event.preventDefault();
    void inspectComposerSubmit(workspace.view.webContents, targetLanguage, {
      assertCurrent: () => assertComposerContextCurrent(context),
    })
      .then(async (decision) => {
        if (decision.action === "replay") {
          await replayComposerEnter(context, { expectedText: decision.text });
          return;
        }
        queueComposerConfirmation(context, decision.text, targetLanguage);
      })
      .catch((error) => {
        try {
          assertComposerContextCurrent(context);
          emitAiEvent(workspace.kind, "composer-send-guard-failed", {
            tabId: workspace.id,
            message: safeText(error?.message) || "无法检查待发送内容",
          });
        } catch {}
      });
    return true;
  }

  async function syncComposerClickGuard(workspace) {
    const wc = workspace?.view?.webContents;
    if (!wc || wc.isDestroyed() || !isWorkspaceDocumentAllowed(workspace)) return false;
    if (!isComposerEligible()) {
      if (workspace.composerGuardInstalled) {
        await disableComposerClickGuard(wc, COMPOSER_GUARD_WORLD_ID);
        workspace.composerGuardInstalled = false;
      }
      invalidateComposerWorkspace(workspace, "ineligible");
      return false;
    }
    const context = captureComposerContext(workspace, { requireActive: false });
    const translation = backend?.loadSettings()?.translation || {};
    if (!workspace.composerDocumentNonce || !workspace.composerDocumentUrl) {
      const nonce = createComposerDocumentNonce();
      workspace.composerDocumentNonce = nonce;
      workspace.composerDocumentUrl = "";
      try {
        const documentIdentity = await installComposerDocumentNonce(wc, {
          worldId: COMPOSER_GUARD_WORLD_ID,
          nonce,
        });
        assertComposerContextCurrent(context);
        if (workspace.composerDocumentNonce !== nonce) {
          throw new Error("网页文档身份已失效");
        }
        workspace.composerDocumentUrl = documentIdentity.url;
      } catch (error) {
        if (workspace.composerDocumentNonce === nonce) {
          workspace.composerDocumentNonce = "";
          workspace.composerDocumentUrl = "";
        }
        throw error;
      }
    }
    const documentNonce = workspace.composerDocumentNonce;
    const documentUrl = workspace.composerDocumentUrl;
    if (!workspace.composerGuardToken) workspace.composerGuardToken = createComposerGuardToken();
    const token = workspace.composerGuardToken;
    await installComposerClickGuard(wc, {
      worldId: COMPOSER_GUARD_WORLD_ID,
      enabled: translation.confirmNonTargetSend !== false,
      targetLanguage: safeText(translation.siteLanguage) || "en",
      marker: composerGuardMarker(token),
    });
    if (!workspace.selectionTranslationToken) {
      workspace.selectionTranslationToken = createComposerGuardToken();
    }
    const selectionToken = workspace.selectionTranslationToken;
    await installSelectionTranslation(wc, {
      worldId: COMPOSER_GUARD_WORLD_ID,
      enabled:
        translation.autoTranslateSelection === true &&
        isAutomaticSelectionTranslationAllowed(workspace),
      marker: selectionTranslationMarker(selectionToken),
      documentNonce,
      documentUrl,
      navigationGeneration: context.composerContextGeneration,
      principalId: context.principalId,
      principalGeneration: Number(context.principalContext?.generation || 0),
      environmentId: context.environmentId,
      environmentGeneration: context.environmentGeneration,
    });
    assertComposerContextCurrent(context);
    if (workspace.composerGuardToken !== token) throw new Error("网页发送守卫已失效");
    if (workspace.selectionTranslationToken !== selectionToken) {
      throw new Error("网页选区翻译守卫已失效");
    }
    if (
      workspace.composerDocumentNonce !== documentNonce ||
      workspace.composerDocumentUrl !== documentUrl
    ) {
      throw new Error("网页文档身份已失效");
    }
    workspace.composerGuardInstalled = true;
    return true;
  }

  function syncAllComposerClickGuards() {
    return Promise.allSettled(
      [...aiWorkspaces.values()].map((workspace) => syncComposerClickGuard(workspace)),
    );
  }

  // 初始化 electron-updater (Windows 打包版)。更新源由 electron-builder 写入的 app-update.yml 决定
  // (publish=github -> 读取 GitHub Release 的 latest.yml), 公开仓库无需 token。
  function setupAutoUpdater() {
    if (process.platform !== "win32" || !app.isPackaged) return;
    try {
      autoUpdater = require("electron-updater").autoUpdater;
    } catch (_err) {
      autoUpdater = null;
      return;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("download-progress", (p) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("app:update-progress", {
        percent: p && p.percent,
        transferred: p && p.transferred,
        total: p && p.total,
        fileName: "更新包",
      });
    });
    autoUpdater.on("error", (err) => {
      emitAppEvent("update-error", { message: String((err && err.message) || err) });
    });
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

  function getConfiguredAiEnvironment(kind, environmentId) {
    const targetKind = safeText(kind);
    const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
    if (!targetEnvironmentId) return null;
    const advanced = backend?.loadSettings()?.advancedAi;
    if (!advanced?.enabled || !Array.isArray(advanced.environments)) {
      throw new Error("高级 AI 环境尚未开启");
    }
    const environment = advanced.environments.find(
      (item) =>
        normalizeAiEnvironmentId(item?.id) === targetEnvironmentId &&
        safeText(item?.kind) === targetKind,
    );
    if (!environment) throw new Error("AI 环境不存在或不属于当前服务");
    const authorization = currentAiAuthorization({ advanced: true });
    const routeId = normalizeAiRouteId(environment.routeId);
    if (!routeId || !authorization.allowedRouteIds.has(routeId)) {
      throw new Error("当前账号未获授权使用该 AI 环境线路");
    }
    return { ...environment, id: targetEnvironmentId };
  }

  function getAiPolicy(kind, environmentId = "") {
    const targetKind = safeText(kind);
    const base = AI_WORKSPACE_POLICIES[targetKind];
    if (!base) return null;
    const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
    const principal = backend.getPrincipalContext();
    if (targetEnvironmentId) {
      getConfiguredAiEnvironment(targetKind, targetEnvironmentId);
      return {
        ...base,
        partition: partitionForAiEnvironment(
          targetKind,
          targetEnvironmentId,
          principal.principalId,
          principal.legacyPartitionOwnerId,
        ),
      };
    }
    const basePartition = partitionForAiKind(
      targetKind,
      principal.principalId,
      principal.legacyPartitionOwnerId,
    );
    const configured = safeText(backend?.loadSettings()?.[targetKind]?.partition);
    const principalPrefix = `persist:sharegpt-${principal.principalId}-${targetKind}-profile-`;
    const legacyProfile = new RegExp(`^persist:${targetKind}-profile-[a-z0-9-]+$`, "i");
    const partition =
      configured === basePartition ||
      configured.startsWith(principalPrefix) ||
      (principal.principalId === principal.legacyPartitionOwnerId && legacyProfile.test(configured))
        ? configured
        : basePartition;
    return { ...base, partition };
  }

  function getWorkspaceProxyRoute(kind, environmentId, sender) {
    const targetEnvironmentId = normalizeAiEnvironmentId(environmentId);
    if (!targetEnvironmentId) {
      const port = Number.parseInt(String(sender?.port || ""), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("内嵌页面代理端口不合法");
      }
      return {
        id: "sender",
        mode: "sender",
        label: "当前统一代理",
        host: "127.0.0.1",
        port,
      };
    }
    const environment = getConfiguredAiEnvironment(kind, targetEnvironmentId);
    const routeId = normalizeAiRouteId(environment.routeId);
    if (!routeId) throw new Error("环境绑定的内置线路无效，请重新选择");
    const route = backend.getAiProxyRoute(routeId);
    if (!route) throw new Error("环境绑定的内置线路未启动，已阻止自动换线");
    return route;
  }

  async function checkAiRouteHealth(route, options = {}) {
    const routeId = normalizeAiRouteId(route?.id);
    if (!routeId || route?.mode !== "singbox") throw new Error("只能检测内置 sing-box 线路");
    const routeFingerprint = aiRouteFingerprint(route);
    const cacheKey = `${routeId}:${routeFingerprint}`;
    const cached = aiRouteHealthCache.get(cacheKey);
    if (!options.force && cached && Date.now() - cached.cachedAt < AI_ROUTE_HEALTH_TTL_MS) {
      return cached.report;
    }
    const detected = await detectProxyEnvironment(route.port);
    const { expected, checks, ok } = evaluateAiRouteHealth(route, detected);
    const report = {
      ok,
      routeId,
      routeFingerprint,
      route: route.label,
      expected,
      checks,
      ...detected,
    };
    aiRouteHealthCache.set(cacheKey, { cachedAt: Date.now(), report });
    return report;
  }

  function getAiStoragePartitions() {
    const principal = backend.getPrincipalContext();
    const legacy = Object.keys(AI_WORKSPACE_POLICIES)
      .map((kind) => getAiPolicy(kind)?.partition)
      .filter(Boolean);
    const advanced = backend?.loadSettings()?.advancedAi;
    const isolated = Array.isArray(advanced?.environments)
      ? advanced.environments.flatMap((environment) => {
          try {
            return [
              partitionForAiEnvironment(
                environment?.kind,
                environment?.id,
                principal.principalId,
                principal.legacyPartitionOwnerId,
              ),
            ];
          } catch {
            return [];
          }
        })
      : [];
    return [...new Set([...legacy, ...isolated, ...configuredAiPartitions])];
  }

  async function verifyBrowserDestructiveAction(payload) {
    const password = String(payload?.password || "");
    const token = safeText(payload?.token);
    const requestedServerUrl = safeText(payload?.serverUrl).replace(/\/+$/, "");
    const savedServerUrl = safeText(backend.loadSettings()?.collab?.server_url).replace(/\/+$/, "");
    if (!password || !token || !requestedServerUrl || requestedServerUrl !== savedServerUrl) {
      throw new Error("请重新输入当前协作账号密码确认");
    }
    let verifyUrl;
    try {
      verifyUrl = new URL(`${requestedServerUrl}/api/account/verify-password`);
    } catch {
      throw new Error("协作服务器地址无效");
    }
    if (verifyUrl.protocol !== "http:" && verifyUrl.protocol !== "https:") {
      throw new Error("协作服务器地址无效");
    }
    const verifyResponse = await electronNet.fetch(verifyUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
    if (!verifyResponse.ok) {
      const message = safeText(await verifyResponse.text().catch(() => ""));
      if (verifyResponse.status === 404) {
        throw new Error("协作服务器版本过旧，暂不支持删除前密码复核");
      }
      throw new Error(message || `密码验证失败（${verifyResponse.status}）`);
    }
  }

  function workspaceKey(kind, tabId = "") {
    const targetKind = safeText(kind);
    return `${targetKind}:${safeText(tabId) || "default"}`;
  }

  function getWorkspace(kind, tabId = "") {
    const targetKind = safeText(kind);
    const targetTabId = safeText(tabId) || activeTabIdByKind[targetKind];
    if (!targetTabId) return null;
    return aiWorkspaces.get(workspaceKey(targetKind, targetTabId)) || null;
  }

  async function captureAiPageText(kind, tabId = "") {
    const workspace = getWorkspace(kind, tabId);
    const wc = workspace?.view?.webContents;
    if (!workspace || !wc || wc.isDestroyed()) throw new Error("当前网页尚未打开");

    const attachedHere = !wc.debugger.isAttached();
    if (attachedHere) wc.debugger.attach("1.3");
    try {
      await wc.debugger.sendCommand("Accessibility.enable");
      const snapshot = await wc.debugger.sendCommand("Accessibility.getFullAXTree");
      const chunks = [];
      let length = 0;
      let truncated = false;
      for (const node of Array.isArray(snapshot?.nodes) ? snapshot.nodes : []) {
        if (node?.ignored || node?.role?.value !== "StaticText") continue;
        const value = safeText(node?.name?.value).replace(/\s+/g, " ");
        if (!value || chunks[chunks.length - 1] === value) continue;
        if (length + value.length + 1 > 30000) {
          truncated = true;
          break;
        }
        chunks.push(value);
        length += value.length + 1;
      }
      return {
        title: safeText(workspace.title) || safeText(wc.getTitle()),
        url: safeText(wc.getURL()),
        text: chunks.join("\n"),
        truncated,
      };
    } finally {
      await wc.debugger.sendCommand("Accessibility.disable").catch(() => {});
      if (attachedHere && wc.debugger.isAttached()) wc.debugger.detach();
    }
  }

  function listWorkspaces(kind) {
    const order = tabOrderByKind[safeText(kind)] || [];
    return order.map((tabId) => getWorkspace(kind, tabId)).filter(Boolean);
  }

  function defaultTitleForKind(kind) {
    const k = safeText(kind);
    return k === "gpt" ? "ChatGPT" : k === "claude" ? "Claude" : "Gemini";
  }

  function normalizeAiTabTitle(rawTitle, fallbackTitle) {
    const title = safeText(rawTitle).replace(/\s+/g, " ").slice(0, GPT_TAB_TITLE_LIMIT);
    return title || fallbackTitle || "网页";
  }

  function configureAiSession(targetSession, policy) {
    if (!targetSession || !policy || configuredAiPartitions.has(policy.partition)) {
      return;
    }

    configuredAiPartitions.add(policy.partition);

    // 被动记录该会话访问过的所有主机名 (含子资源 / XHR / 字体 / 图片等),
    // 供「代理检测」按实际流量逐域判断是否走发送代理。仅装一次, 放行所有请求。
    const contactedHosts = aiContactedHostsByPartition.get(policy.partition) || new Set();
    aiContactedHostsByPartition.set(policy.partition, contactedHosts);
    try {
      // 纯观察, 非阻塞 (无 callback): 不会延迟/干扰请求, 对流式(SSE)聊天连接安全。
      targetSession.webRequest.onCompleted((details) => {
        try {
          const host = new URL(details.url).hostname;
          // 仅记录真实网络主机 (跳过 devtools/data/blob 等), 上限防止无界增长。
          if (host && contactedHosts.size < 800) contactedHosts.add(host);
        } catch {}
      });
    } catch {}

    // 把客户端提示(Sec-CH-UA)里的 "Electron" 品牌洗成真实 Chrome 品牌:
    // Electron 默认会在 Sec-CH-UA 暴露 "Electron";v="31", 而 Cloudflare Turnstile(Claude 用)会读取
    // 这些品牌判断是不是真浏览器 -> 暴露 Electron 就被当成嵌入式/非标准浏览器, 一直卡验证。
    // 这里去掉 Electron 品牌并补上 "Google Chrome"(版本取引擎真实的 Chromium 版本, 保持一致)。
    try {
      targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        try {
          const headers = details.requestHeaders || {};
          for (const key of Object.keys(headers)) {
            if (/^sec-ch-ua$/i.test(key) || /^sec-ch-ua-full-version-list$/i.test(key)) {
              headers[key] = chromeifyClientHintBrands(headers[key]);
            }
          }
          callback({ requestHeaders: headers });
        } catch {
          callback({});
        }
      });
    } catch {}

    const permissionAllowed = (permission, requestingUrl) => {
      if (permission === "geolocation") {
        const environment = runtimeEnvironment(backend?.loadSettings()?.browserPrivacy);
        if (!environment.geolocationEnabled) return false;
        try {
          return new URL(requestingUrl).hostname === policy.primaryHost;
        } catch {
          return false;
        }
      }
      return (
        AI_ALLOWED_PERMISSIONS.has(permission) &&
        isAllowedUrlForHosts(requestingUrl, policy.allowedHosts)
      );
    };

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = safeText(details?.requestingUrl || webContents?.getURL?.());
      callback(permissionAllowed(permission, requestingUrl));
    });

    if (typeof targetSession.setPermissionCheckHandler === "function") {
      targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        return permissionAllowed(permission, requestingOrigin);
      });
    }
  }

  async function applyWorkspacePrivacy(workspace) {
    const targetSession = session.fromPartition(workspace.policy.partition);
    const privacySettings = normalizeBrowserPrivacySettings(
      backend?.loadSettings()?.browserPrivacy,
    );
    workspace.environmentBootstrapping = true;
    try {
      const applied = await applyEnvironmentToWebContents({
        webContents: workspace.view.webContents,
        targetSession,
        privacySettings,
        defaultUserAgent: workspace.userAgent || app.userAgentFallback,
        systemLanguages: app.getPreferredSystemLanguages?.() || [app.getLocale?.() || "en-US"],
        kind: workspace.kind,
      });
      workspace.appliedUserAgent =
        applied.userAgent || workspace.userAgent || app.userAgentFallback;
      return applied;
    } finally {
      workspace.environmentBootstrapping = false;
    }
  }

  async function captureWorkspaceFingerprint(kind, tabId = "", options = {}) {
    const targetKind = safeText(kind);
    if (!isAiKind(targetKind)) throw new Error("不支持的 AI 服务");
    const principalContext = backend.getPrincipalContext();
    const workspace =
      getWorkspace(targetKind, safeText(tabId)) ||
      getWorkspace(targetKind, activeTabIdByKind[targetKind]);
    if (!workspace || workspace.view.webContents.isDestroyed()) {
      throw new Error("请先打开该服务的网页，再采集可见信息");
    }

    const wc = workspace.view.webContents;
    const currentUrl = safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl;
    if (!isWorkspaceUrlAllowed(workspace, currentUrl)) {
      throw new Error("网页仍在初始化，请等待页面打开后再采集");
    }
    const targetSession = session.fromPartition(workspace.policy.partition);
    const pagePromise = collectPageFingerprint(wc);
    const fingerprintProxyPort = Number(
      workspace.proxyMode === "singbox"
        ? workspace.proxyPort
        : workspace.proxyMode === "sender"
          ? workspace.proxyPort || backend?.activeSocksPort
          : 0,
    );
    const networkPromise = (() => {
      if (
        !Number.isInteger(fingerprintProxyPort) ||
        fingerprintProxyPort < 1 ||
        fingerprintProxyPort > 65535
      ) {
        return Promise.resolve(null);
      }
      return detectProxyEnvironment(fingerprintProxyPort).catch((error) => ({
        error: safeText(error?.message || error),
      }));
    })();
    const proxyPromise = targetSession
      .resolveProxy(currentUrl)
      .then((value) => safeText(value))
      .catch(() => "");
    const [page, network, sessionProxy] = await Promise.all([
      pagePromise,
      networkPromise,
      proxyPromise,
    ]);
    assertPrincipalUnchanged(principalContext);

    const settings = backend.loadSettings();
    const privacy = normalizeBrowserPrivacySettings(settings.browserPrivacy);
    const localProfile = privacy.localProfiles[targetKind];
    const snapshot = {
      schemaVersion: 1,
      kind: targetKind,
      capturedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      hostPlatform: process.platform,
      page,
      network,
      sessionProxy,
      sessionProxied: resolvedProxyMatchesRoute(sessionProxy, {
        host: "127.0.0.1",
        port: fingerprintProxyPort,
      }),
      webRtcPolicy: wc.getWebRTCIPHandlingPolicy(),
      profile: {
        preset: privacy.fingerprint.preset,
        enabled: privacy.fingerprint.enabled,
        localIdHash: snapshotDigest({ profile: localProfile }).slice(0, 12),
        rebuiltAt: localProfile.rebuiltAt,
      },
    };
    snapshot.digest = snapshotDigest(snapshot);

    if (options.save !== false) {
      assertPrincipalUnchanged(principalContext);
      privacy.audit.current[targetKind] = snapshot;
      settings.browserPrivacy = privacy;
      backend.saveSettingsForPrincipal(settings, principalContext.principalId);
    }
    return snapshot;
  }

  async function rememberBeforeClear(kind, principalContext) {
    const targetKind = safeText(kind);
    const settings = backend.loadSettings();
    const privacy = normalizeBrowserPrivacySettings(settings.browserPrivacy);
    let snapshot = null;
    try {
      snapshot = await captureWorkspaceFingerprint(targetKind, "", { save: false });
    } catch {
      // 页面可能未打开或仍在导航；此时回退到最后一次已保存的当前快照。
    }
    assertPrincipalUnchanged(principalContext);
    privacy.audit.beforeClear[targetKind] = snapshot || privacy.audit.current[targetKind] || null;
    privacy.audit.current[targetKind] = null;
    settings.browserPrivacy = privacy;
    backend.saveSettingsForPrincipal(settings, principalContext.principalId);
    return privacy.audit.beforeClear[targetKind];
  }

  function isWorkspaceDocumentAllowed(workspace) {
    const currentUrl = safeText(workspace?.view?.webContents?.getURL?.());
    return Boolean(currentUrl && isWorkspaceUrlAllowed(workspace, currentUrl));
  }

  function isAutomaticSelectionTranslationAllowed(workspace) {
    const currentUrl = safeText(workspace?.view?.webContents?.getURL?.());
    return Boolean(
      currentUrl && isAllowedUrlForHosts(currentUrl, [safeText(workspace?.policy?.primaryHost)]),
    );
  }

  function getAiStatePayload(workspace) {
    const wc = workspace.view.webContents;
    const currentUrl = safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl;
    if (currentUrl && isWorkspaceUrlAllowed(workspace, currentUrl)) {
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
      allowExternalBrowsing: Boolean(workspace.allowExternalBrowsing),
      environmentId: safeText(workspace.environmentId),
      proxyMode: safeText(workspace.proxyMode),
      proxyLabel: safeText(workspace.proxyLabel),
      navigationGeneration: Number(workspace.composerContextGeneration || 0),
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

  function listTabsPayload(kind) {
    const targetKind = safeText(kind);
    return {
      tabs: listWorkspaces(targetKind).map((workspace) => ({
        ...getAiStatePayload(workspace),
        id: safeText(workspace.id),
      })),
      activeTabId: activeTabIdByKind[targetKind] || "",
    };
  }

  function emitTabsChanged(kind) {
    return emitAiEvent(safeText(kind), "tabs-changed", listTabsPayload(kind));
  }

  function syncActiveWorkspace(kind) {
    const targetKind = safeText(kind);
    const activeWorkspace = getWorkspace(targetKind, activeTabIdByKind[targetKind]);

    for (const workspace of listWorkspaces(targetKind)) {
      if (targetKind !== activeAiKind || workspace.id !== activeTabIdByKind[targetKind]) {
        detachWorkspaceView(workspace);
      }
    }

    if (!activeWorkspace || targetKind !== activeAiKind) {
      return false;
    }

    return syncAiBounds(activeWorkspace, hostStateByKind[targetKind]);
  }

  function createTabWorkspace(kind, options = {}) {
    const targetKind = safeText(kind);
    const workspace = getOrCreateAiWorkspace(targetKind, safeText(options.tabId), {
      title: safeText(options.title),
      lastUrl: safeText(options.lastUrl),
      allowExternalBrowsing: Boolean(options.allowExternalBrowsing),
      environmentId: safeText(options.environmentId),
      environmentGeneration: Number(options.environmentGeneration || 0),
    });

    const order = tabOrderByKind[targetKind];
    if (order && !order.includes(workspace.id)) {
      order.push(workspace.id);
    }

    if (!activeTabIdByKind[targetKind]) {
      activeTabIdByKind[targetKind] = workspace.id;
    }

    emitTabsChanged(targetKind);
    return workspace;
  }

  function closeTabWorkspace(kind, tabId) {
    const targetKind = safeText(kind);
    const targetId = safeText(tabId);
    const workspace = getWorkspace(targetKind, targetId);
    if (!workspace) {
      const active = getWorkspace(targetKind, activeTabIdByKind[targetKind]);
      return {
        ...listTabsPayload(targetKind),
        activeState: active ? getAiStatePayload(active) : null,
      };
    }

    invalidateComposerWorkspace(workspace, "workspace-closed");
    detachWorkspaceView(workspace);
    aiWorkspaces.delete(workspaceKey(targetKind, targetId));

    const order = tabOrderByKind[targetKind] || [];
    const orderIndex = order.indexOf(targetId);
    if (orderIndex >= 0) {
      order.splice(orderIndex, 1);
    }

    try {
      if (!workspace.view.webContents.isDestroyed()) {
        workspace.view.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {}

    if (activeTabIdByKind[targetKind] === targetId) {
      activeTabIdByKind[targetKind] = order[Math.max(0, orderIndex - 1)] || order[0] || "";
    }

    syncActiveWorkspace(targetKind);
    const activeWorkspace = getWorkspace(targetKind, activeTabIdByKind[targetKind]);
    emitTabsChanged(targetKind);
    return {
      ...listTabsPayload(targetKind),
      activeState: activeWorkspace ? getAiStatePayload(activeWorkspace) : null,
    };
  }

  async function closeWorkspacesForKind(kind) {
    const targetKind = safeText(kind);
    const ids = [...(tabOrderByKind[targetKind] || [])];
    const webContentsList = ids.map(
      (tabId) => getWorkspace(targetKind, tabId)?.view?.webContents || null,
    );
    const destroyed = webContentsList.map((webContents) => {
      if (!webContents || webContents.isDestroyed()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(webContents.isDestroyed()), 3_000);
        webContents.once("destroyed", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    });
    for (const tabId of ids) {
      closeTabWorkspace(targetKind, tabId);
    }
    const closed = await Promise.all(destroyed);
    if (closed.some((value) => !value)) {
      throw new Error("目标网页标签未能安全关闭，请重启客户端后再清除");
    }
    tabOrderByKind[targetKind] = [];
    activeTabIdByKind[targetKind] = "";
    hostStateByKind[targetKind] = { visible: false, bounds: null };
  }

  function syncAiBounds(workspace, options = {}) {
    const visible = Boolean(options.visible);
    const bounds = options.bounds || null;

    workspace.visible = visible;

    if (!visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      detachWorkspaceView(workspace);
      return false;
    }

    const shellZoomFactor = mainWindow?.webContents?.getZoomFactor?.() || 1;
    attachWorkspaceView(workspace);
    workspace.view.setBounds(scaleAiHostBounds(bounds, shellZoomFactor));
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

  async function loadAiWorkspaceUrl(workspace, rawUrl) {
    const normalizedUrl = normalizeHttpUrl(rawUrl);
    if (!normalizedUrl || !isWorkspaceUrlAllowed(workspace, normalizedUrl)) {
      throw new Error("不允许加载该页面");
    }
    const targetUrl = normalizeAiWorkspaceUrl(workspace, normalizedUrl);
    workspace.managedNavigationCount = (workspace.managedNavigationCount || 0) + 1;
    try {
      return await loadUrlWithTransientRetry(() =>
        workspace.view.webContents
          .loadURL(targetUrl, htmlNavigationOptions(workspace))
          .catch((err) => {
            // ChatGPT 登录重定向链常在途中止(ERR_ABORTED / -3), 页面实际已正常加载,
            // 属良性, 不应作为加载失败上报。仅吞此类中止, 其余错误照常抛出。
            const message = String((err && (err.message || err)) || "");
            const code = err && (err.code || err.errno);
            if (code === -3 || code === "ERR_ABORTED" || /ERR_ABORTED|\(-3\)/i.test(message)) {
              return;
            }
            throw err;
          }),
      );
    } finally {
      workspace.managedNavigationCount = Math.max(0, (workspace.managedNavigationCount || 1) - 1);
      workspace.suppressLoadErrorsUntil = Date.now() + 250;
    }
  }

  function isTrustedComposerConsoleEvent(workspace, details, legacySourceId) {
    const wc = workspace?.view?.webContents;
    const currentUrl = safeText(wc?.getURL?.());
    if (
      !wc ||
      wc.isDestroyed() ||
      getWorkspace(workspace.kind, workspace.id) !== workspace ||
      !currentUrl ||
      !isWorkspaceUrlAllowed(workspace, currentUrl)
    ) {
      return false;
    }
    if (details && "frame" in details) {
      if (!details.frame || details.frame !== wc.mainFrame) return false;
    }
    const sourceId = safeText(details?.sourceId || legacySourceId);
    if (sourceId) {
      try {
        const sourceUrl = new URL(sourceId);
        const documentUrl = new URL(currentUrl);
        if (
          !["http:", "https:"].includes(sourceUrl.protocol) ||
          !isWorkspaceUrlAllowed(workspace, sourceUrl.toString()) ||
          sourceUrl.origin !== documentUrl.origin
        ) {
          return false;
        }
      } catch {
        // Electron may report an internal VM label for isolated-world code. In that
        // case the main-frame identity, current URL and unguessable token remain authoritative.
      }
    }
    return true;
  }

  function bindAiWorkspaceEvents(workspace) {
    const wc = workspace.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (isWorkspaceUrlAllowed(workspace, url)) {
        const targetUrl = normalizeAiWorkspaceUrl(workspace, url);
        workspace.loading = true;
        workspace.initialized = true;
        workspace.lastUrl = targetUrl;
        emitAiState(workspace, "did-start-loading", { url: targetUrl });
        void loadAiWorkspaceUrl(workspace, targetUrl).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url: targetUrl,
            errorDescription: err.message || String(err),
          });
        });
        return { action: "deny" };
      }

      handleBlockedAiNavigation(workspace, url);
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      if (isWorkspaceUrlAllowed(workspace, url)) {
        const targetUrl = normalizeAiWorkspaceUrl(workspace, url);
        if (targetUrl === url) return;
        event.preventDefault();
        workspace.loading = true;
        workspace.initialized = true;
        workspace.lastUrl = targetUrl;
        emitAiState(workspace, "did-start-loading", { url: targetUrl });
        void loadAiWorkspaceUrl(workspace, targetUrl).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url: targetUrl,
            errorDescription: err.message || String(err),
          });
        });
        return;
      }
      event.preventDefault();
      handleBlockedAiNavigation(workspace, url);
    });

    wc.on("will-redirect", (event, url) => {
      if (isWorkspaceUrlAllowed(workspace, url)) {
        const targetUrl = normalizeAiWorkspaceUrl(workspace, url);
        if (targetUrl === url) return;
        event.preventDefault();
        workspace.loading = true;
        workspace.initialized = true;
        workspace.lastUrl = targetUrl;
        emitAiState(workspace, "did-start-loading", { url: targetUrl });
        void loadAiWorkspaceUrl(workspace, targetUrl).catch((err) => {
          workspace.loading = false;
          emitAiEvent(workspace.kind, "did-fail-load", {
            ...getAiStatePayload(workspace),
            url: targetUrl,
            errorDescription: err.message || String(err),
          });
        });
        return;
      }
      event.preventDefault();
      handleBlockedAiNavigation(workspace, url);
    });

    wc.on("did-start-navigation", (details) => {
      if (!details?.isMainFrame) return;
      invalidateComposerWorkspace(workspace, "navigation");
      emitAiState(workspace, "did-start-navigation");
    });

    wc.on("did-start-loading", () => {
      if (workspace.environmentBootstrapping || !isWorkspaceDocumentAllowed(workspace)) return;
      workspace.loading = true;
      emitAiState(workspace, "did-start-loading");
    });

    wc.on("dom-ready", () => {
      if (workspace.environmentBootstrapping || !isWorkspaceDocumentAllowed(workspace)) return;
      void syncComposerClickGuard(workspace).catch(() => {});
      emitAiState(workspace, "dom-ready");
    });

    wc.on("did-stop-loading", () => {
      if (workspace.environmentBootstrapping || !isWorkspaceDocumentAllowed(workspace)) return;
      workspace.loading = false;
      workspace.initialized = true;
      emitAiState(workspace, "did-stop-loading");
    });

    wc.on("did-finish-load", () => {
      if (workspace.environmentBootstrapping || !isWorkspaceDocumentAllowed(workspace)) return;
      if (workspace.kind !== "gpt") return;
      void detectRawChatGptDocument(wc)
        .then((isRawDocument) => {
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
          // 回退到 4.2.0: 仅重载, 不 clearCache (清缓存会一并清掉 Cloudflare 验证中间态)。
          void loadAiWorkspaceUrl(workspace, workspace.policy.homeUrl).catch((err) => {
            workspace.loading = false;
            emitAiEvent(workspace.kind, "did-fail-load", {
              ...getAiStatePayload(workspace),
              url: workspace.policy.homeUrl,
              errorDescription: err.message || String(err),
            });
          });
        })
        .catch(() => {});
    });

    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (Number(errorCode) === -3) return;
      if (
        workspace.environmentBootstrapping ||
        workspace.managedNavigationCount > 0 ||
        Date.now() < (workspace.suppressLoadErrorsUntil || 0)
      ) {
        return;
      }
      workspace.loading = false;
      emitAiEvent(workspace.kind, "did-fail-load", {
        ...getAiStatePayload(workspace),
        url: safeText(validatedURL) || workspace.lastUrl,
        errorCode,
        errorDescription: errorDescription || "未知错误",
      });
    });

    wc.on("did-navigate", (_event, url) => {
      if (workspace.environmentBootstrapping || !isWorkspaceUrlAllowed(workspace, url)) {
        return;
      }
      if (isWorkspaceUrlAllowed(workspace, url)) {
        workspace.lastUrl = normalizeAiWorkspaceUrl(workspace, url);
      }
      workspace.initialized = true;
      void syncComposerClickGuard(workspace).catch(() => {});
      emitAiState(workspace, "did-navigate", { url });
    });

    wc.on("did-navigate-in-page", (_event, url) => {
      if (workspace.environmentBootstrapping || !isWorkspaceUrlAllowed(workspace, url)) {
        return;
      }
      // Some same-document navigations do not emit did-start-navigation. The isolated-world
      // listener has already invalidated its nonce, so clear the main-process mirror before
      // installing the identity for the new SPA route.
      invalidateComposerWorkspace(workspace, "navigation");
      if (isWorkspaceUrlAllowed(workspace, url)) {
        workspace.lastUrl = normalizeAiWorkspaceUrl(workspace, url);
      }
      void syncComposerClickGuard(workspace).catch(() => {});
      emitAiState(workspace, "did-navigate-in-page", { url });
    });

    wc.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (workspace.environmentBootstrapping || !isWorkspaceDocumentAllowed(workspace)) return;
      workspace.title = normalizeAiTabTitle(title, workspace.defaultTitle);
      emitTabsChanged(workspace.kind);
    });

    wc.on("console-message", (details, _level, legacyMessage, _line, legacySourceId) => {
      const value = String(details?.message ?? legacyMessage ?? "");
      const selection = parseSelectionTranslationConsoleMessage(
        value,
        workspace.selectionTranslationToken,
      );
      if (selection.kind !== "other") {
        if (
          selection.kind !== "valid" ||
          !isComposerEligible() ||
          !isTrustedComposerConsoleEvent(workspace, details, legacySourceId)
        ) {
          return;
        }
        try {
          const context = captureComposerContext(workspace);
          const translation = backend?.loadSettings()?.translation || {};
          if (
            translation.autoTranslateSelection !== true ||
            selection.documentNonce !== workspace.composerDocumentNonce ||
            selection.documentUrl !== workspace.composerDocumentUrl ||
            selection.navigationGeneration !== context.composerContextGeneration ||
            selection.principalId !== context.principalId ||
            selection.principalGeneration !== Number(context.principalContext?.generation || 0) ||
            selection.environmentId !== context.environmentId ||
            selection.environmentGeneration !== context.environmentGeneration ||
            !workspace.selectionTranslationRateLimiter.accept(
              selection.text,
              selection.documentNonce,
            )
          ) {
            return;
          }
          emitSelectionTranslation(context, selection.text);
        } catch {
          return;
        }
        return;
      }
      const parsed = parseComposerGuardConsoleMessage(value, workspace.composerGuardToken);
      if (parsed.kind !== "other") {
        if (
          !isComposerEligible() ||
          !isTrustedComposerConsoleEvent(workspace, details, legacySourceId)
        ) {
          return;
        }
        if (parsed.kind === "too-long") {
          emitAiEvent(workspace.kind, "composer-send-guard-failed", {
            tabId: workspace.id,
            message: "待发送内容过长，未执行发送",
          });
          return;
        }
        if (parsed.kind !== "valid") return;
        try {
          const context = captureComposerContext(workspace);
          const translation = backend?.loadSettings()?.translation || {};
          const targetLanguage = safeText(translation.siteLanguage) || "en";
          if (
            translation.confirmNonTargetSend !== false &&
            hasClearlyNonTargetLanguage(parsed.text, targetLanguage)
          ) {
            queueComposerConfirmation(context, parsed.text, targetLanguage, { findAny: true });
          }
        } catch {}
        return;
      }
      emitAiEvent(workspace.kind, "console-message", { message: value });
    });

    wc.on("render-process-gone", () => invalidateComposerWorkspace(workspace, "renderer-gone"));
    wc.on("destroyed", () => invalidateComposerWorkspace(workspace, "workspace-destroyed"));

    // F11: 嵌入的 AI 网页获得焦点时, 渲染层收不到键盘事件; 在此拦截 F11 切换窗口全屏。
    // 另: Ctrl/Cmd + 加/减/0 只缩放当前内嵌网页，不允许影响 ShareGPT 外壳布局。
    wc.on("before-input-event", (event, input) => {
      if (
        input.type === "keyDown" &&
        input.key === "F11" &&
        !input.alt &&
        !input.control &&
        !input.meta &&
        !input.shift
      ) {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
        return;
      }
      if (guardComposerEnter(workspace, event, input)) return;
      const zoomAction = aiZoomAction(input);
      if (zoomAction) {
        event.preventDefault();
        adjustAppZoom(zoomAction);
      }
    });

    // Ctrl/Cmd + 鼠标滚轮会先触发 Chromium 默认缩放；必须 preventDefault 后再应用一次，
    // 否则同一次操作会缩放两级，并可能让原生视图与 ShareGPT 外壳边界失配。
    wc.on("zoom-changed", (event, zoomDirection) => {
      event.preventDefault();
      adjustAppZoom(zoomDirection === "in" ? "in" : "out");
    });

    // 浏览器式右键菜单: 内嵌 AI 网页(WebContentsView)默认没有上下文菜单,
    // 这里按 Chrome 习惯按情景拼装(链接/图片/选区/可编辑框/拼写建议 + 导航 + 检查元素)。
    wc.on("context-menu", (_event, params) => {
      if (wc.isDestroyed()) return;
      popupAiContextMenu(workspace, params);
    });
  }

  // 依据右键命中的元素拼装上下文菜单项 (params 见 Electron 'context-menu' 事件):
  // 链接 -> 复制/外部打开; 图片 -> 复制图片/复制地址; 选区 -> 复制 + 外部搜索;
  // 可编辑框 -> 剪切/复制/粘贴/全选(按 editFlags 启停) + 拼写建议; 末尾恒有 重新加载/检查元素。
  function popupAiContextMenu(workspace, params) {
    const wc = workspace.view.webContents;
    const template = [];
    const push = (item) => template.push(item);
    const sep = () => {
      if (template.length && template[template.length - 1].type !== "separator") {
        template.push({ type: "separator" });
      }
    };
    const flags = params.editFlags || {};

    // 拼写建议 (可编辑框内拼错的词): 置顶, 与浏览器一致。
    if (params.isEditable && params.misspelledWord) {
      const suggestions = Array.isArray(params.dictionarySuggestions)
        ? params.dictionarySuggestions.slice(0, 5)
        : [];
      for (const word of suggestions) {
        push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (!suggestions.length) {
        push({ label: "无拼写建议", enabled: false });
      }
      sep();
    }

    // 导航: 与浏览器一致, 后退/前进始终展示(不可用时置灰), 始终可重新加载。
    push({ label: "后退", enabled: wc.canGoBack(), click: () => wc.goBack() });
    push({ label: "前进", enabled: wc.canGoForward(), click: () => wc.goForward() });
    push({ label: "重新加载", click: () => wc.reload() });
    sep();

    // 链接。
    if (params.linkURL) {
      push({
        label: "在浏览器中打开链接",
        click: () => void openExternalUrl(params.linkURL).catch(() => {}),
      });
      push({
        label: "复制链接地址",
        click: () => clipboard.writeText(params.linkURL),
      });
      sep();
    }

    // 图片。
    if (params.mediaType === "image" && params.srcURL) {
      push({ label: "复制图片", click: () => wc.copyImageAt(params.x, params.y) });
      push({
        label: "复制图片地址",
        click: () => clipboard.writeText(params.srcURL),
      });
      sep();
    }

    // 编辑动作: 可编辑框给全套, 纯选区只给「复制」。
    if (params.isEditable) {
      push({ label: "剪切", enabled: !!flags.canCut, click: () => wc.cut() });
      push({ label: "复制", enabled: !!flags.canCopy, click: () => wc.copy() });
      push({ label: "粘贴", enabled: !!flags.canPaste, click: () => wc.paste() });
      push({
        label: "全选",
        enabled: flags.canSelectAll !== false,
        click: () => wc.selectAll(),
      });
      sep();
    } else if (params.selectionText && params.selectionText.trim()) {
      const text = params.selectionText.trim();
      let selectionContext = null;
      try {
        selectionContext = captureComposerContext(workspace);
      } catch {
        selectionContext = null;
      }
      push({ label: "复制", click: () => wc.copy() });
      push({
        label: "翻译选中文字",
        enabled: Boolean(selectionContext),
        click: () => {
          if (!selectionContext) return;
          try {
            emitSelectionTranslation(selectionContext, text);
          } catch {
            return;
          }
        },
      });
      push({
        label: "在浏览器中搜索选中文字",
        click: () =>
          void openExternalUrl("https://www.google.com/search?q=" + encodeURIComponent(text)).catch(
            () => {},
          ),
      });
      sep();
    }

    // 末尾: 检查元素 (开发/排错用)。
    push({
      label: "检查元素",
      click: () => {
        wc.inspectElement(params.x, params.y);
        if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus();
      },
    });

    // 去掉可能的首尾分隔符后弹出。
    while (template.length && template[0].type === "separator") template.shift();
    while (template.length && template[template.length - 1].type === "separator") template.pop();
    if (!template.length) return;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow ?? undefined });
  }

  function getOrCreateAiWorkspace(kind, tabId = "", options = {}) {
    const targetKind = safeText(kind);
    const targetTabId = safeText(tabId) || `${targetKind}-${++aiTabCounter}`;
    const existing = getWorkspace(targetKind, targetTabId);
    if (existing) {
      const requestedEnvironmentId = normalizeAiEnvironmentId(options.environmentId);
      if (safeText(existing.environmentId) !== requestedEnvironmentId) {
        throw new Error("目标标签不属于当前 AI 环境");
      }
      const requestedGeneration = Number(options.environmentGeneration || 0);
      if (
        !Number.isInteger(requestedGeneration) ||
        requestedGeneration < 1 ||
        Number(existing.environmentGeneration || 0) !== requestedGeneration
      ) {
        throw new Error("AI 环境操作已失效");
      }
      return existing;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("主窗口尚未就绪");
    }

    const environmentId = normalizeAiEnvironmentId(options.environmentId);
    const environmentGeneration = Number(options.environmentGeneration || 0);
    if (!Number.isInteger(environmentGeneration) || environmentGeneration < 1) {
      throw new Error("AI 环境操作已失效");
    }
    const policy = getAiPolicy(targetKind, environmentId);
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
        // 关闭后台限流 + 初始隐藏也绘制: 内嵌视图被切走/判遮挡时也不限流计时器、保持渲染,
        // 保证 Cloudflare 人机验证(Turnstile, 依赖 timer/rAF/可见性)能正常跑完, 不卡在验证页。
        backgroundThrottling: false,
        // paintWhenInitiallyHidden 是有效的运行时 webPreferences 选项(默认 true), 但 WebContentsView 的类型未涵盖。
        // @ts-ignore
        paintWhenInitiallyHidden: true,
      },
    });

    const workspace = {
      id: targetTabId,
      kind: targetKind,
      environmentId,
      environmentGeneration: Number(options.environmentGeneration || 0),
      policy,
      view,
      attached: false,
      initialized: false,
      loading: false,
      visible: false,
      lastUrl: safeText(options.lastUrl) || policy.homeUrl,
      allowExternalBrowsing: targetKind === "claude" && Boolean(options.allowExternalBrowsing),
      defaultTitle: normalizeAiTabTitle(safeText(options.title), defaultTitleForKind(targetKind)),
      title: normalizeAiTabTitle(safeText(options.title), defaultTitleForKind(targetKind)),
      proxySignature: "",
      // 阻断预检属于“线路绑定”生命周期，不属于“面板显示”生命周期。
      // 同一 view + 同一线路重新显示时复用该证明，换线路会因 fingerprint 改变而重新预检。
      routeHealthFingerprint: "",
      proxyMode: "sender",
      proxyLabel: "当前统一代理",
      proxyPort: null,
      userAgent: "",
      appliedUserAgent: "",
      rawDocumentRecoveryAttempted: false,
      environmentBootstrapping: false,
      managedNavigationCount: 0,
      suppressLoadErrorsUntil: 0,
      composerContextGeneration: 1,
      composerGuardToken: "",
      selectionTranslationToken: "",
      composerDocumentNonce: "",
      composerDocumentUrl: "",
      composerGuardInstalled: false,
      composerGuardBypass: createOneShotComposerBypass(),
      selectionTranslationRateLimiter: createSelectionTranslationRateLimiter(),
    };

    Reflect.defineProperty(view.webContents, "__shareGptAiWorkspace", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        kind: targetKind,
        environmentId,
        partition: policy.partition,
        isCurrent: () =>
          workspace.attached &&
          activeAiKind === targetKind &&
          activeTabIdByKind[targetKind] === workspace.id,
      }),
    });

    bindAiWorkspaceEvents(workspace);
    view.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel());
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    view.setVisible(false);
    aiWorkspaces.set(workspaceKey(targetKind, workspace.id), workspace);
    return workspace;
  }

  function disposeAiWorkspaces() {
    for (const workspace of aiWorkspaces.values()) {
      invalidateComposerWorkspace(workspace, "workspace-disposed");
      detachWorkspaceView(workspace);

      try {
        if (!workspace.view.webContents.isDestroyed()) {
          workspace.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {}
    }

    aiWorkspaces.clear();
    tabOrderByKind.gpt.length = 0;
    tabOrderByKind.gemini.length = 0;
    tabOrderByKind.claude.length = 0;
    activeTabIdByKind.gpt = "";
    activeTabIdByKind.gemini = "";
    activeTabIdByKind.claude = "";
    activeAiKind = "";
    configuredAiPartitions.clear();
    for (const pending of pendingComposerSends.clear()) {
      emitComposerSendInvalidated(pending, "workspace-disposed");
    }
  }

  async function flushAndDisposeAiWorkspaces() {
    if (backend) await flushAiSessionStorage(getAiStoragePartitions()).catch(() => {});
    disposeAiWorkspaces();
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

  function loadMainRenderer(win) {
    // UI 加载策略:
    // - 开发热更新: SHAREGPT_UI_NEXT=1 + SHAREGPT_UI_DEV_URL 指向 Vite dev server。
    // - 默认: 加载重构后的新渲染层构建产物 renderer-next/dist (新 UI 为产品默认)。
    // - 回退: SHAREGPT_UI_LEGACY=1, 或找不到新版产物时, 加载既有(旧)渲染层。
    const devUrl = process.env.SHAREGPT_UI_DEV_URL;
    if (process.env.SHAREGPT_UI_NEXT === "1" && devUrl && !app.isPackaged) {
      win.loadURL(devUrl);
      return;
    }
    const builtNext = path.join(__dirname, "../renderer-next/dist/index.html");
    if (process.env.SHAREGPT_UI_LEGACY !== "1" && fs.existsSync(builtNext)) {
      win.loadFile(builtNext);
      return;
    }
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // 个人资料独立窗口加载策略, 与 loadMainRenderer 一致: 默认新版(renderer-next/dist/profile.html),
  // dev 走 Vite server 的 /profile.html, SHAREGPT_UI_LEGACY=1 或缺产物时回退旧版。
  function loadProfileRenderer(win, query) {
    const devUrl = process.env.SHAREGPT_UI_DEV_URL;
    if (process.env.SHAREGPT_UI_NEXT === "1" && devUrl && !app.isPackaged) {
      const qs = new URLSearchParams(query || {}).toString();
      win.loadURL(`${devUrl.replace(/\/$/, "")}/profile.html${qs ? `?${qs}` : ""}`);
      return;
    }
    const builtNext = path.join(__dirname, "../renderer-next/dist/profile.html");
    if (process.env.SHAREGPT_UI_LEGACY !== "1" && fs.existsSync(builtNext)) {
      win.loadFile(builtNext, { query });
      return;
    }
    win.loadFile(path.join(__dirname, "../renderer/profile.html"), { query });
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
        sandbox: true,
      },
    });

    attachWindowGuards(mainWindow);
    // 主窗口获得焦点时也把缩放快捷键转发给当前 AI 网页。否则 Chromium 会缩放
    // ShareGPT 外壳，导致 DOM 坐标与原生 WebContentsView 的 DIP 边界不再一致。
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const zoomAction = aiZoomAction(input);
      if (zoomAction) {
        event.preventDefault();
        adjustAppZoom(zoomAction);
        return;
      }
      if (
        input.type === "keyDown" &&
        input.key === "F11" &&
        !input.alt &&
        !input.control &&
        !input.meta &&
        !input.shift
      ) {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
      }
    });
    mainWindow.webContents.on("zoom-changed", (event, zoomDirection) => {
      event.preventDefault();
      adjustAppZoom(zoomDirection === "in" ? "in" : "out");
    });
    mainWindow.webContents.setZoomLevel(0);
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(true);
    }
    mainWindow.removeMenu();
    loadMainRenderer(mainWindow);
    mainWindow.on("closed", () => {
      for (const controller of translationRequests.values()) controller.abort();
      translationRequests.clear();
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
    const rawHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) =>
      rawHandle(channel, (event, ...args) => {
        const fromMainWindow =
          mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
        const fromProfileWindow =
          profileWindow &&
          !profileWindow.isDestroyed() &&
          event.sender === profileWindow.webContents;
        if (!fromMainWindow && !fromProfileWindow) {
          throw new Error(`拒绝来自非应用窗口的 IPC: ${channel}`);
        }
        if (fromProfileWindow && !PROFILE_IPC_CHANNELS.has(channel)) {
          throw new Error(`个人资料窗口无权调用 IPC: ${channel}`);
        }
        return listener(event, ...args);
      });
    // 让内嵌网页(ChatGPT/Gemini, 设为"跟随系统")的明暗跟随 app UI 主题。
    // nativeTheme.themeSource 影响所有 webContents 的 prefers-color-scheme;
    // 渲染层自身用 .dark class 控制, 不受此影响。
    ipcMain.handle("app:set-theme-source", (_event, source) => {
      nativeTheme.themeSource =
        source === "dark" ? "dark" : source === "light" ? "light" : "system";
      return true;
    });
    ipcMain.handle("settings:load", (_event, payload) => {
      if (payload?.expectedPrincipalId) {
        backend.assertSettingsPrincipal(payload.expectedPrincipalId);
      }
      return backend.loadSettings();
    });
    ipcMain.handle("settings:principal-activate", async (_event, payload) => {
      stopAuthorizedSender();
      clearAiAuthorization("principal-activating");
      await flushAndDisposeAiWorkspaces();
      aiEnvironmentGuard.invalidateAll();
      for (const controller of translationRequests.values()) controller.abort();
      translationRequests.clear();
      return runSettingsPrincipalTransition(backend.notesAi, () =>
        backend.activatePrincipal(payload?.serverUrl, payload?.username),
      );
    });
    ipcMain.handle("settings:principal-clear", async () => {
      stopAuthorizedSender();
      clearAiAuthorization("principal-clearing");
      await flushAndDisposeAiWorkspaces();
      aiEnvironmentGuard.invalidateAll();
      for (const controller of translationRequests.values()) controller.abort();
      translationRequests.clear();
      return runSettingsPrincipalTransition(backend.notesAi, () => {
        const settings = backend.clearPrincipal();
        return { principalId: backend.getPrincipalContext().principalId, settings };
      });
    });
    ipcMain.handle("settings:principal-context", () => ({
      principalId: backend.getPrincipalContext().principalId,
    }));
    ipcMain.handle("ai:set-composer-eligibility", async (_event, payload) => {
      const principalId = safeText(payload?.principalId);
      if (!principalId || principalId !== backend.getPrincipalContext().principalId) {
        throw new Error("网页翻译权限 principal 已变化");
      }
      if (payload?.eligible !== true) {
        stopAuthorizedSender();
        clearAiAuthorization("ineligible");
        return { ok: true, principalId, eligible: false };
      }
      const authorizationEpoch = clearAiAuthorization("authorization-refreshing");
      try {
        const result = await verifyAiSessionAuthorization(payload?.token, authorizationEpoch);
        const currentAuthorization = aiAuthorizationFingerprint();
        if (
          runningSenderAuthorizationFingerprint &&
          runningSenderAuthorizationFingerprint !== currentAuthorization
        ) {
          stopAuthorizedSender();
        }
        return result;
      } catch (error) {
        if (aiAuthorizationEpoch.isCurrent(authorizationEpoch)) {
          stopAuthorizedSender();
          clearAiAuthorization("authorization-failed");
        }
        throw error;
      }
    });
    ipcMain.handle("settings:save", (_event, payload) =>
      backend.saveSettingsForPrincipal(payload?.settings, payload?.expectedPrincipalId),
    );
    ipcMain.handle("settings:patch", (_event, payload) => {
      const result = backend.patchSettings(
        payload?.section,
        payload?.patch,
        payload?.expectedRevision,
        payload?.expectedPrincipalId,
      );
      if (payload?.section === "translation") syncAllComposerClickGuards();
      return result;
    });
    ipcMain.handle("settings:operate", (_event, payload) => {
      const result = backend.operateSettings(
        payload?.section,
        payload?.operations,
        payload?.expectedRevision,
        payload?.expectedPrincipalId,
      );
      if (payload?.section === "translation") syncAllComposerClickGuards();
      return result;
    });
    ipcMain.handle("settings:import", (_event, payload) =>
      backend.importSettings(payload?.expectedPrincipalId),
    );
    ipcMain.handle("chat-history:load", () => backend.loadChatHistory());
    ipcMain.handle("chat-history:save", (_event, payload) => backend.saveChatHistory(payload));
    // 个人日历 / 任务+备忘录 本地存储。
    ipcMain.handle("calendar:load", () => backend.loadCalendar());
    ipcMain.handle("calendar:save", (_event, payload) => backend.saveCalendar(payload));
    ipcMain.handle("tasks:load", () => backend.loadTasks());
    ipcMain.handle("tasks:save", (_event, payload) => backend.saveTasks(payload));
    ipcMain.handle("focus:load", () => backend.loadFocus());
    ipcMain.handle("focus:save", (_event, payload) => backend.saveFocus(payload));
    // 知识库 vault (笔记文件 IO + 监听)。
    ipcMain.handle("vault:start", () => backend.vault.startWatch());
    ipcMain.handle("vault:get-root", () => backend.vault.getRoot());
    ipcMain.handle("vault:choose-root", () => backend.vault.chooseRoot());
    ipcMain.handle("vault:choose-import", () => backend.vault.chooseImport());
    ipcMain.handle("vault:list", () => backend.vault.list());
    ipcMain.handle("vault:read-all", () => backend.vault.readAll());
    ipcMain.handle("vault:read", (_event, p) => backend.vault.read(p));
    ipcMain.handle("vault:read-binary", (_event, p) => backend.vault.readBinary(p));
    ipcMain.handle("vault:write", (_event, { path, content }) =>
      backend.vault.write(path, content),
    );
    ipcMain.handle("vault:create", (_event, { path, content }) =>
      backend.vault.create(path, content),
    );
    ipcMain.handle("vault:rename", (_event, { from, to }) => backend.vault.rename(from, to));
    ipcMain.handle("vault:remove", (_event, p) => backend.vault.remove(p));
    ipcMain.handle("notes-ai:complete", (_event, req) => backend.notesAi.complete(req));
    ipcMain.handle("notes-ai:cancel", (_event, id) => backend.notesAi.cancel(id));
    ipcMain.handle("notes-ai:invalidate-principal", (_event, principalId) =>
      backend.notesAi.invalidatePrincipal(safeText(principalId)),
    );
    ipcMain.handle("translation:translate", async (_event, payload) => {
      const requestId = safeText(payload?.requestId);
      if (!/^[a-z0-9-]{8,100}$/i.test(requestId)) throw new Error("翻译请求 ID 无效");
      if (translationRequests.has(requestId)) throw new Error("翻译请求 ID 重复");
      const controller = new AbortController();
      translationRequests.set(requestId, controller);
      try {
        return await translateText(payload, { signal: controller.signal });
      } finally {
        if (translationRequests.get(requestId) === controller) {
          translationRequests.delete(requestId);
        }
      }
    });
    ipcMain.handle("translation:cancel", (_event, rawRequestId) => {
      const requestId = safeText(rawRequestId);
      const controller = translationRequests.get(requestId);
      if (!controller) return { ok: false };
      translationRequests.delete(requestId);
      controller.abort();
      return { ok: true };
    });
    ipcMain.handle("translation:capture-page", async (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      const result = await captureAiPageText(kind, safeText(payload?.tabId));
      assertCurrentAiEnvironmentOperation(payload);
      return result;
    });
    ipcMain.handle("translation:write-composer", async (_event, payload) => {
      const { kind, environmentId, generation } = assertCurrentAiEnvironmentOperation(payload);
      const tabId = safeText(payload?.tabId);
      const workspace = getWorkspace(kind, tabId);
      if (
        !workspace ||
        safeText(workspace.environmentId) !== environmentId ||
        Number(workspace.environmentGeneration || 0) !== generation
      ) {
        throw new Error("目标会话不属于当前环境");
      }
      assertExpectedComposerContextGeneration(workspace, payload?.expectedNavigationGeneration);
      await syncComposerClickGuard(workspace);
      assertCurrentAiEnvironmentOperation(payload);
      assertExpectedComposerContextGeneration(workspace, payload?.expectedNavigationGeneration);
      if (!workspace.composerDocumentNonce || !workspace.composerDocumentUrl) {
        throw new Error("网页输入环境尚未准备好，请稍后重试");
      }
      const context = captureComposerContext(workspace);
      const documentNonce = workspace.composerDocumentNonce;
      const documentUrl = workspace.composerDocumentUrl;
      const assertCurrent = () => {
        assertCurrentAiEnvironmentOperation(payload);
        assertExpectedComposerContextGeneration(workspace, payload?.expectedNavigationGeneration);
        assertComposerContextCurrent(context);
        if (
          workspace.composerDocumentNonce !== documentNonce ||
          workspace.composerDocumentUrl !== documentUrl
        ) {
          throw Object.assign(new Error("网页文档身份已失效"), {
            code: "COMPOSER_DOCUMENT_STALE",
          });
        }
      };
      const enterGateToken = payload?.send === true ? createComposerEnterGateToken() : "";
      const result = await replaceAiComposerText(workspace.view.webContents, payload?.text, {
        assertCurrent,
        documentNonce,
        documentUrl,
        enterGateToken,
      });
      assertCurrent();
      let sent = false;
      if (payload?.send === true) {
        if (result.enterGateToken !== enterGateToken) {
          throw new Error("网页发送保护未能正确启用");
        }
        sent = await replayComposerEnter(context, { enterGateToken, gateArmed: true });
      }
      return { ...result, sent };
    });
    ipcMain.handle("translation:resolve-composer-send", async (_event, payload) => {
      const { kind, environmentId, generation } = assertCurrentAiEnvironmentOperation(payload);
      const requestId = safeText(payload?.requestId);
      const pending = pendingComposerSends.get(requestId);
      if (!pending) {
        throw new Error("发送确认已过期，请重新发送");
      }
      if (
        pending.kind !== kind ||
        pending.tabId !== safeText(payload?.tabId) ||
        pending.environmentId !== environmentId ||
        pending.environmentGeneration !== generation ||
        pending.principalId !== backend.getPrincipalContext().principalId
      ) {
        throw new Error("发送确认不属于当前会话");
      }
      assertComposerContextCurrent(pending.context);
      if (payload?.confirmed !== true) {
        if (!pendingComposerSends.take(requestId)) {
          throw new Error("发送确认已失效，请重新发送");
        }
        return { ok: true, sent: false };
      }
      const workspace = assertComposerContextCurrent(pending.context);
      const composer = await inspectAiComposer(workspace.view.webContents, {
        findAny: pending.findAny,
        focus: pending.findAny,
      });
      assertCurrentAiEnvironmentOperation(payload);
      assertComposerContextCurrent(pending.context);
      if (!composer.editable || safeText(composer.text) !== pending.text) {
        throw new Error("网页输入内容已经变化，请重新确认");
      }
      if (!pendingComposerSends.take(requestId)) {
        throw new Error("发送确认已失效，请重新发送");
      }
      const sent = await replayComposerEnter(pending.context, {
        expectedText: pending.text,
        findAny: pending.findAny,
      });
      return { ok: true, sent };
    });
    ipcMain.handle("user-data:export", (_event, payload) =>
      backend.exportUserData(payload?.expectedPrincipalId),
    );
    ipcMain.handle("user-data:import", (_event, payload) =>
      backend.importUserData(payload?.expectedPrincipalId),
    );
    ipcMain.handle("clipboard:read-attachment", () => buildClipboardAttachmentPayload());
    ipcMain.handle("service:status", () => backend.getStatus());
    ipcMain.handle("app:paths", () => backend.getPaths());
    ipcMain.handle("app:meta", () => backend.getAppMeta());
    ipcMain.handle("app:device-info", () => backend.getDeviceInfo());
    ipcMain.handle("app:mode", () => appMode);
    ipcMain.handle("app:update-check", async () => {
      try {
        return await backend.checkLatestRelease();
      } catch (_err) {
        return null;
      }
    });
    // 是否支持「原地无感更新」(Windows 打包版 = true; mac / dev = false -> 前端回退到下载方式)。
    ipcMain.handle("app:update-supported", () => Boolean(autoUpdater));
    // Windows 无感更新: 检查 -> 下载(进度走 app:update-progress) -> 完成后原地安装并自动重启。
    ipcMain.handle("app:update-install", async () => {
      if (!autoUpdater) {
        throw new Error("当前版本不支持原地自动安装，请用下载方式更新");
      }
      if (autoUpdaterBusy) {
        throw new Error("更新正在进行中…");
      }
      autoUpdaterBusy = true;
      try {
        return await new Promise((resolve, reject) => {
          const cleanup = () => {
            autoUpdater.removeListener("update-available", onAvailable);
            autoUpdater.removeListener("update-not-available", onNotAvailable);
            autoUpdater.removeListener("update-downloaded", onDownloaded);
            autoUpdater.removeListener("error", onError);
          };
          const onAvailable = () => {
            autoUpdater.downloadUpdate().catch(onError);
          };
          const onNotAvailable = () => {
            cleanup();
            resolve({ updated: false });
          };
          const onDownloaded = async () => {
            cleanup();
            try {
              await flushAiSessionStorage(getAiStoragePartitions());
              backend && backend.createUpdateBackup("before-autoupdate");
            } catch (error) {
              reject(
                new Error("更新前资料写盘或备份失败，已停止自动安装", {
                  cause: error,
                }),
              );
              return;
            }
            resolve({ updated: true, installing: true });
            // 静默安装 NSIS 包并自动重启 (isSilent=true, isForceRunAfter=true)。
            setTimeout(() => {
              try {
                autoUpdater.quitAndInstall(true, true);
              } catch (_e) {
                /* ignore */
              }
            }, 600);
          };
          const onError = (err) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(String((err && err.message) || err)));
          };
          autoUpdater.on("update-available", onAvailable);
          autoUpdater.on("update-not-available", onNotAvailable);
          autoUpdater.on("update-downloaded", onDownloaded);
          autoUpdater.on("error", onError);
          autoUpdater.checkForUpdates().catch(onError);
        });
      } finally {
        autoUpdaterBusy = false;
      }
    });
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
      await flushAiSessionStorage(getAiStoragePartitions());
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

    // 原生 WebContentsView 位于渲染层之上，必须由当前导航页做全局门控；
    // 仅靠组件卸载时的异步隐藏通知会产生竞态，导致旧 Claude/GPT 盖住其它页面。
    ipcMain.handle("ai:set-active-kind", async (_event, payload) => {
      const activeKind = setActiveAiKind(payload?.kind);
      const workspace = getWorkspace(activeKind, activeTabIdByKind[activeKind]);
      if (workspace) await syncComposerClickGuard(workspace);
      return { activeKind };
    });
    ipcMain.handle("ai:close-all", async () => {
      await flushAndDisposeAiWorkspaces();
      return { ok: true };
    });

    // 标签管理 (GPT / Gemini / Claude 通用, 由 payload.kind 区分)。
    ipcMain.handle("ai-tabs:list", (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      const active = getWorkspace(kind, activeTabIdByKind[kind]);
      return {
        ...listTabsPayload(kind),
        activeState: active ? getAiStatePayload(active) : null,
      };
    });

    ipcMain.handle("ai-tabs:create", (_event, payload) => {
      const { kind, environmentId, generation } = assertCurrentAiEnvironmentOperation(payload);
      assertCurrentAiEnvironmentOperation(payload);
      const previousWorkspace = getWorkspace(kind, activeTabIdByKind[kind]);
      if (previousWorkspace) invalidateComposerWorkspace(previousWorkspace, "workspace-switched");
      const workspace = createTabWorkspace(kind, {
        title: safeText(payload?.title),
        lastUrl: safeText(payload?.lastUrl),
        allowExternalBrowsing: Boolean(payload?.allowExternalBrowsing),
        environmentId,
        environmentGeneration: generation,
      });
      activeTabIdByKind[kind] = workspace.id;
      syncActiveWorkspace(kind);
      emitTabsChanged(kind);
      return {
        ...listTabsPayload(kind),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("ai-tabs:switch", async (_event, payload) => {
      const { kind, environmentId } = assertCurrentAiEnvironmentOperation(payload);
      const tabId = safeText(payload?.tabId);
      const workspace = getWorkspace(kind, tabId);
      if (!workspace) {
        throw new Error("目标会话不存在");
      }
      if (safeText(workspace.environmentId) !== environmentId)
        throw new Error("目标会话不属于当前环境");
      assertCurrentAiEnvironmentOperation(payload);
      const previousWorkspace = getWorkspace(kind, activeTabIdByKind[kind]);
      if (previousWorkspace && previousWorkspace !== workspace) {
        invalidateComposerWorkspace(previousWorkspace, "workspace-switched");
      }
      activeTabIdByKind[kind] = workspace.id;
      syncActiveWorkspace(kind);
      await syncComposerClickGuard(workspace);
      emitTabsChanged(kind);
      return {
        ...listTabsPayload(kind),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("ai-tabs:close", (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      assertCurrentAiEnvironmentOperation(payload);
      return closeTabWorkspace(kind, payload?.tabId);
    });

    ipcMain.handle("ai:environment-activate", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      if (!isAiKind(kind)) throw new Error("不支持的 AI 服务");
      const generation = Number.parseInt(String(payload?.generation || "0"), 10);
      if (!Number.isInteger(generation) || generation < 1) throw new Error("环境切换请求已失效");
      const rawEnvironmentId = safeText(payload?.environmentId);
      const environmentId = normalizeAiEnvironmentId(rawEnvironmentId);
      if (rawEnvironmentId && !environmentId) throw new Error("AI 环境标识不合法");
      if (environmentId) getConfiguredAiEnvironment(kind, environmentId);
      const activation = aiEnvironmentGuard.activate({ kind, environmentId, generation });
      if (activation.stale) return { ok: false, stale: true, kind, environmentId };
      const workspaces = listWorkspaces(kind);
      for (const workspace of workspaces) {
        if (
          safeText(workspace.environmentId) !== environmentId ||
          Number(workspace.environmentGeneration || 0) !== generation
        ) {
          invalidateComposerWorkspace(workspace, "environment-activated");
        }
        if (safeText(workspace.environmentId) === environmentId) {
          workspace.environmentGeneration = generation;
        }
      }
      const changed = shouldCloseAiWorkspacesForEnvironment(workspaces, environmentId);
      if (changed) await closeWorkspacesForKind(kind);
      if (!aiEnvironmentGuard.isCurrent(activation)) {
        return { ok: false, stale: true, kind, environmentId };
      }
      await syncAllComposerClickGuards();
      return { ok: true, kind, environmentId, changed, generation };
    });

    ipcMain.handle("ai:environment-delete", async (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      const principalContext = backend.getPrincipalContext();
      const principalId = principalContext.principalId;
      const environmentId = normalizeAiEnvironmentId(payload?.targetEnvironmentId);
      if (!isAiKind(kind) || !environmentId) throw new Error("AI 环境标识不合法");
      getConfiguredAiEnvironment(kind, environmentId);
      const currentSettings = backend.loadSettings();
      const advanced = currentSettings.advancedAi || {};
      const environments = Array.isArray(advanced.environments) ? advanced.environments : [];
      const remaining = environments.filter(
        (environment) => normalizeAiEnvironmentId(environment?.id) !== environmentId,
      );
      const operations = [{ op: "delete", path: ["environments", environmentId] }];
      if (normalizeAiEnvironmentId(advanced.activeByKind?.[kind]) === environmentId) {
        operations.push({
          op: "set",
          path: ["activeByKind", kind],
          value: remaining.find((environment) => safeText(environment?.kind) === kind)?.id || "",
        });
      }
      const targetLoaded = listWorkspaces(kind).some(
        (workspace) => safeText(workspace.environmentId) === environmentId,
      );
      if (targetLoaded) await closeWorkspacesForKind(kind);
      assertCurrentAiEnvironmentOperation(payload);
      assertPrincipalUnchanged(principalContext);
      let savedSettings = backend.operateSettings(
        "advancedAi",
        operations,
        currentSettings.settingsRevision,
        principalId,
      );
      const principal = backend.getPrincipalContext();
      const partition = partitionForAiEnvironment(
        kind,
        environmentId,
        principal.principalId,
        principal.legacyPartitionOwnerId,
      );
      let dataCleared = true;
      await clearAiSessionData(session.fromPartition(partition)).catch((error) => {
        dataCleared = false;
        appLog.scoped("app").warn("AI 环境配置已删除，但登录数据清理失败", {
          kind,
          environmentId,
          error: error?.message || String(error),
        });
      });
      assertPrincipalUnchanged(principalContext);
      if (!dataCleared) {
        const latest = backend.loadSettings();
        const pending = Array.isArray(latest.ui?.pendingAiPartitionCleanup)
          ? latest.ui.pendingAiPartitionCleanup.map(safeText).filter(Boolean)
          : [];
        savedSettings = backend.patchSettings(
          "ui",
          { pendingAiPartitionCleanup: [...new Set([...pending, partition])] },
          latest.settingsRevision,
          principalId,
        );
      }
      aiContactedHostsByPartition.get(partition)?.clear();
      return { ok: true, kind, environmentId, dataCleared, settings: savedSettings };
    });

    ipcMain.handle("ai:environment-egress-check", async (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      const sender = {
        host: "127.0.0.1",
        port: Number(backend?.activeSocksPort),
      };
      const targetEnvironmentId = normalizeAiEnvironmentId(payload?.targetEnvironmentId);
      if (!targetEnvironmentId) throw new Error("AI 环境标识不合法");
      const route = getWorkspaceProxyRoute(kind, targetEnvironmentId, sender);
      const result = await checkAiRouteHealth(route, { force: true });
      assertCurrentAiEnvironmentOperation(payload);
      return result;
    });

    ipcMain.handle("ai:ensure", async (_event, payload) => {
      const { kind, environmentId, generation } = assertCurrentAiEnvironmentOperation(payload);
      const requestedTabId = safeText(payload?.tabId);
      if (!requestedTabId && !activeTabIdByKind[kind]) {
        return null;
      }
      const sender = {
        host: safeText(payload?.host || "127.0.0.1") || "127.0.0.1",
        port: Number.parseInt(String(payload?.port || "1080"), 10),
      };
      const route = getWorkspaceProxyRoute(kind, environmentId, sender);
      const targetTabId = requestedTabId || activeTabIdByKind[kind];
      const existingWorkspace = getWorkspace(kind, targetTabId);
      let verifiedRouteFingerprint = "";
      if (environmentId && shouldPreflightAiRoute(existingWorkspace, route)) {
        const health = await checkAiRouteHealth(route);
        assertCurrentAiEnvironmentOperation(payload);
        if (!health.ok) {
          throw new Error(`线路 ${route.label} 未通过出口身份预检，已阻止页面访问`);
        }
        verifiedRouteFingerprint = aiRouteFingerprint(route);
      }
      assertCurrentAiEnvironmentOperation(payload);
      const workspace = getOrCreateAiWorkspace(kind, targetTabId, {
        lastUrl: safeText(payload?.lastUrl),
        allowExternalBrowsing: Boolean(payload?.allowExternalBrowsing),
        environmentId,
        environmentGeneration: generation,
      });
      if (!activeTabIdByKind[kind]) {
        activeTabIdByKind[kind] = workspace.id;
      }
      const userAgent = sanitizeEmbeddedUserAgent(payload?.userAgent);
      const homeUrl = safeText(payload?.homeUrl);
      const lastUrl = safeText(payload?.lastUrl);
      const forceReload = Boolean(payload?.forceReload);

      const targetSession = session.fromPartition(workspace.policy.partition);
      configureAiSession(targetSession, workspace.policy);

      const proxySignature = `${route.host}:${route.port}`;
      const resolvedSessionProxy = await targetSession
        .resolveProxy(workspace.lastUrl || workspace.policy.homeUrl)
        .then((value) => safeText(value))
        .catch(() => "");
      assertCurrentAiEnvironmentOperation(payload);
      if (
        workspace.proxySignature !== proxySignature ||
        !resolvedProxyMatchesRoute(resolvedSessionProxy, route)
      ) {
        assertCurrentAiEnvironmentOperation(payload);
        await targetSession.setProxy({
          proxyRules: `socks5://${route.host}:${route.port}`,
          proxyBypassRules: "",
        });
        assertCurrentAiEnvironmentOperation(payload);
        await targetSession.closeAllConnections();
        assertCurrentAiEnvironmentOperation(payload);
        const verifiedProxy = safeText(
          await targetSession.resolveProxy(workspace.lastUrl || workspace.policy.homeUrl),
        );
        assertCurrentAiEnvironmentOperation(payload);
        if (!resolvedProxyMatchesRoute(verifiedProxy, route)) {
          throw new Error(`AI 会话未能绑定指定线路 ${proxySignature}，已阻止页面访问`);
        }
        workspace.proxySignature = proxySignature;
      }
      workspace.proxyMode = route.mode;
      workspace.proxyLabel = route.label;
      workspace.proxyPort = route.port || null;
      if (verifiedRouteFingerprint) {
        workspace.routeHealthFingerprint = verifiedRouteFingerprint;
      }

      if (userAgent) {
        workspace.userAgent = userAgent;
        workspace.view.webContents.setUserAgent(userAgent);
      }
      await applyWorkspacePrivacy(workspace);
      assertCurrentAiEnvironmentOperation(payload);

      const targetUrl =
        normalizeAiWorkspaceUrl(
          workspace,
          isWorkspaceUrlAllowed(workspace, lastUrl)
            ? lastUrl
            : isWorkspaceUrlAllowed(workspace, homeUrl)
              ? homeUrl
              : workspace.policy.homeUrl,
        ) || workspace.policy.homeUrl;

      const currentWorkspaceUrl = safeText(workspace.view.webContents.getURL());
      assertCurrentAiEnvironmentOperation(payload);
      if (!workspace.initialized || !isWorkspaceUrlAllowed(workspace, currentWorkspaceUrl)) {
        workspace.initialized = false;
        workspace.loading = true;
        workspace.lastUrl = targetUrl;
        emitAiState(workspace, "did-start-loading", { url: targetUrl });
        void loadAiWorkspaceUrl(workspace, targetUrl).catch((err) => {
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

      emitTabsChanged(kind);
      return getAiStatePayload(workspace);
    });

    // 只允许按单个 AI 服务清理；UI 必须先经协作账号密码复核，主进程不提供“全部清理”。
    ipcMain.handle("ai:data-clear", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      if (!isAiKind(kind)) throw new Error("不支持的 AI 服务");
      const principalContext = backend.getPrincipalContext();
      await verifyBrowserDestructiveAction(payload);
      assertPrincipalUnchanged(principalContext);
      const beforeSnapshot = await rememberBeforeClear(kind, principalContext);
      assertPrincipalUnchanged(principalContext);
      const policy = getAiPolicy(kind);
      await closeWorkspacesForKind(kind);
      assertPrincipalUnchanged(principalContext);
      const targetSession = session.fromPartition(policy.partition);
      await clearAiSessionData(targetSession);
      assertPrincipalUnchanged(principalContext);
      aiContactedHostsByPartition.get(policy.partition)?.clear();

      const settings = backend.loadSettings();
      const privacy = normalizeBrowserPrivacySettings(settings.browserPrivacy);
      const clearedAt = new Date().toISOString();
      privacy.lastClearedAt[kind] = clearedAt;
      settings.browserPrivacy = privacy;
      settings[kind] = {
        ...(settings[kind] || {}),
        last_url: policy.homeUrl,
      };
      backend.saveSettingsForPrincipal(settings, principalContext.principalId);
      return { ok: true, kind, clearedAt, homeUrl: policy.homeUrl, beforeSnapshot };
    });

    ipcMain.handle("ai:profile-rebuild", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      if (!isAiKind(kind)) throw new Error("不支持的 AI 服务");
      const principalContext = backend.getPrincipalContext();
      await verifyBrowserDestructiveAction(payload);
      assertPrincipalUnchanged(principalContext);
      const beforeSnapshot = await rememberBeforeClear(kind, principalContext);
      assertPrincipalUnchanged(principalContext);
      const oldPolicy = getAiPolicy(kind);
      await closeWorkspacesForKind(kind);
      assertPrincipalUnchanged(principalContext);
      const oldSession = session.fromPartition(oldPolicy.partition);
      await clearAiSessionData(oldSession);
      assertPrincipalUnchanged(principalContext);
      aiContactedHostsByPartition.get(oldPolicy.partition)?.clear();

      const settings = backend.loadSettings();
      const privacy = normalizeBrowserPrivacySettings(settings.browserPrivacy);
      const profile = newLocalProfile(kind);
      const principal = backend.getPrincipalContext();
      const partition = partitionForAiProfile(kind, profile.id, principal.principalId);
      privacy.localProfiles[kind] = profile;
      privacy.lastClearedAt[kind] = profile.rebuiltAt;
      privacy.audit.current[kind] = null;
      settings.browserPrivacy = privacy;
      settings[kind] = {
        ...(settings[kind] || {}),
        partition,
        last_url: oldPolicy.homeUrl,
      };
      backend.saveSettingsForPrincipal(settings, principalContext.principalId);
      return {
        ok: true,
        kind,
        rebuiltAt: profile.rebuiltAt,
        partition,
        homeUrl: oldPolicy.homeUrl,
        beforeSnapshot,
      };
    });

    ipcMain.handle("browser-privacy:capture", async (_event, payload) => {
      return captureWorkspaceFingerprint(payload?.kind, payload?.tabId);
    });

    ipcMain.handle("browser-privacy:apply", async () => {
      const results = [];
      for (const workspace of aiWorkspaces.values()) {
        try {
          const applied = await applyWorkspacePrivacy(workspace);
          results.push({ kind: workspace.kind, tabId: workspace.id, ok: true, applied });
        } catch (err) {
          results.push({
            kind: workspace.kind,
            tabId: workspace.id,
            ok: false,
            message: err.message || String(err),
          });
        }
      }
      return { ok: results.every((item) => item.ok), results };
    });

    ipcMain.handle("browser-privacy:detect-proxy-environment", async () => {
      const port = Number(backend?.activeSocksPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("请先启动代理，再同步出口环境");
      }
      return detectProxyEnvironment(port);
    });

    ipcMain.handle("ai:sync-host", (_event, payload) => {
      const { kind } = assertCurrentAiEnvironmentOperation(payload);
      const bounds = payload?.bounds;
      const visible = Boolean(payload?.visible);
      if (hostStateByKind[kind]) {
        if (kind !== activeAiKind) {
          hostStateByKind[kind] = { bounds: null, visible: false };
          for (const workspace of listWorkspaces(kind)) detachWorkspaceView(workspace);
          return false;
        }
        hostStateByKind[kind] = { bounds, visible };
        return syncActiveWorkspace(kind);
      }
      const workspace = getWorkspace(kind);
      if (!workspace) return false;
      return syncAiBounds(workspace, { bounds, visible });
    });

    // 代理检测: 汇报该 AI 页面流量是否全部经发送代理 (梯子)。
    // 会话级: resolveProxy 确认 webview 出口确实指向本地 socks (sing-box)。
    // 路由级: 把会话实际访问过的每个主机, 按 backend 的发送路由清单逐域判定
    //   命中 target_domains -> 走发送代理(梯子); 未命中 -> 回落(本机代理/直连), 即未走发送代理。
    ipcMain.handle("ai:proxy-check", async (_event, payload) => {
      const { kind, environmentId } = assertCurrentAiEnvironmentOperation(payload);
      const workspace =
        getWorkspace(kind, safeText(payload?.tabId)) || getWorkspace(kind, activeTabIdByKind[kind]);
      if (!workspace) {
        return { ok: false, reason: "no-workspace" };
      }
      if (safeText(workspace.environmentId) !== environmentId)
        throw new Error("目标会话不属于当前环境");

      const targetSession = session.fromPartition(workspace.policy.partition);
      const wc = workspace.view.webContents;
      const currentUrl = safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl;

      let sessionProxy = "";
      try {
        sessionProxy = safeText(await targetSession.resolveProxy(currentUrl));
      } catch {}
      assertCurrentAiEnvironmentOperation(payload);
      const expectedRoute = {
        host: "127.0.0.1",
        port: workspace.proxyPort,
      };
      const sessionProxied = resolvedProxyMatchesRoute(sessionProxy, expectedRoute);

      const recorded = aiContactedHostsByPartition.get(workspace.policy.partition) || new Set();
      const hostSet = new Set(recorded);
      try {
        const h = new URL(currentUrl).hostname;
        if (h) hostSet.add(h);
      } catch {}

      // 按「当前运行中的发送端配置实际走代理的域名」分类, 而非写死的内置清单:
      // 这样把域名加入清单并重启 sing-box 后, 检测才会从"回落"翻到"已走代理"(否则永远爆红)。
      // 发送端未运行时退回内置清单, 仅用于展示。
      const runningSuffixes = backend && backend.activeProxiedSuffixes;
      const suffixes =
        Array.isArray(runningSuffixes) && runningSuffixes.length
          ? runningSuffixes
          : Array.isArray(DEFAULT_TARGET_DOMAINS)
            ? DEFAULT_TARGET_DOMAINS
            : [];
      const viaProxy = (host) => {
        if (workspace.proxyMode === "singbox") return true;
        if (workspace.proxyMode !== "sender") return false;
        return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
      };

      const hosts = [...hostSet]
        .filter(Boolean)
        .sort()
        .map((host) => ({ host, via: viaProxy(host) ? "proxy" : "fallback" }));

      return {
        ok: true,
        kind: workspace.kind,
        tabId: safeText(workspace.id),
        currentUrl,
        socksEndpoint: safeText(workspace.proxySignature),
        proxyMode: safeText(workspace.proxyMode),
        proxyLabel: safeText(workspace.proxyLabel),
        expectedProxy: workspace.proxyMode === "sender" || workspace.proxyMode === "singbox",
        expectedSessionProxy: safeText(workspace.proxySignature),
        sessionProxy,
        sessionProxied,
        proxyCount: hosts.filter((h) => h.via === "proxy").length,
        fallbackCount: hosts.filter((h) => h.via === "fallback").length,
        hosts,
      };
    });

    ipcMain.handle("ai:navigate", async (_event, payload) => {
      const { kind, environmentId } = assertCurrentAiEnvironmentOperation(payload);
      const action = safeText(payload?.action);
      const url = safeText(payload?.url);
      const workspace = getWorkspace(kind, safeText(payload?.tabId));
      if (!workspace) return null;
      if (safeText(workspace.environmentId) !== environmentId)
        throw new Error("目标会话不属于当前环境");

      const wc = workspace.view.webContents;
      switch (action) {
        case "back":
          if (wc.canGoBack()) wc.goBack();
          break;
        case "forward":
          if (wc.canGoForward()) wc.goForward();
          break;
        case "reload":
          assertCurrentAiEnvironmentOperation(payload);
          workspace.loading = true;
          emitAiState(workspace, "did-start-loading");
          wc.reload();
          break;
        case "load":
          if (!isWorkspaceUrlAllowed(workspace, url)) {
            throw new Error("不允许加载该页面");
          }
          const targetUrl = normalizeAiWorkspaceUrl(workspace, url);
          assertCurrentAiEnvironmentOperation(payload);
          workspace.loading = true;
          workspace.initialized = true;
          workspace.lastUrl = targetUrl;
          emitAiState(workspace, "did-start-loading", { url: targetUrl });
          void loadAiWorkspaceUrl(workspace, targetUrl).catch((err) => {
            workspace.loading = false;
            emitAiEvent(workspace.kind, "did-fail-load", {
              ...getAiStatePayload(workspace),
              url: targetUrl,
              errorDescription: err.message || String(err),
            });
          });
          break;
        default:
          break;
      }

      emitTabsChanged(kind);
      return getAiStatePayload(workspace);
    });

    ipcMain.handle("ai:install-query-tracker", async (_event, payload) => {
      const { kind, environmentId } = assertCurrentAiEnvironmentOperation(payload);
      const workspace = getWorkspace(kind, safeText(payload?.tabId));
      const currentUrl = safeText(workspace?.view?.webContents?.getURL());
      if (
        !workspace ||
        !isAiKind(kind) ||
        !isAllowedUrlForHosts(currentUrl, workspace.policy?.allowedHosts || [])
      ) {
        return false;
      }
      if (safeText(workspace.environmentId) !== environmentId)
        throw new Error("目标会话不属于当前环境");
      const marker = {
        gpt: "__GPT_QUERY__",
        gemini: "__GEMINI_QUERY__",
        claude: "__CLAUDE_QUERY__",
      }[kind];
      const code = `
        (() => {
          if (window.__shareGptQueryTrackerInstalled) return true;
          window.__shareGptQueryTrackerInstalled = true;
          const CE = '[contenteditable]:not([contenteditable="false"])';
          const readText = () => {
            const textarea = document.querySelector('textarea');
            const editor = document.querySelector(CE);
            return String(textarea?.value || editor?.innerText || '').trim().slice(0, 160);
          };
          const emit = () => {
            const text = readText();
            if (text) console.log(${JSON.stringify(marker)} + JSON.stringify({ text, stamp: Date.now() }));
          };
          document.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            const target = event.target;
            if (target?.closest?.('textarea') || target?.closest?.(CE) || target?.matches?.(CE)) emit();
          }, true);
          document.addEventListener('click', (event) => {
            const button = event.target?.closest?.('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="发送"]');
            if (button) emit();
          }, true);
          return true;
        })();
      `;
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
          preload: path.join(__dirname, "profilePreload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      attachWindowGuards(profileWindow);
      if (process.platform === "darwin") {
        profileWindow.setWindowButtonVisibility(true);
      }
      profileContext = {
        serverUrl: String(payload?.serverUrl || ""),
        token: String(payload?.token || ""),
        username: String(payload?.username || ""),
      };

      profileWindow.removeMenu();
      loadProfileRenderer(profileWindow, {});
      profileWindow.on("closed", () => {
        profileWindow = null;
        profileContext = null;
      });
      return true;
    });

    ipcMain.handle("profile:get-context", (event) => {
      if (!profileWindow || event.sender !== profileWindow.webContents) {
        throw new Error("不允许读取个人资料会话");
      }
      return profileContext ? { ...profileContext } : null;
    });

    ipcMain.on("profile:updated", (event, payload) => {
      if (!profileWindow || event.sender !== profileWindow.webContents) return;
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

    ipcMain.handle("window:is-fullscreen", (event) => {
      const targetWindow = getEventWindow(event, mainWindow);
      if (!targetWindow) return false;
      return targetWindow.isFullScreen();
    });

    // 切换窗口全屏 (类似 F11)。供 AI 工作区「全屏」按钮与 F11 快捷键调用。
    ipcMain.handle("window:toggle-fullscreen", (event, payload) => {
      const targetWindow = getEventWindow(event, mainWindow) || mainWindow;
      if (!targetWindow || targetWindow.isDestroyed()) return false;
      const next =
        payload && typeof payload.value === "boolean"
          ? payload.value
          : !targetWindow.isFullScreen();
      targetWindow.setFullScreen(next);
      return next;
    });

    ipcMain.handle("sender:start", async (_event, senderSettings) => {
      assertMode("sender");
      const principal = backend.getPrincipalContext();
      const authorizationFingerprint = principal.serverUrl
        ? aiAuthorizationFingerprint(currentAiAuthorization())
        : `local:${principal.principalId}:${principal.generation}`;
      const settings = authorizedSenderSettings(senderSettings);
      const result = await backend.startSender(settings);
      try {
        assertPrincipalUnchanged(principal);
        if (
          principal.serverUrl &&
          authorizationFingerprint !== aiAuthorizationFingerprint(currentAiAuthorization())
        ) {
          throw new Error("发送服务授权已经变化");
        }
      } catch (error) {
        stopAuthorizedSender();
        throw error;
      }
      runningSenderAuthorizationFingerprint = authorizationFingerprint;
      return result;
    });
    ipcMain.handle("sender:stop", () => {
      assertMode("sender");
      stopAuthorizedSender();
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
    ipcMain.handle = rawHandle;
  }

  app.whenReady().then(async () => {
    applyStableUserDataPath(app);
    appLog.init(app.getPath("userData"));
    const log = appLog.scoped("main");
    // 主进程未捕获异常兜底: 记录日志而非静默崩溃 (写入 userData/logs/main.log)。
    process.on("uncaughtException", (err) => log.error("uncaughtException:", err));
    process.on("unhandledRejection", (reason) => log.error("unhandledRejection:", reason));
    backend = new Backend(app, () => mainWindow, appMode);
    backend.init();

    const startupSettings = backend.loadSettings();
    const pendingPartitions = Array.isArray(startupSettings.ui?.pendingAiPartitionCleanup)
      ? startupSettings.ui.pendingAiPartitionCleanup
          .map(safeText)
          .filter((partition) =>
            /^persist:sharegpt-ai-(?:(?:[a-f0-9]{64}|local-device)-)?(?:gpt|gemini|claude)-env-[a-z0-9-]{1,80}$/.test(
              partition,
            ),
          )
      : [];
    if (pendingPartitions.length) {
      const remaining = [];
      for (const partition of pendingPartitions) {
        try {
          await clearAiSessionData(session.fromPartition(partition));
        } catch (error) {
          remaining.push(partition);
          log.warn("延迟清理 AI 环境登录数据失败", { partition, error });
        }
      }
      backend.patchSettings(
        "ui",
        { pendingAiPartitionCleanup: remaining },
        backend.loadSettings().settingsRevision,
        backend.getPrincipalContext().principalId,
      );
    }

    registerIpc();
    createWindow();
    setupAutoUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  let storageFlushedBeforeQuit = false;
  let storageFlushBeforeQuit = null;
  app.on("before-quit", (event) => {
    if (!backend || storageFlushedBeforeQuit) {
      disposeAiWorkspaces();
      if (backend) backend.stopAll();
      return;
    }
    event.preventDefault();
    if (storageFlushBeforeQuit) return;
    storageFlushBeforeQuit = flushAiSessionStorage(getAiStoragePartitions())
      .catch(() => {})
      .finally(() => {
        storageFlushedBeforeQuit = true;
        disposeAiWorkspaces();
        backend.stopAll();
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = {
  createElectronApp,
};
