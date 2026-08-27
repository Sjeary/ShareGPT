const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const os = require("node:os");
const { URL } = require("node:url");
const { VaultManager } = require("./vault");
const { createNotesAi } = require("./notesAi");
const {
  DEFAULT_BROWSER_PRIVACY_SETTINGS,
  normalizeBrowserPrivacySettings,
} = require("./browserPrivacy");
const {
  hasCompleteUnifiedProxy,
  internalAiProxyRoutes,
  normalizeAiEnvironmentId,
  validateAiRouteIsolation,
} = require("./aiEnvironments");
const {
  LOCAL_PRINCIPAL_ID,
  normalizePrincipalId,
  normalizePrincipalUsername,
  normalizeServerBaseUrl,
  principalIdFor,
} = require("./principal");

// 自动更新源 = GitHub Releases (参考 cc-switch 的做法)。仓库地址从 package.json 推导,
// fork 的人只要改 package.json 的 homepage/repository 就指向自己的仓库, 不写死任何自建服务器。
function deriveUpdateRepo() {
  try {
    const pkg = require("../../package.json");
    const src = String(
      pkg.homepage || (pkg.repository && (pkg.repository.url || pkg.repository)) || "",
    );
    const m = src.match(/github\.com[/:]+([^/]+\/[^/.\s]+)/i);
    return m ? m[1] : "";
  } catch (_err) {
    return "";
  }
}
const UPDATE_REPO = deriveUpdateRepo();

const DEFAULT_TARGET_DOMAINS = [
  "chatgpt.com",
  "openai.com",
  "auth0.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "gravatar.com",
  "cloudflare.com",
  // 设置页用它查询代理出口的时区与城市级位置；必须经发送代理，不能回落真实出口。
  "ipwho.is",
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
  // 自动更新(GitHub Releases)的检查/下载也经代理出口, 避免国内直连 GitHub CDN 失败。
  "github.com",
  "githubusercontent.com",
];

const DEFAULT_TRANSLATION_SETTINGS = {
  version: 1,
  provider: "ai",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  siteLanguage: "en",
  confirmNonTargetSend: true,
  autoTranslateSelection: false,
  ai: { baseUrl: "", apiKey: "", model: "gpt-5.5", effort: "medium" },
  api: { baseUrl: "", apiKey: "" },
  offline: { baseUrl: "http://127.0.0.1:5000" },
};

