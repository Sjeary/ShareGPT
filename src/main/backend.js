const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { URL } = require("node:url");

const DEFAULT_TARGET_DOMAINS = [
  "chatgpt.com",
  "openai.com",
  "auth0.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "gravatar.com",
  "cloudflare.com",
  "wp.com",
  "gemini.google.com",
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "gvt1.com",
  "googletagmanager.com",
  // Claude (claude.ai 网页): 主站 + Anthropic(含 statsig.anthropic.com) + artifacts/MCP 内容
  // + 错误上报(sentry) + 计费(stripe); 登录/验证走的 google/cloudflare 已在上方。
  "claude.ai",
  "anthropic.com",
  "claudeusercontent.com",
  "claudemcpcontent.com",
  "sentry.io",
  "stripe.com",
  // Claude 页面实际会访问的第三方(由「代理检测」抓取): 验证(hcaptcha)、埋点/监控(datadog)、
  // 广告/统计(doubleclick/facebook)。按需求全部纳入梯子路由, 保证页面流量不回落本机代理/直连。
  "hcaptcha.com",
  "doubleclick.net",
  "datadoghq.com",
  // Datadog 浏览器监控的「intake」是单独注册的域名(整段是一个标签, 非 *.datadoghq.com 子域),
  // domain_suffix 要点边界匹配, 故须精确写出完整域名才能命中。Claude 用 us5 区。
  "browser-intake-us5-datadoghq.com",
  "facebook.net",
  // Claude 内的 Intercom 客服聊天组件 (api-iam / widget / nexus-websocket / cdn)。
  "intercom.io",
  "intercomcdn.com",
  // Claude artifacts / 代码运行加载的 CDN (jsDelivr / esm.sh)。
  "jsdelivr.net",
  "esm.sh",
];

const PUBLIC_DEFAULT_SETTINGS = {
  sender: {
    proxy_server: "",
    proxy_port: "",
    proxy_uuid: "",
    socks_listen_port: "1080",
    fallback_mode: "system_proxy",
    fallback_local_port: "",
    target_domains: DEFAULT_TARGET_DOMAINS.join(","),
  },
  receiver: {
    frps_server: "",
    frps_port: "",
    frps_token: "",
    remote_port: "",
    vmess_listen_port: "",
    vmess_uuid: "",
    forward_proxy_port: "",
    tls_enable: true,
    use_compression: true,
    use_encryption: true,
  },
  collab: {
    server_url: "",
    last_username: "",
    last_avatar: "",
    remember_password: false,
    saved_password: "",
    notify_message_popup: true,
    notify_system_notification: true,
    notify_sound_play: true,
    notify_user_online: false,
    pinned_users: [],
  },
  gpt: {
    partition: "persist:gpt-chat",
    home_url: "https://chatgpt.com/auth/login",
    last_url: "https://chatgpt.com/auth/login",
    proxy_host: "127.0.0.1",
    proxy_port: "1080",
    total_queries: 0,
    query_users: {},
    stats_preset: "30d",
    stats_from: "",
    stats_to: "",
  },
  gemini: {
    partition: "persist:gemini-chat",
    home_url: "https://gemini.google.com/",
    last_url: "https://gemini.google.com/",
    proxy_host: "127.0.0.1",
    proxy_port: "1080",
  },
  ui: {
    setup_guide_dismissed: false,
    theme: "dark",
  },
};

const LOCAL_CHAT_HISTORY_MAX_PER_CONVERSATION = 800;
const LOCAL_CHAT_HISTORY_MAX_TOTAL = 6000;
const UPDATE_BACKUP_KEEP = 5;
const UPDATE_BACKUP_ENTRIES = [
  "settings.json",
  "chat_history.json",
  "private.defaults.local.json",
  "Partitions",
];
const UPDATE_BACKUP_SKIP_NAMES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "ShaderCache",
  "CachedData",
  "Crashpad",
  "logs",
  "updates",
  "runtime",
]);

function mergeSettings(base, override = {}) {
  return {
    sender: { ...base.sender, ...(override.sender || {}) },
    receiver: { ...base.receiver, ...(override.receiver || {}) },
    collab: { ...base.collab, ...(override.collab || {}) },
    gpt: { ...base.gpt, ...(override.gpt || {}) },
    gemini: { ...base.gemini, ...(override.gemini || {}) },
    ui: { ...base.ui, ...(override.ui || {}) },
  };
}

function isWindows() {
  return process.platform === "win32";
}

function currentPlatformDir() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function binaryName(stem) {
  return isWindows() ? `${stem}.exe` : stem;
}

function envBinaryVariable(stem) {
  return stem === "sing-box"
    ? ["SHAREGPT_SINGBOX_PATH"]
    : ["SHAREGPT_FRPC_PATH"];
}

