const fs = require("node:fs");
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
  session,
  shell,
} = require("electron");
const { Backend, DEFAULT_TARGET_DOMAINS } = require("./backend");
const appLog = require("./logger");

// 记录每个 AI 会话(按 partition)实际访问过的主机名, 供「代理检测」展示页面流量去向。
// 在 configureAiSession 内通过 webRequest 被动收集 (每个 partition 仅装一次)。
const aiContactedHostsByPartition = new Map();

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
    allowedHosts: GPT_ALLOWED_HOSTS,
  },
  gemini: {
    kind: "gemini",
    partition: "persist:gemini-chat",
    homeUrl: "https://gemini.google.com/",
    allowedHosts: GEMINI_ALLOWED_HOSTS,
  },
  claude: {
    kind: "claude",
    partition: "persist:claude-chat",
    homeUrl: "https://claude.ai/",
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

async function flushAiSessionStorage() {
  const partitions = Object.values(AI_WORKSPACE_POLICIES).map((policy) => policy.partition);
  await Promise.all(
    partitions.map(async (partition) => {
      try {
        await session.fromPartition(partition).flushStorageData();
      } catch (err) {
        console.warn(`Unable to flush ${partition}:`, err.message || err);
      }
    }),
  );
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
  if (workspace?.userAgent) {
    options.userAgent = workspace.userAgent;
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
  let backend = null;
  // electron-updater: 仅 Windows 打包版启用「原地无感更新」(NSIS)。
  // mac 未签名无法走 Squirrel 自动更新, 仍用下载 dmg 的方式; dev/未打包也不启用。
  let autoUpdater = null;
  let autoUpdaterBusy = false;
  let appMode = normalizeMode(baseMode, process.argv);
  const configuredAiPartitions = new Set();
  const aiWorkspaces = new Map();
  // GPT 与 Gemini 均支持多标签: 标签顺序 / 活动标签 / 宿主矩形 均按 kind 索引。
  const tabOrderByKind = { gpt: [], gemini: [], claude: [] };
  const activeTabIdByKind = { gpt: "", gemini: "", claude: "" };
  let aiTabCounter = 0;
  const hostStateByKind = {
    gpt: { visible: false, bounds: null },
    gemini: { visible: false, bounds: null },
    claude: { visible: false, bounds: null },
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

  function getAiPolicy(kind) {
    return AI_WORKSPACE_POLICIES[safeText(kind)] || null;
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

    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = safeText(details?.requestingUrl || webContents?.getURL?.());
      const allow =
        AI_ALLOWED_PERMISSIONS.has(permission) &&
        isAllowedUrlForHosts(requestingUrl, policy.allowedHosts);
      callback(allow);
    });

    if (typeof targetSession.setPermissionCheckHandler === "function") {
      targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        return (
          AI_ALLOWED_PERMISSIONS.has(permission) &&
          isAllowedUrlForHosts(requestingOrigin, policy.allowedHosts)
        );
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
      if (workspace.id !== activeTabIdByKind[targetKind]) {
        detachWorkspaceView(workspace);
      }
    }

    if (!activeWorkspace) {
      return false;
    }

    return syncAiBounds(activeWorkspace, hostStateByKind[targetKind]);
  }

  function createTabWorkspace(kind, options = {}) {
    const targetKind = safeText(kind);
    const workspace = getOrCreateAiWorkspace(targetKind, safeText(options.tabId), {
      title: safeText(options.title),
      lastUrl: safeText(options.lastUrl),
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

  function loadAiWorkspaceUrl(workspace, rawUrl) {
    const targetUrl = normalizeAiWorkspaceUrl(workspace, rawUrl) || workspace.policy.homeUrl;
    return workspace.view.webContents
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
      });
  }

  function bindAiWorkspaceEvents(workspace) {
    const wc = workspace.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
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
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
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
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
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
        workspace.lastUrl = normalizeAiWorkspaceUrl(workspace, url);
      }
      workspace.initialized = true;
      emitAiState(workspace, "did-navigate", { url });
    });

    wc.on("did-navigate-in-page", (_event, url) => {
      if (isAllowedUrlForHosts(url, workspace.policy.allowedHosts)) {
        workspace.lastUrl = normalizeAiWorkspaceUrl(workspace, url);
      }
      emitAiState(workspace, "did-navigate-in-page", { url });
    });

    wc.on("page-title-updated", (event, title) => {
      event.preventDefault();
      workspace.title = normalizeAiTabTitle(title, workspace.defaultTitle);
      emitTabsChanged(workspace.kind);
    });

    wc.on("console-message", (_event, _level, message) => {
      emitAiEvent(workspace.kind, "console-message", { message: String(message || "") });
    });

    // F11: 嵌入的 AI 网页获得焦点时, 渲染层收不到键盘事件; 在此拦截 F11 切换窗口全屏。
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
      }
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
      push({ label: "复制", click: () => wc.copy() });
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
      policy,
      view,
      attached: false,
      initialized: false,
      loading: false,
      visible: false,
      lastUrl: safeText(options.lastUrl) || policy.homeUrl,
      defaultTitle: normalizeAiTabTitle(safeText(options.title), defaultTitleForKind(targetKind)),
      title: normalizeAiTabTitle(safeText(options.title), defaultTitleForKind(targetKind)),
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
    tabOrderByKind.gpt.length = 0;
    tabOrderByKind.gemini.length = 0;
    tabOrderByKind.claude.length = 0;
    activeTabIdByKind.gpt = "";
    activeTabIdByKind.gemini = "";
    activeTabIdByKind.claude = "";
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
        sandbox: false,
      },
    });

    attachWindowGuards(mainWindow);
    // F11 切换全屏 (主窗口 chrome 获得焦点时; AI 网页获得焦点时由各 view 的 before-input-event 处理)。
    mainWindow.webContents.on("before-input-event", (event, input) => {
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
    if (process.platform === "darwin") {
      mainWindow.setWindowButtonVisibility(true);
    }
    mainWindow.removeMenu();
    loadMainRenderer(mainWindow);
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
    // 让内嵌网页(ChatGPT/Gemini, 设为"跟随系统")的明暗跟随 app UI 主题。
    // nativeTheme.themeSource 影响所有 webContents 的 prefers-color-scheme;
    // 渲染层自身用 .dark class 控制, 不受此影响。
    ipcMain.handle("app:set-theme-source", (_event, source) => {
      nativeTheme.themeSource =
        source === "dark" ? "dark" : source === "light" ? "light" : "system";
      return true;
    });
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
            await flushAiSessionStorage().catch(() => {});
            try {
              backend && backend.createUpdateBackup("before-autoupdate");
            } catch (_e) {
              /* 数据已在固定 userData 目录, 备份失败不阻断安装 */
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

    // 标签管理 (GPT / Gemini 通用, 由 payload.kind 区分)。
    ipcMain.handle("ai-tabs:list", (_event, payload) => {
      const kind = safeText(payload?.kind) || "gpt";
      const active = getWorkspace(kind, activeTabIdByKind[kind]);
      return {
        ...listTabsPayload(kind),
        activeState: active ? getAiStatePayload(active) : null,
      };
    });

    ipcMain.handle("ai-tabs:create", (_event, payload) => {
      const kind = safeText(payload?.kind) || "gpt";
      const workspace = createTabWorkspace(kind, {
        title: safeText(payload?.title),
        lastUrl: safeText(payload?.lastUrl),
      });
      activeTabIdByKind[kind] = workspace.id;
      syncActiveWorkspace(kind);
      emitTabsChanged(kind);
      return {
        ...listTabsPayload(kind),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("ai-tabs:switch", (_event, payload) => {
      const kind = safeText(payload?.kind) || "gpt";
      const tabId = safeText(payload?.tabId);
      const workspace = getWorkspace(kind, tabId);
      if (!workspace) {
        throw new Error("目标会话不存在");
      }
      activeTabIdByKind[kind] = workspace.id;
      syncActiveWorkspace(kind);
      emitTabsChanged(kind);
      return {
        ...listTabsPayload(kind),
        activeState: getAiStatePayload(workspace),
      };
    });

    ipcMain.handle("ai-tabs:close", (_event, payload) => {
      const kind = safeText(payload?.kind) || "gpt";
      return closeTabWorkspace(kind, payload?.tabId);
    });

    ipcMain.handle("ai:ensure", async (_event, payload) => {
      const kind = safeText(payload?.kind);
      const requestedTabId = safeText(payload?.tabId);
      if (!requestedTabId && !activeTabIdByKind[kind]) {
        return null;
      }
      const workspace = getOrCreateAiWorkspace(kind, requestedTabId || activeTabIdByKind[kind], {
        lastUrl: safeText(payload?.lastUrl),
      });
      if (!activeTabIdByKind[kind]) {
        activeTabIdByKind[kind] = workspace.id;
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
        workspace.userAgent = userAgent;
        workspace.view.webContents.setUserAgent(userAgent);
      }

      const targetUrl =
        normalizeAiWorkspaceUrl(
          workspace,
          isAllowedUrlForHosts(lastUrl, workspace.policy.allowedHosts)
            ? lastUrl
            : isAllowedUrlForHosts(homeUrl, workspace.policy.allowedHosts)
              ? homeUrl
              : workspace.policy.homeUrl,
        ) || workspace.policy.homeUrl;

      if (!workspace.initialized || !safeText(workspace.view.webContents.getURL())) {
        workspace.initialized = true;
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

    ipcMain.handle("ai:sync-host", (_event, payload) => {
      const kind = safeText(payload?.kind);
      const bounds = payload?.bounds;
      const visible = Boolean(payload?.visible);
      if (hostStateByKind[kind]) {
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
      const kind = safeText(payload?.kind);
      const workspace =
        getWorkspace(kind, safeText(payload?.tabId)) || getWorkspace(kind, activeTabIdByKind[kind]);
      if (!workspace) {
        return { ok: false, reason: "no-workspace" };
      }

      const targetSession = session.fromPartition(workspace.policy.partition);
      const wc = workspace.view.webContents;
      const currentUrl = safeText(wc.getURL()) || workspace.lastUrl || workspace.policy.homeUrl;

      let sessionProxy = "";
      try {
        sessionProxy = safeText(await targetSession.resolveProxy(currentUrl));
      } catch {}
      const sessionProxied = /socks/i.test(sessionProxy);

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
      const viaProxy = (host) => suffixes.some((s) => host === s || host.endsWith(`.${s}`));

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
        sessionProxy,
        sessionProxied,
        proxyCount: hosts.filter((h) => h.via === "proxy").length,
        fallbackCount: hosts.filter((h) => h.via === "fallback").length,
        hosts,
      };
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
          break;
        default:
          break;
      }

      emitTabsChanged(kind);
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
      loadProfileRenderer(profileWindow, query);
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
    applyStableUserDataPath(app);
    appLog.init(app.getPath("userData"));
    const log = appLog.scoped("main");
    // 主进程未捕获异常兜底: 记录日志而非静默崩溃 (写入 userData/logs/main.log)。
    process.on("uncaughtException", (err) => log.error("uncaughtException:", err));
    process.on("unhandledRejection", (reason) => log.error("unhandledRejection:", reason));
    backend = new Backend(app, () => mainWindow, appMode);
    backend.init();

    registerIpc();
    createWindow();
    setupAutoUpdater();

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