const PUBLIC_DEFAULT_SETTINGS = {
  settingsRevision: 0,
  sender: {
    proxy_server: "",
    proxy_port: "",
    proxy_uuid: "",
    proxy_expected_ip: "",
    proxy_expected_country: "",
    proxy_expected_asn: "",
    socks_listen_port: "1080",
    fallback_mode: "system_proxy",
    fallback_local_port: "",
    target_domains: DEFAULT_TARGET_DOMAINS.join(","),
    managed_proxy_routes: [],
    authorized_proxy_route_ids: undefined,
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
    // 默认安静: 不主动弹应用内消息弹窗 / 不放提示音 (避免打扰新用户)。
    // 用户可在「账户 → 协作通知」里自行打开 (新手引导里也有说明)。
    notify_message_popup: false,
    notify_system_notification: true,
    notify_sound_play: false,
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
  claude: {
    partition: "persist:claude-chat",
    home_url: "https://claude.ai/",
    last_url: "https://claude.ai/",
    proxy_host: "127.0.0.1",
    proxy_port: "1080",
  },
  browserPrivacy: structuredClone(DEFAULT_BROWSER_PRIVACY_SETTINGS),
  advancedAi: {
    version: 1,
    initialized: false,
    enabled: false,
    environments: [],
    activeByKind: { gpt: "", gemini: "", claude: "" },
  },
  translation: structuredClone(DEFAULT_TRANSLATION_SETTINGS),
  principalSettings: null,
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
  "settings.json.bak",
  "chat_history.json",
  "calendar.json",
  "tasks.json",
  "focus.json",
  "private.defaults.local.json",
  "ShareGPT-Vault",
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

function normalizeTranslationSettings(raw, legacyNotesAi) {
  const value = raw && typeof raw === "object" ? raw : {};
  const legacy = legacyNotesAi && typeof legacyNotesAi === "object" ? legacyNotesAi : {};
  const provider = ["ai", "api", "offline"].includes(String(value.provider))
    ? String(value.provider)
    : DEFAULT_TRANSLATION_SETTINGS.provider;
  return {
    ...DEFAULT_TRANSLATION_SETTINGS,
    ...value,
    version: 1,
    provider,
    confirmNonTargetSend: value.confirmNonTargetSend !== false,
    autoTranslateSelection: value.autoTranslateSelection === true,
    ai: { ...DEFAULT_TRANSLATION_SETTINGS.ai, ...legacy, ...(value.ai || {}) },
    api: { ...DEFAULT_TRANSLATION_SETTINGS.api, ...(value.api || {}) },
    offline: { ...DEFAULT_TRANSLATION_SETTINGS.offline, ...(value.offline || {}) },
  };
}

function writeJsonAtomic(file, payload) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const backup = `${file}.bak`;
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(temp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

const ENCRYPTED_SECRET_PREFIX = "sharegpt-safe:v1:";
const SECRET_KEY_PATTERN =
  /(?:password|passwd|api.?key|secret|token|uuid|private.?key|credential)/i;
const SECRET_STORAGE_UNAVAILABLE = "SETTINGS_SECRET_STORAGE_UNAVAILABLE";
const SECRET_DECRYPTION_FAILED = "SETTINGS_SECRET_DECRYPTION_FAILED";
const DEFAULT_SAFE_STORAGE = Symbol("default-safe-storage");

/** @typedef {{ decryptString: (value: Buffer) => string, encryptString: (value: string) => Buffer }} SecretStorage */

function getSafeStorage() {
  if (!process.versions.electron) return null;
  try {
    const electron = require("electron");
    return electron?.safeStorage?.isEncryptionAvailable?.() ? electron.safeStorage : null;
  } catch {
    return null;
  }
}

function secretStorageError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function isSecretStorageError(error) {
  return error?.code === SECRET_STORAGE_UNAVAILABLE || error?.code === SECRET_DECRYPTION_FAILED;
}

/**
 * @param {unknown} value
 * @param {"encrypt" | "decrypt"} mode
 * @param {string} [key]
 * @param {SecretStorage | null | typeof DEFAULT_SAFE_STORAGE} [storageOverride]
 * @returns {any}
 */
function transformSensitiveValues(value, mode, key = "", storageOverride = DEFAULT_SAFE_STORAGE) {
  /** @type {SecretStorage | null} */
  const storage =
    storageOverride === DEFAULT_SAFE_STORAGE
      ? getSafeStorage()
      : /** @type {SecretStorage | null} */ (storageOverride);
  if (Array.isArray(value)) {
    return value.map((item) => transformSensitiveValues(item, mode, "", storage));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        transformSensitiveValues(childValue, mode, childKey, storage),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (mode === "decrypt" && value.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    if (!storage) {
      throw secretStorageError(
        SECRET_STORAGE_UNAVAILABLE,
        "系统凭据存储暂时不可用，已阻止读取和覆盖加密设置",
      );
    }
    try {
      return storage.decryptString(
        Buffer.from(value.slice(ENCRYPTED_SECRET_PREFIX.length), "base64"),
      );
    } catch (error) {
      throw secretStorageError(
        SECRET_DECRYPTION_FAILED,
        "加密设置暂时无法解密，已阻止覆盖原始数据",
        error,
      );
    }
  }
  if (mode === "encrypt" && value && SECRET_KEY_PATTERN.test(key) && storage) {
    if (value.startsWith(ENCRYPTED_SECRET_PREFIX)) return value;
    return `${ENCRYPTED_SECRET_PREFIX}${storage.encryptString(value).toString("base64")}`;
  }
  return value;
}

function mergeSettings(base, override = {}) {
  const basePrivacy = base.browserPrivacy || DEFAULT_BROWSER_PRIVACY_SETTINGS;
  const overridePrivacy = override.browserPrivacy || {};
  return {
    settingsRevision: Math.max(
      0,
      Number.parseInt(String(override.settingsRevision ?? base.settingsRevision ?? 0), 10) || 0,
    ),
    sender: { ...base.sender, ...(override.sender || {}) },
    receiver: { ...base.receiver, ...(override.receiver || {}) },
    collab: { ...base.collab, ...(override.collab || {}) },
    gpt: { ...base.gpt, ...(override.gpt || {}) },
    gemini: { ...base.gemini, ...(override.gemini || {}) },
    claude: { ...(base.claude || {}), ...(override.claude || {}) },
    browserPrivacy: normalizeBrowserPrivacySettings({
      ...basePrivacy,
      ...overridePrivacy,
      environment: {
        ...(basePrivacy.environment || {}),
        ...(overridePrivacy.environment || {}),
      },
      lastClearedAt: {
        ...(basePrivacy.lastClearedAt || {}),
        ...(overridePrivacy.lastClearedAt || {}),
      },
    }),
    advancedAi: {
      ...(base.advancedAi || {}),
      ...(override.advancedAi || {}),
      environments: Array.isArray(override.advancedAi?.environments)
        ? override.advancedAi.environments
        : base.advancedAi?.environments || [],
      activeByKind: {
        ...(base.advancedAi?.activeByKind || {}),
        ...(override.advancedAi?.activeByKind || {}),
      },
    },
    translation: normalizeTranslationSettings(
      override.translation || (override.notesAi ? undefined : base.translation),
      override.notesAi,
    ),
    principalSettings:
      override.principalSettings && typeof override.principalSettings === "object"
        ? structuredClone(override.principalSettings)
        : null,
    ui: { ...base.ui, ...(override.ui || {}) },
  };
}

function redactSettingsForExport(settings) {
  const value = structuredClone(settings || {});
  value.sender = {
    ...(value.sender || {}),
    proxy_uuid: "",
    airport_outbound: null,
    managed_proxy_routes: (Array.isArray(value.sender?.managed_proxy_routes)
      ? value.sender.managed_proxy_routes
      : []
    ).map((route) => ({
      id: route?.id,
      name: route?.name,
      enabled: route?.enabled !== false,
      expected: route?.expected || {},
      credentialExcluded: true,
    })),
  };
  value.receiver = {
    ...(value.receiver || {}),
    frps_token: "",
    vmess_uuid: "",
  };
  value.collab = {
    ...(value.collab || {}),
    remember_password: false,
    saved_password: "",
  };
  value.translation = {
    ...(value.translation || {}),
    ai: { ...(value.translation?.ai || {}), apiKey: "" },
    api: { ...(value.translation?.api || {}), apiKey: "" },
  };
  delete value.notesAi;
  return value;
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
  return stem === "sing-box" ? ["SHAREGPT_SINGBOX_PATH"] : ["SHAREGPT_FRPC_PATH"];
}

function toInt(value, name) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} 必须是 1~65535 的整数`);
  }
  return n;
}

// 本机监听端口须 >= 1024, 否则 macOS / Windows 上要管理员权限才能绑定 (移植自 sender 启动修复)。
function toListenPort(value, name) {
  const n = toInt(value, name);
  if (n < 1024) {
    throw new Error(`${name} 必须是 1024~65535 的整数，避免在 macOS 或 Windows 上要求管理员权限`);
  }
  return n;
}

async function assertLoopbackPortsAvailable(ports) {
  for (const port of [...new Set(ports)]) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", (error) => {
        const errorCode = /** @type {NodeJS.ErrnoException} */ (error).code;
        reject(
          new Error(
            errorCode === "EADDRINUSE"
              ? `本地监听端口 ${port} 已被其他程序占用`
              : `无法使用本地监听端口 ${port}: ${error?.message || error}`,
          ),
        );
      });
      probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
}

function canConnectToLoopbackPort(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForLoopbackPortsListening(ports, child = null, timeoutMs = 8000) {
  const uniquePorts = [...new Set(ports)].filter((port) => Number.isInteger(port));
  if (!uniquePorts.length) return;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error("发送服务在监听端口就绪前退出");
    }
    const ready = await Promise.all(uniquePorts.map((port) => canConnectToLoopbackPort(port)));
    if (ready.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error(`发送服务启动超时，端口尚未就绪：${uniquePorts.join(", ")}`);
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeStoredAttachment(record) {
  const name = String(record?.name || "")
    .trim()
    .slice(0, 200);
  const kind = String(record?.kind || "").trim() === "image" ? "image" : "file";
  const mime = String(record?.mime || "")
    .trim()
    .slice(0, 200);
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

  const preview = String(record?.preview || "")
    .trim()
    .slice(0, 240);
  return {
    id,
    from: String(record?.from || record?.username || "").trim(),
    displayName:
      String(record?.displayName || record?.username || record?.from || "消息").trim() || "消息",
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
        copyImportantPath(
          path.join(sourcePath, name),
          path.join(targetPath, name),
          errors,
          options,
        );
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
    return (
      sourceStat.size !== targetStat.size ||
      Math.trunc(sourceStat.mtimeMs) !== Math.trunc(targetStat.mtimeMs)
    );
  } catch {
    return true;
  }
}

function pruneOldUpdateBackups(backupRoot) {
  let entries;
  try {
    entries = fs
      .readdirSync(backupRoot, { withFileTypes: true })
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
    const entries = fs
      .readdirSync(backupRoot, { withFileTypes: true })
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
    displayName:
      String(record?.displayName || record?.username || record?.from || "转发消息").trim() ||
      "转发消息",
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
    displayName:
      String(record?.displayName || record?.username || record?.from || "").trim() || "系统通知",
    avatar: String(record?.avatar || "").trim(),
    text,
    attachments,
    timestamp:
      String(record?.timestamp || new Date().toISOString()).trim() || new Date().toISOString(),
    readAt: scope === "private" ? String(record?.readAt || "").trim() : "",
    readBy:
      scope === "subnet"
        ? Array.isArray(record?.readBy)
          ? record.readBy
              .map((item) => {
                const username = String(item?.username || item?.from || "").trim();
                if (!username) return null;
                return {
                  username,
                  displayName:
                    String(item?.displayName || item?.username || item?.from || "").trim() ||
                    username,
                  readAt:
                    String(item?.readAt || item?.timestamp || "").trim() ||
                    new Date().toISOString(),
                };
              })
              .filter(Boolean)
          : []
        : [],
    edited: Boolean(record?.edited),
    editedAt: Boolean(record?.edited)
      ? String(record?.editedAt || "").trim() || new Date().toISOString()
      : "",
    subnetKey: String(record?.subnetKey || "").trim(),
    subnetLabel: String(record?.subnetLabel || record?.roomScope || "").trim(),
    system: Boolean(record?.system),
    replyTo,
    forwardedFrom,
    recalled,
    recalledAt: recalled
      ? String(record?.recalledAt || new Date().toISOString()).trim() || new Date().toISOString()
      : "",
  };
}

function normalizeChatHistoryStore(store) {
  const input = store && typeof store === "object" ? store : {};
  const conversations =
    input.conversations && typeof input.conversations === "object" ? input.conversations : {};

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
    // 新增本地功能存储 (个人日历 / 任务+备忘录): 纯本机 JSON, 结构由渲染层维护, 后端只做读写与轻量兜底。
    this.calendarFile = path.join(this.app.getPath("userData"), "calendar.json");
    this.tasksFile = path.join(this.app.getPath("userData"), "tasks.json");
    this.focusFile = path.join(this.app.getPath("userData"), "focus.json");
    // 知识库 vault 管理器 (笔记真源 = 磁盘 .md 文件夹; 仅做文件 IO + 监听, 解析/索引在渲染层)。
    this.vault = new VaultManager(this.app, this.getWindow);
    // 知识库 AI 助手 (OpenAI Responses / Codex 中转, 流式; provider 由渲染层传入, 不持久化密钥)。
    this.notesAi = createNotesAi({
      getWindow: this.getWindow,
      getPrincipalId: () => this.activePrincipalId,
      requirePrincipalContext: true,
    });
    this.runtimeDir = path.join(this.app.getPath("userData"), "runtime");
    this.updatesDir = path.join(this.app.getPath("downloads"), "ShareGPT Updates");
    this.updateBackupsDir = path.join(this.app.getPath("appData"), "ShareGPT Backups");

    this.senderProcess = null;
    this.receiverFrpc = null;
    this.receiverSingbox = null;
    // 当前运行中的发送端 SOCKS 端口 / 实际走代理的域名后缀集合 (供更新代理、代理检测分类复用)。
    this.activeSocksPort = null;
    this.activeProxiedSuffixes = null;
    this.activeAiProxyRoutes = [];
    this.senderState = "stopped";
    this.activePrincipalId = LOCAL_PRINCIPAL_ID;
    this.activePrincipalServerUrl = "";
    this.activePrincipalUsername = "";
    this.activePrincipalGeneration = 0;
  }

  // 当前发送端配置里「走代理(梯子)」的域名后缀集合。路由规则(buildSenderConfig)与
  // 「代理检测」分类共用同一套, 避免出现"加入了清单但检测仍判回落"的不一致。
  // 基础清单: sender 模式=内置固定清单(用户不可改); all/dev 模式=可编辑的 target_domains。
  // 自动累积 auto_domains 在两种模式下都并入 —— 否则 all 模式下"一键加入并重启"写了 auto_domains 也不生效。
  proxiedDomainSuffixes(sender = {}) {
    const autoDomains = Array.isArray(sender.auto_domains) ? sender.auto_domains : [];
    const baseRaw =
      this.appMode === "sender"
        ? DEFAULT_TARGET_DOMAINS.join(",")
        : String(sender.target_domains || "");
    const merged = [
      ...String(baseRaw).replace(/\n/g, ",").split(","),
      ...autoDomains,
      // 环境检测必须始终经远端出口，即使 all/dev 模式仍保存着旧版可编辑域名清单。
      "ipwho.is",
    ]
      .map((s) => String(s).trim().replace(/^\./, ""))
      .filter(Boolean);
    return [...new Set(merged)];
  }

  resolvePrivateDefaultsCandidates() {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = path.dirname(this.app.getPath("exe"));
    const userDataFile = path.join(this.app.getPath("userData"), "private.defaults.local.json");

    if (this.app.isPackaged) {
      return [path.join(appDir, "private.defaults.local.json"), userDataFile];
    }

    return [path.join(repoRoot, "private.defaults.local.json"), userDataFile];
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
    const existing = this.resolvePrivateDefaultsCandidates().find((candidate) =>
      fs.existsSync(candidate),
    );
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
        fs.writeFileSync(
          path.join(userDataDir, "update_restore_report.json"),
          JSON.stringify(report, null, 2),
          "utf-8",
        );
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
    const configuredPath =
      envVars.map((name) => String(process.env[name] || "").trim()).find(Boolean) || "";
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
          if (
            !fs.existsSync(persistedCandidate) ||
            filesDiffer(bundledCandidate, persistedCandidate)
          ) {
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
      ? [...configuredCandidates, persistedCandidate, ...bundledPackagedCandidates]
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

  readStoredSettings() {
    const defaultSettings = this.loadPrivateDefaults();
    if (!fs.existsSync(this.settingsFile)) {
      return structuredClone(defaultSettings);
    }

    try {
      const raw = transformSensitiveValues(
        JSON.parse(fs.readFileSync(this.settingsFile, "utf-8")),
        "decrypt",
      );
      return mergeSettings(defaultSettings, raw);
    } catch (error) {
      if (isSecretStorageError(error)) {
        this.log("app", error.message || String(error));
        throw error;
      }
      const backupFile = `${this.settingsFile}.bak`;
      try {
        const backup = transformSensitiveValues(
          JSON.parse(fs.readFileSync(backupFile, "utf-8")),
          "decrypt",
        );
        this.log("app", `设置文件损坏，已从上一份有效备份恢复：${error.message || error}`);
        return mergeSettings(defaultSettings, backup);
      } catch (backupError) {
        if (isSecretStorageError(backupError)) {
          this.log("app", backupError.message || String(backupError));
          throw backupError;
        }
        this.log("app", `设置文件损坏且无有效备份，已保留原文件：${error.message || error}`);
        return structuredClone(defaultSettings);
      }
    }
  }

  principalSettingsState(stored, owner = null) {
    const existing = stored?.principalSettings;
    const requestedServer = normalizeServerBaseUrl(owner?.serverUrl);
    const requestedUsername = normalizePrincipalUsername(owner?.username);

    if (
      existing?.version === 2 &&
      existing.byPrincipal &&
      typeof existing.byPrincipal === "object"
    ) {
      const state = structuredClone(existing);
      const legacyRoot = state.unowned?.legacyRoot;
      const legacyOwnerServer = normalizeServerBaseUrl(legacyRoot?.ownerServer);
      const legacyOwnerUsername = normalizePrincipalUsername(legacyRoot?.ownerUsername);
      if (
        requestedServer &&
        requestedUsername &&
        legacyOwnerServer === requestedServer &&
        legacyOwnerUsername === requestedUsername
      ) {
        const principalId = principalIdFor(requestedServer, requestedUsername);
        state.byPrincipal[principalId] = {
          ownerServer: requestedServer,
          ownerUsername: requestedUsername,
          advancedAi: structuredClone(
            legacyRoot.settings?.advancedAi || PUBLIC_DEFAULT_SETTINGS.advancedAi,
          ),
          translation: structuredClone(
            legacyRoot.settings?.translation || DEFAULT_TRANSLATION_SETTINGS,
          ),
        };
        state.unowned.legacyRoot = null;
        state.legacyPartitionOwnerId = principalId;
        return { state, migrated: true };
      }
      return { state, migrated: false };
    }

    if (
      existing?.version === 1 &&
      existing.byPrincipal &&
      typeof existing.byPrincipal === "object"
    ) {
      return {
        migrated: true,
        state: {
          version: 2,
          byPrincipal: {},
          unowned: {
            legacyRoot: null,
            legacyByPrincipal: structuredClone(existing.byPrincipal),
            legacyUnowned: existing.unowned ? structuredClone(existing.unowned) : null,
          },
          // V1 的 owner 使用可碰撞 hash，不能授权任何 V2 principal 复用旧 partition。
          legacyPartitionOwnerId: "",
        },
      };
    }

    const legacy = {
      advancedAi: structuredClone(stored?.advancedAi || PUBLIC_DEFAULT_SETTINGS.advancedAi),
      translation: structuredClone(stored?.translation || DEFAULT_TRANSLATION_SETTINGS),
    };
    const legacyOwnerServer = normalizeServerBaseUrl(stored?.collab?.server_url);
    const legacyOwnerUsername = normalizePrincipalUsername(stored?.collab?.last_username);
    const ownerMatches = Boolean(
      requestedServer &&
      requestedUsername &&
      legacyOwnerServer === requestedServer &&
      legacyOwnerUsername === requestedUsername,
    );
    const ownerId = ownerMatches ? principalIdFor(requestedServer, requestedUsername) : "";
    return {
      migrated: true,
      state: {
        version: 2,
        byPrincipal: ownerId
          ? {
              [ownerId]: {
                ownerServer: requestedServer,
                ownerUsername: requestedUsername,
                ...legacy,
              },
            }
          : {},
        unowned: {
          legacyRoot:
            legacyOwnerServer && legacyOwnerUsername
              ? {
                  ownerServer: legacyOwnerServer,
                  ownerUsername: legacyOwnerUsername,
                  settings: legacy,
                }
              : null,
          legacyByPrincipal: {},
          legacyUnowned: legacyOwnerServer && legacyOwnerUsername ? null : structuredClone(legacy),
        },
        legacyPartitionOwnerId: ownerId,
      },
    };
  }

  materializePrincipalSettings(stored) {
    const { state } = this.principalSettingsState(stored);
    const principalId = normalizePrincipalId(this.activePrincipalId, { allowLocal: true });
    const scoped = principalId ? state.byPrincipal?.[principalId] : null;
    const result = {
      ...stored,
      advancedAi: structuredClone(scoped?.advancedAi || PUBLIC_DEFAULT_SETTINGS.advancedAi),
      translation: normalizeTranslationSettings(scoped?.translation),
    };
    delete result.principalSettings;
    return result;
  }

  loadSettings() {
    return this.materializePrincipalSettings(this.readStoredSettings());
  }

  activatePrincipal(serverUrl, username) {
    const principalId = principalIdFor(serverUrl, username);
    if (!principalId) throw new Error("协作账号 principal 信息不合法");
    const confirmedServer = normalizeServerBaseUrl(serverUrl);
    const confirmedUsername = normalizePrincipalUsername(username);
    const stored = this.readStoredSettings();
    const { state, migrated } = this.principalSettingsState(stored, {
      serverUrl: confirmedServer,
      username: confirmedUsername,
    });
    if (migrated) {
      stored.principalSettings = state;
      stored.settingsRevision = Math.max(0, Number(stored.settingsRevision) || 0) + 1;
      writeJsonAtomic(this.settingsFile, transformSensitiveValues(stored, "encrypt"));
    }
    const previous = {
      principalId: this.activePrincipalId,
      serverUrl: this.activePrincipalServerUrl,
      username: this.activePrincipalUsername,
      generation: this.activePrincipalGeneration,
    };
    try {
      this.activePrincipalId = principalId;
      this.activePrincipalServerUrl = confirmedServer;
      this.activePrincipalUsername = confirmedUsername;
      this.activePrincipalGeneration = previous.generation + 1;
      return {
        principalId,
        settings: this.materializePrincipalSettings({ ...stored, principalSettings: state }),
      };
    } catch (error) {
      this.activePrincipalId = previous.principalId;
      this.activePrincipalServerUrl = previous.serverUrl;
      this.activePrincipalUsername = previous.username;
      this.activePrincipalGeneration = previous.generation;
      throw error;
    }
  }

  clearPrincipal() {
    const previous = {
      principalId: this.activePrincipalId,
      serverUrl: this.activePrincipalServerUrl,
      username: this.activePrincipalUsername,
      generation: this.activePrincipalGeneration,
    };
    try {
      this.activePrincipalId = LOCAL_PRINCIPAL_ID;
      this.activePrincipalServerUrl = "";
      this.activePrincipalUsername = "";
      this.activePrincipalGeneration = previous.generation + 1;
      return this.loadSettings();
    } catch (error) {
      this.activePrincipalId = previous.principalId;
      this.activePrincipalServerUrl = previous.serverUrl;
      this.activePrincipalUsername = previous.username;
      this.activePrincipalGeneration = previous.generation;
      throw error;
    }
  }

  getPrincipalContext() {
    const { state } = this.principalSettingsState(this.readStoredSettings());
    return {
      principalId: this.activePrincipalId,
      generation: this.activePrincipalGeneration,
      serverUrl: this.activePrincipalServerUrl,
      username: this.activePrincipalUsername,
      legacyPartitionOwnerId: normalizePrincipalId(state.legacyPartitionOwnerId),
    };
  }

  assertSettingsPrincipal(expectedPrincipalId) {
    const expected = normalizePrincipalId(expectedPrincipalId, { allowLocal: true });
    const active = normalizePrincipalId(this.activePrincipalId, { allowLocal: true });
    if (!expected || !active || expected !== active) {
      throw new Error("设置 principal 已变化，请重试");
    }
    return active;
  }

  saveSettings(data) {
    const stored = this.readStoredSettings();
    const currentRevision = this.materializePrincipalSettings(stored).settingsRevision || 0;
    const suppliedRevision = Number(data?.settingsRevision);
    if (Number.isInteger(suppliedRevision) && suppliedRevision !== currentRevision) {
      throw Object.assign(new Error("设置已被其他操作更新，请重试"), {
        code: "SETTINGS_REVISION_CONFLICT",
      });
    }
    const merged = mergeSettings(this.loadPrivateDefaults(), data);
    merged.settingsRevision = Math.max(currentRevision, merged.settingsRevision || 0) + 1;
    const { state } = this.principalSettingsState(stored);
    const principalId = normalizePrincipalId(this.activePrincipalId, { allowLocal: true });
    if (!principalId) throw new Error("当前 principal 标识不合法");
    state.byPrincipal[principalId] = {
      ...(principalId === LOCAL_PRINCIPAL_ID
        ? {}
        : {
            ownerServer: this.activePrincipalServerUrl,
            ownerUsername: this.activePrincipalUsername,
          }),
      advancedAi: structuredClone(merged.advancedAi),
      translation: structuredClone(merged.translation),
    };
    const persisted = {
      ...merged,
      // 根级值仅作为旧版迁移归档保留；有效配置始终来自 principalSettings。
      advancedAi: stored.advancedAi || PUBLIC_DEFAULT_SETTINGS.advancedAi,
      translation: stored.translation || DEFAULT_TRANSLATION_SETTINGS,
      principalSettings: state,
    };
    writeJsonAtomic(this.settingsFile, transformSensitiveValues(persisted, "encrypt"));
    return merged;
  }

  saveSettingsForPrincipal(data, expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    return this.saveSettings(data);
  }

  patchSettings(section, patch, expectedRevision, expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    const allowed = new Set([
      "sender",
      "receiver",
      "collab",
      "gpt",
      "gemini",
      "claude",
      "browserPrivacy",
      "advancedAi",
      "translation",
      "ui",
    ]);
    const target = String(section || "");
    if (!allowed.has(target)) throw new Error("不允许修改该设置区域");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("设置补丁必须是对象");
    }
    const current = this.loadSettings();
    if (
      Number.isInteger(expectedRevision) &&
      expectedRevision >= 0 &&
      expectedRevision !== current.settingsRevision
    ) {
      throw Object.assign(new Error("设置已被其他操作更新，请重试"), {
        code: "SETTINGS_REVISION_CONFLICT",
        current,
      });
    }
    return this.saveSettings({
      ...current,
      [target]: { ...(current[target] || {}), ...patch },
      settingsRevision: current.settingsRevision,
    });
  }

  operateSettings(section, operations, expectedRevision, expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    const target = String(section || "");
    if (target !== "advancedAi" && target !== "translation") {
      throw new Error("该设置区域不支持路径操作");
    }
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) {
      throw new Error("设置操作列表不合法");
    }
    const current = this.loadSettings();
    if (
      Number.isInteger(expectedRevision) &&
      expectedRevision >= 0 &&
      expectedRevision !== current.settingsRevision
    ) {
      throw Object.assign(new Error("设置已被其他操作更新，请重试"), {
        code: "SETTINGS_REVISION_CONFLICT",
        current,
      });
    }
    const nextSection = structuredClone(current[target]);
    const blocked = new Set(["__proto__", "constructor", "prototype"]);
    const assertSegments = (path) => {
      if (!Array.isArray(path) || !path.length || path.length > 4)
        throw new Error("设置路径不合法");
      for (const segment of path) {
        if (typeof segment !== "string" || !segment || blocked.has(segment)) {
          throw new Error("设置路径不合法");
        }
      }
    };
    const allowedTranslation = new Set([
      "version",
      "provider",
      "sourceLanguage",
      "targetLanguage",
      "siteLanguage",
      "confirmNonTargetSend",
      "autoTranslateSelection",
      "ai.baseUrl",
      "ai.apiKey",
      "ai.model",
      "ai.effort",
      "api.baseUrl",
      "api.apiKey",
      "offline.baseUrl",
    ]);
    const environmentFields = new Set(["name", "routeId"]);

    for (const operation of operations) {
      if (!operation || typeof operation !== "object" || typeof operation.value === "function") {
        throw new Error("设置操作不合法");
      }
      const path = operation.path;
      assertSegments(path);
      const op = operation.op === "delete" ? "delete" : operation.op === "set" ? "set" : "";
      if (!op) throw new Error("设置操作不合法");

      if (target === "translation") {
        if (op !== "set" || !allowedTranslation.has(path.join("."))) {
          throw new Error("不允许修改该翻译设置路径");
        }
        let parent = nextSection;
        for (const segment of path.slice(0, -1)) parent = parent[segment];
        parent[path.at(-1)] = structuredClone(operation.value);
        continue;
      }

      if (path[0] === "enabled" && path.length === 1 && op === "set") {
        nextSection.enabled = Boolean(operation.value);
        continue;
      }
      if (
        path[0] === "activeByKind" &&
        path.length === 2 &&
        ["gpt", "gemini", "claude"].includes(path[1]) &&
        op === "set"
      ) {
        nextSection.activeByKind[path[1]] = normalizeAiEnvironmentId(operation.value);
        continue;
      }
      if (path[0] !== "environments" || path.length < 2) {
        throw new Error("不允许修改该高级环境设置路径");
      }
      const environmentId = normalizeAiEnvironmentId(path[1]);
      if (!environmentId || environmentId !== path[1]) throw new Error("AI 环境标识不合法");
      const index = nextSection.environments.findIndex(
        (environment) => normalizeAiEnvironmentId(environment?.id) === environmentId,
      );
      if (path.length === 2) {
        if (op === "delete") {
          if (index >= 0) nextSection.environments.splice(index, 1);
          for (const kind of ["gpt", "gemini", "claude"]) {
            if (nextSection.activeByKind[kind] === environmentId)
              nextSection.activeByKind[kind] = "";
          }
          continue;
        }
        if (index >= 0) throw new Error("AI 环境已存在");
        const value = operation.value;
        if (
          !value ||
          typeof value !== "object" ||
          normalizeAiEnvironmentId(value.id) !== environmentId ||
          !["gpt", "gemini", "claude"].includes(String(value.kind))
        ) {
          throw new Error("AI 环境配置不合法");
        }
        nextSection.environments.push(structuredClone(value));
        continue;
      }
      if (path.length !== 3 || op !== "set" || !environmentFields.has(path[2])) {
        throw new Error("不允许修改该高级环境设置路径");
      }
      if (index < 0) throw new Error("AI 环境不存在");
      nextSection.environments[index][path[2]] = String(operation.value || "").trim();
    }

    return this.saveSettings({
      ...current,
      [target]: nextSection,
      settingsRevision: current.settingsRevision,
    });
  }

  ensureChatHistoryFile() {
    if (!fs.existsSync(this.chatHistoryFile)) {
      fs.writeFileSync(
        this.chatHistoryFile,
        JSON.stringify(
          {
            version: 1,
            updatedAt: new Date().toISOString(),
            conversations: {},
          },
          null,
          2,
        ),
        "utf-8",
      );
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

  // 通用本地 JSON 存储 (供日历/任务等新功能): 读不到或损坏则回退默认; 写入时盖上 updatedAt。
  // 结构由渲染层(store)负责, 后端不做强校验, 仅保证是对象、并防止整体过大(简单上限保护)。
  readLocalStore(file, fallback) {
    try {
      if (!fs.existsSync(file)) return structuredClone(fallback);
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : structuredClone(fallback);
    } catch {
      return structuredClone(fallback);
    }
  }

  writeLocalStore(file, data) {
    const payload = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
    payload.updatedAt = new Date().toISOString();
    const text = JSON.stringify(payload, null, 2);
    // 简单上限保护 (~16MB), 避免异常数据写爆磁盘。
    if (text.length > 16 * 1024 * 1024) {
      throw new Error("数据过大, 已拒绝写入");
    }
    fs.writeFileSync(file, text, "utf-8");
    return payload;
  }

  loadCalendar() {
    return this.readLocalStore(this.calendarFile, { version: 1, calendars: [], events: [] });
  }

  saveCalendar(data) {
    return this.writeLocalStore(this.calendarFile, data);
  }

  loadTasks() {
    return this.readLocalStore(this.tasksFile, { version: 1, lists: [], tasks: [], memos: [] });
  }

  saveTasks(data) {
    return this.writeLocalStore(this.tasksFile, data);
  }

  loadFocus() {
    return this.readLocalStore(this.focusFile, { version: 1, sessions: [], settings: null });
  }

  saveFocus(data) {
    return this.writeLocalStore(this.focusFile, data);
  }

  async exportUserData(expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;

    const result = await dialog.showSaveDialog(window, {
      title: "导出本机资料包",
      defaultPath: path.join(
        this.app.getPath("documents"),
        `sharegpt-data-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "ShareGPT 数据包", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePath) return null;
    this.assertSettingsPrincipal(expectedPrincipalId);

    const payload = {
      format: "sharegpt-user-data",
      version: 1,
      exportedAt: new Date().toISOString(),
      credentialsExcluded: true,
      settings: redactSettingsForExport(this.loadSettings()),
      chatHistory: this.loadChatHistory(),
    };

    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { filePath: result.filePath };
  }

  async importUserData(expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: "导入本机资料包",
      filters: [{ name: "ShareGPT 数据包", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths.length) return null;
    this.assertSettingsPrincipal(expectedPrincipalId);

    try {
      const filePath = result.filePaths[0];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const settings = this.saveSettings({
        ...(raw?.settings || {}),
        settingsRevision: this.loadSettings().settingsRevision,
      });
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
    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
    pruneOldUpdateBackups(backupRoot);

    if (errors.length) {
      throw new Error(`更新前资料备份未完全成功，已停止打开安装包。备份目录：${backupDir}`);
    }

    return {
      backupDir,
      errors,
    };
  }

  async importSettings(expectedPrincipalId) {
    this.assertSettingsPrincipal(expectedPrincipalId);
    const { dialog } = require("electron");
    const window = this.getWindow();
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: "导入本地配置文件",
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths.length) return null;
    this.assertSettingsPrincipal(expectedPrincipalId);

    try {
      const filePath = result.filePaths[0];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return this.saveSettings({ ...raw, settingsRevision: this.loadSettings().settingsRevision });
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
    const cleaned = path
      .basename(source)
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .trim();
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
    const originalName = this.sanitizeUpdateFileName(
      preferredName || path.basename(parsed.pathname || ""),
      ext,
    );
    const originalExt = path.extname(originalName) || ext;
    const originalBase = path.basename(originalName, originalExt);
    const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
    const fileName = this.sanitizeUpdateFileName(
      `${originalBase}-${stamp}${originalExt}`,
      originalExt,
    );
    const versionText = String(version || "").trim();
    const versionDir = versionText ? this.sanitizeUpdateFileName(`v${versionText}`, "") : "manual";
    return {
      url: parsed,
      filePath: path.join(this.updatesDir, versionDir, fileName),
    };
  }

  // GET 一个 JSON (用于 GitHub Releases API)。失败一律返回 null, 不抛错。
  fetchReleaseJson(apiUrl) {
    return new Promise((resolve) => {
      try {
        const req = https.get(
          apiUrl,
          {
            headers: {
              "User-Agent": "ShareGPT-Updater",
              Accept: "application/vnd.github+json",
            },
            timeout: 8000,
          },
          (res) => {
            const status = Number(res.statusCode || 0);
            if (status < 200 || status >= 300) {
              res.resume();
              resolve(null);
              return;
            }
            let data = "";
            res.setEncoding("utf-8");
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch (_err) {
                resolve(null);
              }
            });
          },
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      } catch (_err) {
        resolve(null);
      }
    });
  }

  // GET 文本 (读 release 的 latest.yml), 跟随重定向 (releases/latest/download -> CDN)。失败返回 null。
  // 读 Windows 系统代理(注册表)。clash/v2ray 的"系统代理"模式设在这里, 但不一定有 HTTP_PROXY env。
  // 非 Windows 或未开启则返回空串。
  windowsSystemProxy() {
    if (process.platform !== "win32") return "";
    try {
      const base = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      const enabled = spawnSync("reg", ["query", base, "/v", "ProxyEnable"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled.stdout || "")) return "";
      const server = spawnSync("reg", ["query", base, "/v", "ProxyServer"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      const m = (server.stdout || "").match(/ProxyServer\s+REG_SZ\s+(.+)/i);
      if (!m) return "";
      let val = m[1].trim();
      // 可能是 "host:port" 或 "http=host:port;https=host:port;socks=host:port"
      if (val.includes("=")) {
        const parts = val.split(";").map((s) => s.trim());
        const pick = parts.find((s) => /^https=/i.test(s)) || parts.find((s) => /^http=/i.test(s));
        val = pick ? pick.split("=")[1] : "";
      }
      return val ? `http://${val.trim()}` : "";
    } catch (_e) {
      return "";
    }
  }

  // 给"更新检查/下载"挑一个代理 agent: 优先本机 sing-box SOCKS(代理运行中, 已把 github 加入路由),
  // 否则用系统代理 env(HTTPS_PROXY 等); 都没有则 null(直连)。国内直连 GitHub CDN 常失败, 故走代理。
  updateProxyAgent() {
    try {
      const { SocksProxyAgent } = require("socks-proxy-agent");
      if (this.senderProcess && this.activeSocksPort) {
        return new SocksProxyAgent(`socks5h://127.0.0.1:${this.activeSocksPort}`);
      }
      // sing-box 未开时也能更新: 兜底走 环境代理(env) -> Windows 系统代理(注册表)。
      const proxyUrl =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy ||
        this.windowsSystemProxy();
      if (proxyUrl) {
        if (/^socks/i.test(proxyUrl)) {
          return new SocksProxyAgent(proxyUrl);
        }
        const { HttpsProxyAgent } = require("https-proxy-agent");
        return new HttpsProxyAgent(proxyUrl);
      }
    } catch (_err) {
      /* 构造失败则直连 */
    }
    return null;
  }

  fetchText(url, redirectsLeft = 5, agent) {
    if (agent === undefined) {
      agent = (this.updateProxyAgent && this.updateProxyAgent()) || null;
    }
    return new Promise((resolve) => {
      try {
        const protocol = new URL(url).protocol === "http:" ? http : https;
        const req = protocol.get(
          url,
          {
            headers: { "User-Agent": "ShareGPT-Updater" },
            timeout: 8000,
            agent: agent || undefined,
          },
          (res) => {
            const status = Number(res.statusCode || 0);
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              res.headers.location &&
              redirectsLeft > 0
            ) {
              res.resume();
              this.fetchText(
                new URL(res.headers.location, url).toString(),
                redirectsLeft - 1,
                agent,
              ).then(resolve);
              return;
            }
            if (status < 200 || status >= 300) {
              res.resume();
              resolve(null);
              return;
            }
            let data = "";
            res.setEncoding("utf-8");
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => resolve(data));
          },
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      } catch (_err) {
        resolve(null);
      }
    });
  }

  // 查询最新版 (自动更新源)。读 release 的 latest.yml (electron-updater feed) 而非 api.github.com:
  // 后者未登录限流 60 次/小时, 极易被打爆; latest.yml 是 release 资源、不限流。完全不经过自建服务器。
  async checkLatestRelease() {
    if (!UPDATE_REPO) return null;
    const ymlText = await this.fetchText(
      `https://github.com/${UPDATE_REPO}/releases/latest/download/latest.yml`,
    );
    if (!ymlText) return null;
    const vm = ymlText.match(/^version:\s*(.+)$/m);
    if (!vm) return null;
    const version = vm[1]
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/^v/i, "");
    if (!version) return null;
    const tag = `v${version}`;
    let fileName;
    if (process.platform === "darwin") {
      fileName = `sharegpt-sender-${version}-arm64.dmg`;
    } else {
      const pm = ymlText.match(/^path:\s*(.+)$/m);
      fileName = pm ? pm[1].trim().replace(/^['"]|['"]$/g, "") : `sharegpt-sender-${version}.exe`;
    }
    return {
      version,
      notes: "",
      publishedAt: "",
      url: `https://github.com/${UPDATE_REPO}/releases/download/${tag}/${fileName}`,
      fileName,
      htmlUrl: `https://github.com/${UPDATE_REPO}/releases/tag/${tag}`,
      repo: UPDATE_REPO,
    };
  }

  async downloadUpdatePackage(payload = {}, onProgress = null) {
    fs.mkdirSync(this.updatesDir, { recursive: true });
    const { url, filePath } = this.resolveUpdateDownloadTarget(
      payload?.url,
      payload?.fileName,
      payload?.version,
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const protocol = url.protocol === "https:" ? https : http;
    const emitProgress = typeof onProgress === "function" ? onProgress : () => {};

    return new Promise((resolve, reject) => {
      const request = protocol.get(url, (response) => {
        const status = Number(response.statusCode || 0);

        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          this.downloadUpdatePackage(
            {
              ...payload,
              url: new URL(response.headers.location, url).toString(),
            },
            onProgress,
          ).then(resolve, reject);
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
          try {
            fs.unlinkSync(tempPath);
          } catch {}
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
              try {
                fs.unlinkSync(tempPath);
              } catch {}
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
      senderRunning: this.senderState === "running",
      senderStarting: this.senderState === "starting",
      sender: this.senderState,
      credentialStorage: getSafeStorage() ? "encrypted" : "plaintext-compatibility",
      aiProxyRoutes: this.activeAiProxyRoutes.map(({ id, label }) => ({ id, label })),
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

    // 仅当退出/出错的就是「当前」那个子进程才清引用: 重启时旧进程的 exit 晚于新进程被赋值,
    // 若无条件清空会把刚起的新进程引用一起抹掉(导致状态显示已停、且无法再正常 stop)。
    child.on("error", (err) => {
      this.log(source, `进程启动失败：${err.message || err}`);
      if (source === "sender" && this.senderProcess === child) {
        this.senderProcess = null;
        this.activeAiProxyRoutes = [];
        this.senderState = "error";
      }
      if (source === "receiver-frpc" && this.receiverFrpc === child) this.receiverFrpc = null;
      if (source === "receiver-singbox" && this.receiverSingbox === child)
        this.receiverSingbox = null;
      this.emitStatus();
    });

    child.on("exit", (code) => {
      this.log(source, `进程退出，code=${code}`);
      if (source === "sender" && this.senderProcess === child) {
        this.senderProcess = null;
        this.activeAiProxyRoutes = [];
        this.senderState = code === 0 ? "stopped" : "error";
      }
      if (source === "receiver-frpc" && this.receiverFrpc === child) this.receiverFrpc = null;
      if (source === "receiver-singbox" && this.receiverSingbox === child)
        this.receiverSingbox = null;
      this.emitStatus();
    });

    return child;
  }

  // 启动 sing-box 前先用 `sing-box check` 校验配置, 配置有问题直接给出明确报错, 不让进程静默退出。
  checkSingboxConfig(binaryPath, configPath, source) {
    const result = spawnSync(binaryPath, ["check", "-c", configPath], {
      encoding: "utf-8",
      windowsHide: true,
      // 与运行时(spawnProcess)一致: 较新版 sing-box 校验 legacy special outbounds(dns/block)
      // 默认 FATAL, 设此标志兼容旧式配置(旧版 sing-box 忽略此变量, 跨平台安全)。
      env: {
        ...process.env,
        ENABLE_DEPRECATED_SPECIAL_OUTBOUNDS: "true",
      },
    });
    const output = [result.stdout, result.stderr]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("\n");

    if (output) {
      this.log(source, output);
    }

    if (result.error) {
      throw new Error(`sing-box 配置检查失败：${result.error.message || result.error}`);
    }

    if (result.status !== 0) {
      throw new Error(`sing-box 配置检查未通过：${output || `exit code ${result.status}`}`);
    }
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
    this.activeSocksPort = null;
    this.activeProxiedSuffixes = null;
    this.activeAiProxyRoutes = [];
    this.senderState = "stopped";
    this.emitStatus();
  }

  // 等子进程真正退出再 resolve(监听端口随退出释放); 超时则强杀兜底。
  // 用于「重启」前确保旧进程退出, 避免新进程抢绑同一端口报 EADDRINUSE 而 FATAL。
  stopChildAndWait(child, source, timeoutMs = 5000) {
    return new Promise((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        done();
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
      try {
        child.kill();
        this.log(source, "已停止");
      } catch (err) {
        this.log(source, `停止失败: ${err.message}`);
        clearTimeout(timer);
        done();
      }
    });
  }

  async stopSenderAndWait() {
    const child = this.senderProcess;
    this.senderProcess = null;
    this.activeSocksPort = null;
    this.activeProxiedSuffixes = null;
    this.activeAiProxyRoutes = [];
    this.senderState = "stopped";
    this.emitStatus();
    await this.stopChildAndWait(child, "sender");
  }

  getAiProxyRoute(routeId) {
    const target = String(routeId || "").trim();
    const route = this.activeAiProxyRoutes.find((item) => item.id === target);
    return route ? { ...route } : null;
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
    const listenPort = toListenPort(sender.socks_listen_port, "本地SOCKS监听端口");
    const fallbackMode = sender.fallback_mode === "direct" ? "direct" : "system_proxy";
    // 普通模式仍按 proxy_mode 选择默认出站；高级 AI 环境会通过同一 sing-box 的专用入站，
    // 分别固定到统一代理或管理员下发节点，避免再启动外部代理进程或暴露端口配置。
    const proxyMode = sender.proxy_mode === "airport" ? "airport" : "unified";
    const hasUnified = hasCompleteUnifiedProxy(sender);
    const airportOutbound =
      sender.airport_outbound && typeof sender.airport_outbound === "object"
        ? sender.airport_outbound
        : null;
    const authorizedRouteIds = new Set(
      (Array.isArray(sender.authorized_proxy_route_ids) ? sender.authorized_proxy_route_ids : [])
        .map((id) =>
          String(id || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    if (proxyMode === "unified" && !hasUnified) throw new Error("统一代理配置不完整");
    if (proxyMode === "airport" && !airportOutbound) throw new Error("管理员尚未下发机场节点");
    if (proxyMode === "airport" && !authorizedRouteIds.has("internal-airport")) {
      throw new Error("当前账号未获授权使用机场节点");
    }
    const selectedProxyTag = proxyMode === "airport" ? "proxy-airport" : "proxy-unified";
    const aiProxyRoutes = internalAiProxyRoutes(sender);
    // 测试用「全部流量走代理」: 除私有 IP 直连外, 所有流量(含 DNS)都走 proxy(梯子),
    // 不再只走 target_domains 清单。用于抓取页面到底访问了哪些域名 (仅管理员可开)。
    const routeAll =
      sender.route_all === true || sender.route_all === "1" || sender.route_all === "true";

    // 走代理的域名集合: 见 proxiedDomainSuffixes (基础清单 + 自动累积 auto_domains, 两模式都并入)。
    // domain(精确)与 domain_suffix(后缀)用同一套去点号后的清单, 路由与代理检测据此保持一致。
    const uniqueDomains = this.proxiedDomainSuffixes(sender);
    const domainSuffix = uniqueDomains;

    const unifiedOutbound = hasUnified
      ? {
          type: "vmess",
          tag: "proxy-unified",
          server: String(sender.proxy_server || "").trim(),
          server_port: toInt(sender.proxy_port, "公网端口"),
          uuid: String(sender.proxy_uuid || "").trim(),
          packet_encoding: "packetaddr",
          transport: {
            type: "ws",
            path: "",
            max_early_data: 2048,
            early_data_header_name: "Sec-WebSocket-Protocol",
          },
        }
      : null;
    const managedOutbounds = aiProxyRoutes
      .filter((route) => route.outbound && route.outboundTag !== "proxy-unified")
      .map((route) => ({ ...route.outbound, tag: route.outboundTag }));
    if (airportOutbound && !managedOutbounds.some((outbound) => outbound.tag === "proxy-airport")) {
      managedOutbounds.push({ ...airportOutbound, tag: "proxy-airport" });
    }

    const outbounds = [
      unifiedOutbound,
      ...managedOutbounds,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
      { type: "dns", tag: "dns_out" },
    ].filter(Boolean);

    if (fallbackMode === "system_proxy") {
      outbounds.splice(1, 0, {
        type: "socks",
        tag: "system_proxy",
        server: "127.0.0.1",
        server_port: toInt(sender.fallback_local_port, "本机代理端口"),
      });
    }

    // 机场节点的 server 常是只在系统/本地 DNS 才能解析的特殊域名(如机场 GTM 域名),
    // 公共 DoH(Aliyun/1.1.1.1)解析不了。这里强制用 dns_local(系统 DNS, 同 Clash 行为)解析它,
    // 否则会出现 "DNS query loopback" 或解析失败导致整条机场链路连不上。
    const managedServerDnsRules = managedOutbounds
      .map((outbound) => String(outbound.server || "").trim())
      .filter((server) => server && /[a-zA-Z]/.test(server) && !server.includes(":"))
      .map((server) => ({ domain: [server], server: "dns_local" }));
    const selectedDnsProxyTag =
      selectedProxyTag === "proxy-airport" ? "dns_proxy_airport" : "dns_proxy_unified";
    const aiDnsRules = aiProxyRoutes.map((route) => ({
      inbound: [route.inboundTag],
      server: route.dnsTag,
    }));

    const config = {
      log: { level: "info", timestamp: true },
      dns: {
        servers: [
          ...aiProxyRoutes.map((route) => ({
            tag: route.dnsTag,
            address: "https://1.1.1.1/dns-query",
            address_resolver: "dns_resolver",
            strategy: "ipv4_only",
            detour: route.outboundTag,
          })),
          ...(!aiProxyRoutes.some((route) => route.dnsTag === selectedDnsProxyTag)
            ? [
                {
                  tag: selectedDnsProxyTag,
                  address: "https://1.1.1.1/dns-query",
                  address_resolver: "dns_resolver",
                  strategy: "ipv4_only",
                  detour: selectedProxyTag,
                },
              ]
            : []),
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
          ...managedServerDnsRules,
          ...aiDnsRules,
          { clash_mode: "direct", server: "dns_direct" },
          { clash_mode: "global", server: selectedDnsProxyTag },
          ...(domainSuffix.length
            ? [{ domain_suffix: domainSuffix, server: selectedDnsProxyTag }]
            : []),
        ],
        final: routeAll
          ? selectedDnsProxyTag
          : fallbackMode === "direct"
            ? "dns_local"
            : "dns_direct",
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
        ...aiProxyRoutes.map((route) => ({
          type: "socks",
          tag: route.inboundTag,
          listen: route.host,
          listen_port: route.port,
          sniff: true,
          sniff_override_destination: true,
        })),
      ],
      outbounds,
      route: {
        rules: [
          { protocol: "dns", outbound: "dns_out" },
          ...aiProxyRoutes.map((route) => ({
            inbound: [route.inboundTag],
            outbound: route.outboundTag,
          })),
          // 全部走代理时不需要域名清单规则; 否则按 target_domains 命中当前默认出站。
          ...(routeAll || !uniqueDomains.length
            ? []
            : [
                {
                  domain: uniqueDomains,
                  domain_suffix: domainSuffix,
                  outbound: selectedProxyTag,
                },
              ]),
          { ip_is_private: true, outbound: "direct" },
          { outbound: routeAll ? selectedProxyTag : fallbackMode },
        ],
        final: routeAll ? selectedProxyTag : fallbackMode,
        auto_detect_interface: true,
      },
    };

    validateAiRouteIsolation(config, aiProxyRoutes);
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
          listen_port: toListenPort(receiver.vmess_listen_port, "VMess监听端口"),
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

  async startSender(settings) {
    const singboxPath = this.resolveBinary("sing-box");
    if (!fs.existsSync(singboxPath)) {
      throw new Error(
        `未找到 sing-box: ${singboxPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_SINGBOX_PATH 指定。`,
      );
    }

    const config = this.buildSenderConfig(settings);
    const configPath = path.join(this.runtimeDir, "sender.runtime.json");
    const candidatePath = path.join(this.runtimeDir, "sender.runtime.candidate.json");
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    fs.writeFileSync(candidatePath, JSON.stringify(config, null, 2), "utf-8");
    try {
      this.checkSingboxConfig(singboxPath, candidatePath, "sender candidate");
      // 候选配置校验通过后才停止旧进程；正式文件通过同目录 rename 原子替换。
      await this.stopSenderAndWait();
      await assertLoopbackPortsAvailable(
        config.inbounds
          .map((inbound) => Number(inbound?.listen_port))
          .filter((port) => Number.isInteger(port)),
      );
      fs.renameSync(candidatePath, configPath);
    } finally {
      if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
    }

    const child = this.spawnProcess("sender", singboxPath, ["run", "-c", configPath]);
    this.senderProcess = child;
    this.senderState = "starting";
    this.activeAiProxyRoutes = [];
    this.emitStatus();
    try {
      await waitForLoopbackPortsListening(
        config.inbounds
          .map((inbound) => Number(inbound?.listen_port))
          .filter((port) => Number.isInteger(port)),
        child,
      );
      if (this.senderProcess !== child || child.exitCode !== null || child.signalCode !== null) {
        throw new Error("发送服务在监听端口就绪后意外退出");
      }
    } catch (error) {
      if (this.senderProcess === child) {
        await this.stopChildAndWait(child, "sender");
        this.senderProcess = null;
        this.activeSocksPort = null;
        this.activeProxiedSuffixes = null;
        this.activeAiProxyRoutes = [];
        this.senderState = "error";
        this.emitStatus();
      }
      throw error;
    }
    // 记下本机 SOCKS 端口, 供"更新检查"经代理走出口 (github 已在路由清单里)。
    this.activeSocksPort = Number(settings.socks_listen_port) || null;
    this.activeAiProxyRoutes = internalAiProxyRoutes(settings);
    // 记下「当前运行中的配置」实际走代理的域名后缀, 供代理检测按真实路由分类
    // (而非写死的内置清单), 加入域名并重启后检测才会从"回落"翻到"已走代理"。
    this.activeProxiedSuffixes = this.proxiedDomainSuffixes(settings);
    this.senderState = "running";
    // 运行日志标明当前代理方式, 便于观察走的是统一梯子还是下发的机场节点。
    const useAirportLog =
      settings.proxy_mode === "airport" &&
      settings.airport_outbound &&
      typeof settings.airport_outbound === "object";
    if (useAirportLog) {
      const ob = settings.airport_outbound;
      this.log(
        "sender",
        `代理方式: 机场节点${settings.airport_name ? " · " + settings.airport_name : ""}（${ob.type || "?"} ${ob.server || ""}:${ob.server_port || ""}）`,
      );
    } else {
      this.log(
        "sender",
        `代理方式: 统一梯子（${settings.proxy_server || ""}:${settings.proxy_port || ""}）`,
      );
    }
    this.log("sender", `使用配置: ${configPath}`);
    this.emitStatus();

    return { configPath, binary: singboxPath };
  }

  startReceiver(settings) {
    this.stopReceiver();

    const singboxPath = this.resolveBinary("sing-box");
    const frpcPath = this.resolveBinary("frpc");

    if (!fs.existsSync(singboxPath)) {
      throw new Error(
        `未找到 sing-box: ${singboxPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_SINGBOX_PATH 指定。`,
      );
    }
    if (!fs.existsSync(frpcPath)) {
      throw new Error(
        `未找到 frpc: ${frpcPath}。请先按 build/bin/README.md 准备二进制，或通过 SHAREGPT_BIN_DIR / SHAREGPT_FRPC_PATH 指定。`,
      );
    }

    const { singbox, frpcIni } = this.buildReceiverFiles(settings);
    const singboxCfgPath = path.join(this.runtimeDir, "receiver.singbox.runtime.json");
    const frpcCfgPath = path.join(this.runtimeDir, "receiver.frpc.runtime.ini");

    fs.writeFileSync(singboxCfgPath, JSON.stringify(singbox, null, 2), "utf-8");
    fs.writeFileSync(frpcCfgPath, frpcIni, "utf-8");

    this.receiverSingbox = this.spawnProcess("receiver-singbox", singboxPath, [
      "run",
      "-c",
      singboxCfgPath,
    ]);
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
  ENCRYPTED_SECRET_PREFIX,
  SECRET_DECRYPTION_FAILED,
  SECRET_STORAGE_UNAVAILABLE,
  transformSensitiveValues,
  waitForLoopbackPortsListening,
};