function toInt(value, name) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} 必须是 1~65535 的整数`);
  }
  return n;
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeStoredAttachment(record) {
  const name = String(record?.name || "").trim().slice(0, 200);
  const kind = String(record?.kind || "").trim() === "image" ? "image" : "file";
  const mime = String(record?.mime || "").trim().slice(0, 200);
  const dataUrl = String(record?.dataUrl || "").trim();
  const size = clampPositiveInt(record?.size, 0);

  if (!dataUrl) return null;

  return {
    kind,
    name: name || (kind === "image" ? "image" : "file"),
    mime,
    size,
    dataUrl,
  };
}

function normalizeStoredReplyTarget(record) {
  const id = String(record?.id || "").trim();
  if (!id) return null;

  const preview = String(record?.preview || "").trim().slice(0, 240);
  return {
    id,
    from: String(record?.from || record?.username || "").trim(),
    displayName: String(record?.displayName || record?.username || record?.from || "消息").trim() || "消息",
    preview: preview || "原消息",
    timestamp: String(record?.timestamp || "").trim(),
  };
}

function makeFileSafeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyImportantPath(sourcePath, targetPath, errors, options = {}) {
  const overwrite = options.overwrite !== false;
  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    return;
  }

  try {
    if (stat.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      for (const name of fs.readdirSync(sourcePath)) {
        if (UPDATE_BACKUP_SKIP_NAMES.has(name)) continue;
        copyImportantPath(path.join(sourcePath, name), path.join(targetPath, name), errors, options);
      }
      return;
    }

    if (stat.isFile()) {
      if (!overwrite && fs.existsSync(targetPath)) return;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  } catch (err) {
    errors.push({
      source: sourcePath,
      message: err.message || String(err),
    });
  }
}

function filesDiffer(sourcePath, targetPath) {
  try {
    const sourceStat = fs.statSync(sourcePath);
    const targetStat = fs.statSync(targetPath);
    return sourceStat.size !== targetStat.size || Math.trunc(sourceStat.mtimeMs) !== Math.trunc(targetStat.mtimeMs);
  } catch {
    return true;
  }
}

function pruneOldUpdateBackups(backupRoot) {
  let entries;
  try {
    entries = fs.readdirSync(backupRoot, { withFileTypes: true })
      .filter((item) => item.isDirectory() && item.name.startsWith("update-"))
      .map((item) => {
        const fullPath = path.join(backupRoot, item.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {}
        return { fullPath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return;
  }

  for (const entry of entries.slice(UPDATE_BACKUP_KEEP)) {
    try {
      fs.rmSync(entry.fullPath, { recursive: true, force: true });
    } catch {}
  }
}

function latestUpdateBackupDir(backupRoot) {
  try {
    const entries = fs.readdirSync(backupRoot, { withFileTypes: true })
      .filter((item) => item.isDirectory() && item.name.startsWith("update-"))
      .map((item) => {
        const fullPath = path.join(backupRoot, item.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {}
        return { fullPath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries[0]?.fullPath || "";
  } catch {
    return "";
  }
}

function normalizeStoredForwardedFrom(record) {
  const from = String(record?.from || record?.username || "").trim();
  if (!from) return null;

  return {
    from,
    displayName: String(record?.displayName || record?.username || record?.from || "转发消息").trim() || "转发消息",
  };
}

function normalizeStoredMessage(record) {
  const scope = String(record?.scope || "").trim() === "private" ? "private" : "subnet";
  const recalled = Boolean(record?.recalled);
  const text = String(record?.text || "");
  const attachments = Array.isArray(record?.attachments)
    ? record.attachments.map(normalizeStoredAttachment).filter(Boolean)
    : [];
  const replyTo = normalizeStoredReplyTarget(record?.replyTo);
  const forwardedFrom = normalizeStoredForwardedFrom(record?.forwardedFrom);

  if (!recalled && !String(text || "").trim() && !attachments.length) {
    return null;
  }

  return {
    id: String(record?.id || "").trim(),
    type: String(record?.type || "chat").trim() || "chat",
    scope,
    from: String(record?.from || record?.username || "").trim(),
    to: String(record?.to || "").trim(),
    username: String(record?.username || record?.from || "").trim() || "系统通知",
    displayName: String(record?.displayName || record?.username || record?.from || "").trim() || "系统通知",
    avatar: String(record?.avatar || "").trim(),
    text,
    attachments,
    timestamp: String(record?.timestamp || new Date().toISOString()).trim() || new Date().toISOString(),
    readAt: scope === "private" ? String(record?.readAt || "").trim() : "",
    readBy: scope === "subnet"
      ? (Array.isArray(record?.readBy)
          ? record.readBy
              .map((item) => {
                const username = String(item?.username || item?.from || "").trim();
                if (!username) return null;
                return {
                  username,
                  displayName: String(item?.displayName || item?.username || item?.from || "").trim() || username,
                  readAt: String(item?.readAt || item?.timestamp || "").trim() || new Date().toISOString(),
                };
              })
              .filter(Boolean)
          : [])
      : [],
    edited: Boolean(record?.edited),
    editedAt: Boolean(record?.edited) ? (String(record?.editedAt || "").trim() || new Date().toISOString()) : "",
    subnetKey: String(record?.subnetKey || "").trim(),
    subnetLabel: String(record?.subnetLabel || record?.roomScope || "").trim(),
    system: Boolean(record?.system),
    replyTo,
    forwardedFrom,
    recalled,
    recalledAt: recalled ? (String(record?.recalledAt || new Date().toISOString()).trim() || new Date().toISOString()) : "",
  };
}

function normalizeChatHistoryStore(store) {
  const input = store && typeof store === "object" ? store : {};
  const conversations = input.conversations && typeof input.conversations === "object"
    ? input.conversations
    : {};

  const normalizedConversations = {};
  let total = 0;

  for (const [key, value] of Object.entries(conversations)) {
    const conversationKey = String(key || "").trim();
    if (!conversationKey) continue;

    const items = Array.isArray(value) ? value.map(normalizeStoredMessage).filter(Boolean) : [];
    if (!items.length) continue;

    if (items.length > LOCAL_CHAT_HISTORY_MAX_PER_CONVERSATION) {
      items.splice(0, items.length - LOCAL_CHAT_HISTORY_MAX_PER_CONVERSATION);
    }

    normalizedConversations[conversationKey] = items;
    total += items.length;
  }

  if (total > LOCAL_CHAT_HISTORY_MAX_TOTAL) {
    const buckets = Object.entries(normalizedConversations)
      .flatMap(([key, items]) => items.map((message) => ({ key, message })))
      .sort((a, b) => String(a.message.timestamp).localeCompare(String(b.message.timestamp)));

    const overflow = total - LOCAL_CHAT_HISTORY_MAX_TOTAL;
    let removed = 0;
    const dropped = new Map();
    for (const item of buckets) {
      if (removed >= overflow) break;
      dropped.set(item.key, (dropped.get(item.key) || 0) + 1);
      removed += 1;
    }

    for (const [key, count] of dropped.entries()) {
      normalizedConversations[key] = normalizedConversations[key].slice(count);
      if (!normalizedConversations[key].length) {
        delete normalizedConversations[key];
      }
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    conversations: normalizedConversations,
  };
}

class Backend {
  constructor(app, getWindow, appMode = "all") {
    this.app = app;
    this.getWindow = getWindow;
    this.appMode = appMode;

    this.settingsFile = path.join(this.app.getPath("userData"), "settings.json");
    this.chatHistoryFile = path.join(this.app.getPath("userData"), "chat_history.json");
    this.runtimeDir = path.join(this.app.getPath("userData"), "runtime");
    this.updatesDir = path.join(this.app.getPath("downloads"), "ShareGPT Updates");
    this.updateBackupsDir = path.join(this.app.getPath("appData"), "ShareGPT Backups");

    this.senderProcess = null;
    this.receiverFrpc = null;
    this.receiverSingbox = null;
  }

  resolvePrivateDefaultsCandidates() {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = path.dirname(this.app.getPath("exe"));
    const userDataFile = path.join(this.app.getPath("userData"), "private.defaults.local.json");

    if (this.app.isPackaged) {
      return [
        path.join(appDir, "private.defaults.local.json"),
        userDataFile,
      ];
    }

    return [
      path.join(repoRoot, "private.defaults.local.json"),
      userDataFile,
    ];
  }

  loadPrivateDefaults() {
    for (const candidate of this.resolvePrivateDefaultsCandidates()) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        return mergeSettings(PUBLIC_DEFAULT_SETTINGS, raw);
      } catch {
        return structuredClone(PUBLIC_DEFAULT_SETTINGS);
      }
    }

    return structuredClone(PUBLIC_DEFAULT_SETTINGS);
  }

  resolveExampleDefaultsCandidates() {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = path.dirname(this.app.getPath("exe"));
    const userDataDir = this.app.getPath("userData");

    return [
      path.join(repoRoot, "private.defaults.local.example.json"),
      path.join(appDir, "private.defaults.local.example.json"),
      path.join(userDataDir, "private.defaults.local.example.json"),
    ];
  }

  ensureLocalDefaultsFile() {
    const existing = this.resolvePrivateDefaultsCandidates().find((candidate) => fs.existsSync(candidate));
    if (existing) return;

    const userDataFile = path.join(this.app.getPath("userData"), "private.defaults.local.json");
    let template = structuredClone(PUBLIC_DEFAULT_SETTINGS);

    for (const candidate of this.resolveExampleDefaultsCandidates()) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        template = mergeSettings(PUBLIC_DEFAULT_SETTINGS, raw);
        break;
      } catch {
        template = structuredClone(PUBLIC_DEFAULT_SETTINGS);
        break;
      }
    }

    fs.writeFileSync(userDataFile, JSON.stringify(template, null, 2), "utf-8");
  }

  init() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    fs.mkdirSync(this.updatesDir, { recursive: true });
    fs.mkdirSync(this.updateBackupsDir, { recursive: true });
    this.restoreMissingDataFromLatestUpdateBackup();
    this.ensureLocalDefaultsFile();
    this.ensureChatHistoryFile();
  }

  restoreMissingDataFromLatestUpdateBackup() {
    const backupDir = latestUpdateBackupDir(this.updateBackupsDir);
    if (!backupDir) return null;

    const userDataDir = this.app.getPath("userData");
    const restored = [];
    const errors = [];

    for (const entryName of UPDATE_BACKUP_ENTRIES) {
      const sourcePath = path.join(backupDir, entryName);
      const targetPath = path.join(userDataDir, entryName);
      if (!fs.existsSync(sourcePath)) continue;

      const before = fs.existsSync(targetPath);
      copyImportantPath(sourcePath, targetPath, errors, { overwrite: false });
      const after = fs.existsSync(targetPath);
      if (!before && after) {
        restored.push(entryName);
      }
    }

    if (restored.length || errors.length) {
      const report = {
        checkedAt: new Date().toISOString(),
        sourceBackup: backupDir,
        restored,
        errors,
      };
      try {
        fs.writeFileSync(path.join(userDataDir, "update_restore_report.json"), JSON.stringify(report, null, 2), "utf-8");
      } catch {}
      return report;
    }

    return null;
  }

  log(source, line) {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("log:line", { source, line });
    }
  }

  resolveBinary(stem) {
    const filename = binaryName(stem);
    const repoRoot = path.resolve(__dirname, "../..");
    const platformDir = currentPlatformDir();
    const envVars = envBinaryVariable(stem);
    const configuredPath = envVars.map((name) => String(process.env[name] || "").trim()).find(Boolean) || "";
    const configuredDir = String(process.env.SHAREGPT_BIN_DIR || "").trim();
    const appDir = path.dirname(this.app.getPath("exe"));
    const appPath = this.app.getAppPath();
    const packagedResourceRoots = [
      String(process.resourcesPath || "").trim(),
      path.join(appDir, "resources"),
      appPath ? path.dirname(appPath) : "",
    ].filter(Boolean);
    const persistedBinDir = path.join(this.app.getPath("userData"), "bundled-bin");
    const persistedCandidate = path.join(persistedBinDir, filename);

    const configuredCandidates = [];
    if (configuredPath) {
      configuredCandidates.push(path.resolve(configuredPath));
    }
    if (configuredDir) {
      configuredCandidates.push(
        path.resolve(configuredDir, platformDir, filename),
        path.resolve(configuredDir, filename),
      );
    }

    const bundledPackagedCandidates = [
      ...packagedResourceRoots.flatMap((root) => [
        path.join(root, "bin", filename),
        path.join(root, "bin", platformDir, filename),
      ]),
      path.join(appDir, "bin", filename),
      path.join(appDir, filename),
    ];

    if (this.app.isPackaged && !configuredPath && !configuredDir) {
      for (const bundledCandidate of bundledPackagedCandidates) {
        if (!fs.existsSync(bundledCandidate)) continue;
        try {
          fs.mkdirSync(persistedBinDir, { recursive: true });
          if (!fs.existsSync(persistedCandidate) || filesDiffer(bundledCandidate, persistedCandidate)) {
            fs.copyFileSync(bundledCandidate, persistedCandidate);
            if (!isWindows()) {
              fs.chmodSync(persistedCandidate, 0o755);
            }
          }
          return persistedCandidate;
        } catch (err) {
          this.log("app", `复制内置二进制失败（${filename}）：${err.message || err}`);
          return bundledCandidate;
        }
      }
    }

    const candidates = this.app.isPackaged
      ? [
          ...configuredCandidates,
          persistedCandidate,
          ...bundledPackagedCandidates,
        ]
      : [
          ...configuredCandidates,
          path.join(repoRoot, "build", "bin", platformDir, filename),
          path.join(repoRoot, "build", "bin", filename),
        ];

    const uniqueCandidates = [...new Set(candidates.map((candidate) => path.resolve(candidate)))];

    for (const candidate of uniqueCandidates) {
      if (fs.existsSync(candidate)) {
        if (!isWindows()) {
          fs.chmodSync(candidate, 0o755);
        }
        return candidate;
      }
    }

    return uniqueCandidates[0];
  }

  loadSettings() {
    const defaultSettings = this.loadPrivateDefaults();
    if (!fs.existsSync(this.settingsFile)) {
      return structuredClone(defaultSettings);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, "utf-8"));
      return mergeSettings(defaultSettings, raw);
    } catch {
      return structuredClone(defaultSettings);
    }
  }

  saveSettings(data) {
    const merged = mergeSettings(this.loadPrivateDefaults(), data);
    fs.writeFileSync(this.settingsFile, JSON.stringify(merged, null, 2), "utf-8");
    return merged;
  }

  ensureChatHistoryFile() {
    if (!fs.existsSync(this.chatHistoryFile)) {
      fs.writeFileSync(this.chatHistoryFile, JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        conversations: {},
      }, null, 2), "utf-8");
    }
  }

  loadChatHistory() {
    this.ensureChatHistoryFile();
    try {
      const raw = JSON.parse(fs.readFileSync(this.chatHistoryFile, "utf-8"));
      return normalizeChatHistoryStore(raw);
    } catch {
      return normalizeChatHistoryStore({});
    }
  }

  saveChatHistory(data) {
    const normalized = normalizeChatHistoryStore(data);
    fs.writeFileSync(this.chatHistoryFile, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  }

  async exportUserData() {
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;

    const result = await dialog.showSaveDialog(window, {
      title: "导出本机资料包",
      defaultPath: path.join(this.app.getPath("documents"), `sharegpt-data-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: "ShareGPT 数据包", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePath) return null;

    const payload = {
      format: "sharegpt-user-data",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.loadSettings(),
      chatHistory: this.loadChatHistory(),
    };

    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { filePath: result.filePath };
  }

  async importUserData() {
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: "导入本机资料包",
      filters: [{ name: "ShareGPT 数据包", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
      const filePath = result.filePaths[0];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const settings = this.saveSettings(raw?.settings || {});
      const chatHistory = this.saveChatHistory(raw?.chatHistory || {});
      return { settings, chatHistory, filePath };
    } catch (err) {
      throw new Error(`无法导入资料包: ${err.message}`);
    }
  }

  createUpdateBackup(reason = "manual") {
    const userDataDir = this.app.getPath("userData");
    const backupRoot = this.updateBackupsDir;
    const backupName = `update-${makeFileSafeTimestamp()}`;
    const backupDir = path.join(backupRoot, backupName);
    const errors = [];

    fs.mkdirSync(backupDir, { recursive: true });

    for (const entryName of UPDATE_BACKUP_ENTRIES) {
      const sourcePath = path.join(userDataDir, entryName);
      const targetPath = path.join(backupDir, entryName);
      copyImportantPath(sourcePath, targetPath, errors);
    }

    const manifest = {
      app: this.app.getName(),
      version: this.app.getVersion(),
      reason: String(reason || "manual"),
      createdAt: new Date().toISOString(),
      userDataDir,
      backupDir,
      entries: UPDATE_BACKUP_ENTRIES,
      skippedNames: Array.from(UPDATE_BACKUP_SKIP_NAMES),
      errors,
    };
    fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    pruneOldUpdateBackups(backupRoot);

    if (errors.length) {
      throw new Error(`更新前资料备份未完全成功，已停止打开安装包。备份目录：${backupDir}`);
    }

    return {
      backupDir,
      errors,
    };
  }

  async importSettings() {
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;
    
    const result = await dialog.showOpenDialog(window, {
      title: "导入本地配置文件",
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
      properties: ["openFile"]
    });

    if (result.canceled || !result.filePaths.length) return null;

    try {
      const filePath = result.filePaths[0];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return this.saveSettings(raw);
    } catch (err) {
      throw new Error(`无法装载该文件: ${err.message}`);
    }
  }

  getPaths() {
    const includeReceiver = this.appMode === "all" || this.appMode === "receiver";
    return {
      singbox: this.resolveBinary("sing-box"),
      frpc: includeReceiver ? this.resolveBinary("frpc") : "",
      runtimeDir: this.runtimeDir,
      updatesDir: this.updatesDir,
      updateBackupsDir: this.updateBackupsDir,
      userDataDir: this.app.getPath("userData"),
      settingsFile: this.settingsFile,
      chatHistoryFile: this.chatHistoryFile,
    };
  }

  getAppMeta() {
    return {
      name: this.app.getName(),
      version: this.app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      mode: this.appMode,
      userDataDir: this.app.getPath("userData"),
    };
  }

  sanitizeUpdateFileName(rawName, fallbackExt = "") {
    const source = String(rawName || "").trim();
    const cleaned = path.basename(source).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
    if (cleaned) return cleaned;
    return `ShareGPT-update${fallbackExt}`;
  }

  resolveUpdateDownloadTarget(rawUrl, preferredName = "", version = "") {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || "").trim());
    } catch {
      throw new Error("更新链接无效");
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error("更新链接仅支持 http/https");
    }

    const ext = path.extname(parsed.pathname || "");
    const originalName = this.sanitizeUpdateFileName(preferredName || path.basename(parsed.pathname || ""), ext);
    const originalExt = path.extname(originalName) || ext;
    const originalBase = path.basename(originalName, originalExt);
    const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
    const fileName = this.sanitizeUpdateFileName(`${originalBase}-${stamp}${originalExt}`, originalExt);
    const versionText = String(version || "").trim();
    const versionDir = versionText
      ? this.sanitizeUpdateFileName(`v${versionText}`, "")
      : "manual";
    return {
      url: parsed,
      filePath: path.join(this.updatesDir, versionDir, fileName),
    };
  }

  async downloadUpdatePackage(payload = {}, onProgress = null) {
    fs.mkdirSync(this.updatesDir, { recursive: true });
    const { url, filePath } = this.resolveUpdateDownloadTarget(payload?.url, payload?.fileName, payload?.version);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const protocol = url.protocol === "https:" ? https : http;
    const emitProgress = typeof onProgress === "function" ? onProgress : () => {};

    return new Promise((resolve, reject) => {
      const request = protocol.get(url, (response) => {
        const status = Number(response.statusCode || 0);

        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          this.downloadUpdatePackage({
            ...payload,
            url: new URL(response.headers.location, url).toString(),
          }, onProgress).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`下载更新失败（${status}）`));
          return;
        }

        const tempPath = `${filePath}.download`;
        const output = fs.createWriteStream(tempPath);
        const total = Number.parseInt(String(response.headers["content-length"] || "0"), 10) || 0;
        let transferred = 0;
        emitProgress({
          phase: "download",
          fileName: path.basename(filePath),
          transferred,
          total,
          percent: 0,
        });

        output.on("error", (err) => {
          response.destroy();
          try { fs.unlinkSync(tempPath); } catch {}
          reject(err);
        });

        response.on("error", (err) => {
          output.destroy(err);
        });

        response.on("data", (chunk) => {
          transferred += chunk.length;
          emitProgress({
            phase: "download",
            fileName: path.basename(filePath),
            transferred,
            total,
            percent: total ? Math.min(100, Math.round((transferred / total) * 100)) : 0,
          });
        });

        output.on("finish", () => {
          output.close(() => {
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              fs.renameSync(tempPath, filePath);
              emitProgress({
                phase: "download",
                fileName: path.basename(filePath),
                transferred,
                total: total || transferred,
                percent: 100,
                done: true,
              });
              resolve({
                filePath,
                fileName: path.basename(filePath),
                size: fs.statSync(filePath).size,
              });
            } catch (err) {
              try { fs.unlinkSync(tempPath); } catch {}
              reject(err);
            }
          });
        });

        response.pipe(output);
      });

      request.on("error", reject);
      request.setTimeout(120000, () => {
        request.destroy(new Error("下载更新超时"));
      });
    });
  }

  getDeviceInfo() {
    const interfaces = os.networkInterfaces();
    const ipv4List = [];

    for (const records of Object.values(interfaces)) {
      if (!Array.isArray(records)) continue;
      for (const item of records) {
        if (!item) continue;
        if (item.family !== "IPv4") continue;
        if (item.internal) continue;
        ipv4List.push(item.address);
      }
    }

    const uniqueIpv4 = [...new Set(ipv4List)];

    return {
      hostname: os.hostname(),
      ipv4List: uniqueIpv4,
      preferredIpv4: uniqueIpv4[0] || "127.0.0.1",
    };
  }

  getStatus() {
    return {
      senderRunning: !!this.senderProcess,
      receiverFrpcRunning: !!this.receiverFrpc,
      receiverSingboxRunning: !!this.receiverSingbox,
    };
  }

  spawnProcess(source, cmd, args) {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // 兼容较新版 sing-box(1.11+/1.12+): 允许 legacy special outbounds(dns/block tag),
        // 否则新版启动时会 FATAL 退出(旧版会忽略此变量, 跨平台安全)。
        // 注: Win 端内置 sing-box 版本较旧, mac 上常装到 1.12.x; 此标志让两端一致可用。
        ENABLE_DEPRECATED_SPECIAL_OUTBOUNDS: "true",
      },
    });

    child.stdout.on("data", (buf) => {
      this.log(source, String(buf).trim());
    });

    child.stderr.on("data", (buf) => {
      this.log(source, String(buf).trim());
    });

    child.on("exit", (code) => {
      this.log(source, `进程退出，code=${code}`);
      if (source === "sender") this.senderProcess = null;
      if (source === "receiver-frpc") this.receiverFrpc = null;
      if (source === "receiver-singbox") this.receiverSingbox = null;
      this.emitStatus();
    });

    return child;
  }

  emitStatus() {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("service:status", this.getStatus());
    }
  }

  stopChild(child, source) {
    if (!child) return;
    try {
      child.kill();
      this.log(source, "已停止");
    } catch (err) {
      this.log(source, `停止失败: ${err.message}`);
    }
  }

  stopSender() {
    this.stopChild(this.senderProcess, "sender");
    this.senderProcess = null;
    this.emitStatus();
  }

  stopReceiver() {
    this.stopChild(this.receiverFrpc, "receiver-frpc");
    this.stopChild(this.receiverSingbox, "receiver-singbox");
    this.receiverFrpc = null;
    this.receiverSingbox = null;
    this.emitStatus();
  }

  stopAll() {
    this.stopSender();
    this.stopReceiver();
  }

  buildSenderConfig(sender) {
    const proxyPort = toInt(sender.proxy_port, "公网端口");
    const listenPort = toInt(sender.socks_listen_port, "本地SOCKS监听端口");
    const fallbackMode = sender.fallback_mode === "direct" ? "direct" : "system_proxy";
    // 测试用「全部流量走代理」: 除私有 IP 直连外, 所有流量(含 DNS)都走 proxy(梯子),
    // 不再只走 target_domains 清单。用于抓取页面到底访问了哪些域名 (仅管理员可开)。
    const routeAll =
      sender.route_all === true || sender.route_all === "1" || sender.route_all === "true";

    // 本机自动加入的额外域名 (代理检测自动累积), 与内置清单合并。
    const autoDomains = Array.isArray(sender.auto_domains) ? sender.auto_domains : [];
    const domainsRaw =
      this.appMode === "sender"
        ? [...DEFAULT_TARGET_DOMAINS, ...autoDomains].join(",")
        : String(sender.target_domains || "");

    const domains = String(domainsRaw)
      .replace(/\n/g, ",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const uniqueDomains = [...new Set(domains)];
    const domainSuffix = uniqueDomains.map((d) => d.replace(/^\./, ""));

    const outbounds = [
      {
        type: "vmess",
        tag: "proxy",
        server: String(sender.proxy_server || "").trim(),
        server_port: proxyPort,
        uuid: String(sender.proxy_uuid || "").trim(),
        packet_encoding: "packetaddr",
        transport: {
          type: "ws",
          path: "",
          max_early_data: 2048,
          early_data_header_name: "Sec-WebSocket-Protocol",
        },
      },
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
      { type: "dns", tag: "dns_out" },
    ];

    if (fallbackMode === "system_proxy") {
      outbounds.splice(1, 0, {
        type: "socks",
        tag: "system_proxy",
        server: "127.0.0.1",
        server_port: toInt(sender.fallback_local_port, "本机代理端口"),
      });
    }

    const config = {
      log: { level: "info", timestamp: true },
      dns: {
        servers: [
          {
            tag: "dns_proxy",
            address: "https://1.1.1.1/dns-query",
            address_resolver: "dns_resolver",
            strategy: "ipv4_only",
            detour: "proxy",
          },
          {
            tag: "dns_direct",
            address: "https://dns.alidns.com/dns-query",
            address_resolver: "dns_resolver",
            strategy: "ipv4_only",
            detour: "direct",
          },
          { tag: "dns_local", address: "local" },
          {
            tag: "dns_resolver",
            address: "223.5.5.5",
            strategy: "ipv4_only",
            detour: "direct",
          },
        ],
        rules: [
          { outbound: "dns_resolver", server: "dns_resolver" },
          { clash_mode: "direct", server: "dns_direct" },
          { clash_mode: "global", server: "dns_proxy" },
          ...(domainSuffix.length ? [{ domain_suffix: domainSuffix, server: "dns_proxy" }] : []),
        ],
        final: routeAll ? "dns_proxy" : fallbackMode === "direct" ? "dns_local" : "dns_direct",
      },
      inbounds: [
        {
          type: "socks",
          tag: "socks",
          listen: "127.0.0.1",
          listen_port: listenPort,
          sniff: true,
          sniff_override_destination: true,
        },
      ],
      outbounds,
      route: {
        rules: [
          { protocol: "dns", outbound: "dns_out" },
          // 全部走代理时不需要域名清单规则; 否则按 target_domains 命中走 proxy。
          ...(routeAll || !uniqueDomains.length
            ? []
            : [
                {
                  domain: uniqueDomains,
                  domain_suffix: domainSuffix,
                  outbound: "proxy",
                },
              ]),
          { ip_is_private: true, outbound: "direct" },
          { outbound: routeAll ? "proxy" : fallbackMode },
        ],
        final: routeAll ? "proxy" : fallbackMode,
        auto_detect_interface: true,
      },
    };

    return config;
  }

  buildReceiverFiles(receiver) {
    const cfg = {
      log: { level: "info", timestamp: true },
      inbounds: [
        {
          type: "vmess",
          tag: "vmess_in",
          listen: "::",
          listen_port: toInt(receiver.vmess_listen_port, "VMess监听端口"),
          users: [{ uuid: String(receiver.vmess_uuid || "").trim() }],
          transport: {
            type: "ws",
            path: "",
            max_early_data: 2048,
            early_data_header_name: "Sec-WebSocket-Protocol",
          },
        },
      ],
      outbounds: [
        {
          type: "socks",
          tag: "forward",
          server: "127.0.0.1",
          server_port: toInt(receiver.forward_proxy_port, "转发端口"),
        },
      ],
      route: { final: "forward", auto_detect_interface: true },
    };

    const frpcIni = [
      "[common]",
      `server_addr = ${String(receiver.frps_server || "").trim()}`,
      `server_port = ${toInt(receiver.frps_port, "FRPS端口")}`,
      `token = ${String(receiver.frps_token || "").trim()}`,
      `tls_enable = ${receiver.tls_enable ? "true" : "false"}`,
      "",
      "[vmess-ws]",
      "type = tcp",
      "local_ip = 127.0.0.1",
      `local_port = ${toInt(receiver.vmess_listen_port, "VMess监听端口")}`,
      `remote_port = ${toInt(receiver.remote_port, "远程端口")}`,
      `use_encryption = ${receiver.use_encryption ? "true" : "false"}`,
      `use_compression = ${receiver.use_compression ? "true" : "false"}`,
      "",
    ].join(os.EOL);

    return { singbox: cfg, frpcIni };
  }

  startSender(settings) {
    this.stopSender();

    const singboxPath = this.resolveBinary("sing-box");
    if (!fs.existsSync(singboxPath)) {
        throw new Error(`未找到 sing-box: ${singboxPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_SINGBOX_PATH 指定。`);
    }

    const config = this.buildSenderConfig(settings);
    const configPath = path.join(this.runtimeDir, "sender.runtime.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    this.senderProcess = this.spawnProcess("sender", singboxPath, ["run", "-c", configPath]);
    this.log("sender", `使用配置: ${configPath}`);
    this.emitStatus();

    return { configPath, binary: singboxPath };
  }

  startReceiver(settings) {
    this.stopReceiver();

    const singboxPath = this.resolveBinary("sing-box");
    const frpcPath = this.resolveBinary("frpc");

    if (!fs.existsSync(singboxPath)) {
      throw new Error(`未找到 sing-box: ${singboxPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_SINGBOX_PATH 指定。`);
    }
    if (!fs.existsSync(frpcPath)) {
      throw new Error(`未找到 frpc: ${frpcPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_FRPC_PATH 指定。`);
    }

    const { singbox, frpcIni } = this.buildReceiverFiles(settings);
    const singboxCfgPath = path.join(this.runtimeDir, "receiver.singbox.runtime.json");
    const frpcCfgPath = path.join(this.runtimeDir, "receiver.frpc.runtime.ini");

    fs.writeFileSync(singboxCfgPath, JSON.stringify(singbox, null, 2), "utf-8");
    fs.writeFileSync(frpcCfgPath, frpcIni, "utf-8");

    this.receiverSingbox = this.spawnProcess("receiver-singbox", singboxPath, ["run", "-c", singboxCfgPath]);
    this.receiverFrpc = this.spawnProcess("receiver-frpc", frpcPath, ["-c", frpcCfgPath]);

    this.log("receiver", `sing-box 配置: ${singboxCfgPath}`);
    this.log("receiver", `frpc 配置: ${frpcCfgPath}`);
    this.emitStatus();

    return {
      singboxConfigPath: singboxCfgPath,
      frpcConfigPath: frpcCfgPath,
      singboxBinary: singboxPath,
      frpcBinary: frpcPath,
    };
  }
}

module.exports = {
  Backend,
  DEFAULT_SETTINGS: PUBLIC_DEFAULT_SETTINGS,
  PUBLIC_DEFAULT_SETTINGS,
  DEFAULT_TARGET_DOMAINS,
};
