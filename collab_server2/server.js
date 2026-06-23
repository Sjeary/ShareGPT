const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "8088", 10);
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, "data", "users.json");
const GPT_USAGE_FILE = process.env.GPT_USAGE_FILE || path.join(__dirname, "data", "gpt_usage.json");
const CHAT_HISTORY_FILE =
  process.env.CHAT_HISTORY_FILE || path.join(__dirname, "data", "chat_history.json");
const CLIENT_BOOTSTRAP_FILE =
  process.env.CLIENT_BOOTSTRAP_FILE || path.join(__dirname, "data", "client_bootstrap.json");
// 组队(共享)日历持久化文件: 房间(subnetKey)维度的团队事件 (含 RSVP)。
const CALENDARS_FILE = process.env.CALENDARS_FILE || path.join(__dirname, "data", "calendars.json");
// 个人云端存储: 按用户隔离的个人日历 / 待办备忘 (多端同步 + 乐观并发版本号防覆盖)。
const USER_STORES_FILE =
  process.env.USER_STORES_FILE || path.join(__dirname, "data", "user_stores.json");
const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, "data", "releases");
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS || `${24 * 60 * 60 * 1000}`, 10);
const HISTORY_MAX = Number.parseInt(process.env.HISTORY_MAX || "2000", 10);
const MAX_AVATAR_LENGTH = Number.parseInt(process.env.MAX_AVATAR_LENGTH || `${150 * 1024}`, 10);
const GPT_USAGE_MAX = Number.parseInt(process.env.GPT_USAGE_MAX || "50000", 10);
const MAX_ATTACHMENTS_PER_MESSAGE = Number.parseInt(
  process.env.MAX_ATTACHMENTS_PER_MESSAGE || "4",
  10,
);
const MAX_ATTACHMENT_BYTES = Number.parseInt(
  process.env.MAX_ATTACHMENT_BYTES || `${30 * 1024 * 1024}`,
  10,
);
const RECALL_EDITABLE_WINDOW_MS = Number.parseInt(
  process.env.RECALL_EDITABLE_WINDOW_MS || `${7 * 24 * 60 * 60 * 1000}`,
  10,
);
// CORS 来源: 默认 "*"。内嵌 Electron 客户端 origin 不固定, 且鉴权用 header 里的 Bearer token (不依赖 cookie),
// 通配 origin 的实际风险有限; 部署到受控环境时可用 CORS_ORIGIN 收紧到具体来源。
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
// 登录限流: 同一 IP 连续失败 LOGIN_MAX_FAILS 次后锁定 LOGIN_LOCK_MS 毫秒, 防暴力撞库。
const LOGIN_MAX_FAILS = Number.parseInt(process.env.LOGIN_MAX_FAILS || "10", 10);
const LOGIN_LOCK_MS = Number.parseInt(process.env.LOGIN_LOCK_MS || `${15 * 60 * 1000}`, 10);
const SERVER_SENDER_BOOTSTRAP = {
  proxy_server:
    process.env.SHAREGPT_SENDER_PROXY_SERVER ||
    process.env.SENDER_PROXY_SERVER ||
    process.env.PROXY_SERVER ||
    "",
  proxy_port:
    process.env.SHAREGPT_SENDER_PROXY_PORT ||
    process.env.SENDER_PROXY_PORT ||
    process.env.PROXY_PORT ||
    "",
  proxy_uuid:
    process.env.SHAREGPT_SENDER_PROXY_UUID ||
    process.env.SENDER_PROXY_UUID ||
    process.env.PROXY_UUID ||
    "",
  socks_listen_port:
    process.env.SHAREGPT_SENDER_SOCKS_PORT || process.env.SENDER_SOCKS_PORT || "1080",
  fallback_mode:
    process.env.SHAREGPT_SENDER_FALLBACK_MODE || process.env.SENDER_FALLBACK_MODE || "system_proxy",
  fallback_local_port:
    process.env.SHAREGPT_SENDER_FALLBACK_LOCAL_PORT || process.env.SENDER_FALLBACK_LOCAL_PORT || "",
  target_domains:
    process.env.SHAREGPT_SENDER_TARGET_DOMAINS || process.env.SENDER_TARGET_DOMAINS || "",
};

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
].join(",");

const sessions = new Map();
const adminSessions = new Map();
const wsClients = new Set();
const wsByToken = new Map();
const loginAttempts = new Map(); // ip -> { fails, lockUntil } 登录失败限流状态

function safeEnvText(value) {
  return String(value || "").trim();
}

function safeText(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeParseJson(text) {
  try {
    return JSON.parse(String(text || "{}"));
  } catch {
    return null;
  }
}

function inferAvatarKind(avatar) {
  const text = safeText(avatar);
  if (!text) return "emoji";
  if (/^data:image\//i.test(text)) return "image";
  if (/^https?:\/\//i.test(text)) return "url";
  return "emoji";
}

function toSingleAvatarChar(value) {
  const chars = Array.from(safeText(value));
  return chars.length ? chars[0] : "";
}

function normalizeClientInfo(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const version = safeText(input.version).slice(0, 40);
  const name = safeText(input.name).slice(0, 80);
  const platform = safeText(input.platform).slice(0, 30);
  const arch = safeText(input.arch).slice(0, 30);
  const mode = safeText(input.mode).slice(0, 30);
  const reportedAt = safeText(input.reportedAt) || nowIso();

  return {
    name,
    version,
    platform,
    arch,
    mode,
    reportedAt,
  };
}

function normalizeUserRecord(record) {
  const username = safeText(record?.username);
  const displayName = safeText(record?.displayName) || username;
  const avatar = safeText(record?.avatar).slice(0, MAX_AVATAR_LENGTH);
  const avatarKind = ["emoji", "url", "image"].includes(record?.avatarKind)
    ? record.avatarKind
    : inferAvatarKind(avatar);
  const bio = safeText(record?.bio).slice(0, 200);

  return {
    ...record,
    username,
    displayName,
    avatar,
    avatarKind,
    bio,
    isAdmin: Boolean(record?.isAdmin),
    disabled: Boolean(record?.disabled),
    lastClient: normalizeClientInfo(record?.lastClient),
  };
}

// 原子写 JSON: 先写同目录临时文件再 rename, 避免写一半被 kill 导致主数据文件 (users/chat 等) 损坏。
function writeJsonAtomic(file, obj) {
  const data = JSON.stringify(obj, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

function ensureUsersFile() {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2), "utf-8");
  }
}

function loadUserStore() {
  ensureUsersFile();
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const users = Array.isArray(raw.users) ? raw.users.map(normalizeUserRecord) : [];
    return { users };
  } catch {
    return { users: [] };
  }
}

function saveUserStore(store) {
  writeJsonAtomic(USERS_FILE, store);
}

function ensureGptUsageFile() {
  fs.mkdirSync(path.dirname(GPT_USAGE_FILE), { recursive: true });
  if (!fs.existsSync(GPT_USAGE_FILE)) {
    fs.writeFileSync(GPT_USAGE_FILE, JSON.stringify({ events: [] }, null, 2), "utf-8");
  }
}

function normalizeUsageEvent(record) {
  const username = safeText(record?.username);
  const timestamp = safeText(record?.timestamp);
  const count = Math.max(1, Number.parseInt(String(record?.count || "1"), 10) || 1);
  const parsedTime = new Date(timestamp);

  return {
    username,
    timestamp: Number.isNaN(parsedTime.getTime()) ? nowIso() : parsedTime.toISOString(),
    count,
  };
}

function ensureChatHistoryFile() {
  fs.mkdirSync(path.dirname(CHAT_HISTORY_FILE), { recursive: true });
  if (!fs.existsSync(CHAT_HISTORY_FILE)) {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify({ history: [] }, null, 2), "utf-8");
  }
}

function ensureClientBootstrapFile() {
  fs.mkdirSync(path.dirname(CLIENT_BOOTSTRAP_FILE), { recursive: true });
  if (!fs.existsSync(CLIENT_BOOTSTRAP_FILE)) {
    fs.writeFileSync(
      CLIENT_BOOTSTRAP_FILE,
      JSON.stringify(
        {
          sender: {
            proxy_server: "",
            proxy_port: "",
            proxy_uuid: "",
            socks_listen_port: "1080",
            fallback_mode: "system_proxy",
            fallback_local_port: "",
            target_domains: DEFAULT_TARGET_DOMAINS,
          },
          update: {
            version: "",
            notes: "",
            publishedAt: "",
            windows: {
              url: "",
              fileName: "",
            },
            macos: {
              url: "",
              fileName: "",
            },
          },
          extra: {},
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

function normalizeBootstrapPayload(raw) {
  const sender = raw?.sender && typeof raw.sender === "object" ? raw.sender : {};
  const update = raw?.update && typeof raw.update === "object" ? raw.update : {};
  const windows = update?.windows && typeof update.windows === "object" ? update.windows : {};
  const macos = update?.macos && typeof update.macos === "object" ? update.macos : {};

  return {
    sender: {
      proxy_server: safeText(sender.proxy_server),
      proxy_port: safeText(sender.proxy_port),
      proxy_uuid: safeText(sender.proxy_uuid),
      socks_listen_port: safeText(sender.socks_listen_port) || "1080",
      fallback_mode: safeText(sender.fallback_mode) || "system_proxy",
      fallback_local_port: safeText(sender.fallback_local_port),
      target_domains: safeText(sender.target_domains) || DEFAULT_TARGET_DOMAINS,
    },
    update: {
      version: safeText(update.version),
      notes: safeText(update.notes),
      publishedAt: safeText(update.publishedAt),
      windows: {
        url: safeText(windows.url),
        fileName: safeText(windows.fileName),
      },
      macos: {
        url: safeText(macos.url),
        fileName: safeText(macos.fileName),
      },
    },
    extra: raw?.extra && typeof raw.extra === "object" ? raw.extra : {},
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
}

function requestHostname(req) {
  const forwardedHost = safeText(req?.headers?.["x-forwarded-host"]).split(",")[0];
  const rawHost = forwardedHost || safeText(req?.headers?.host);
  if (!rawHost) return "";
  if (rawHost.startsWith("[")) {
    const end = rawHost.indexOf("]");
    return end > 0 ? rawHost.slice(1, end) : rawHost;
  }
  return rawHost.split(":")[0];
}

function serverSuggestedBootstrap(req) {
  const host = requestHostname(req);
  return normalizeBootstrapPayload({
    sender: {
      proxy_server: firstNonEmpty(SERVER_SENDER_BOOTSTRAP.proxy_server, host),
      proxy_port: SERVER_SENDER_BOOTSTRAP.proxy_port,
      proxy_uuid: SERVER_SENDER_BOOTSTRAP.proxy_uuid,
      socks_listen_port: SERVER_SENDER_BOOTSTRAP.socks_listen_port,
      fallback_mode: SERVER_SENDER_BOOTSTRAP.fallback_mode,
      fallback_local_port: SERVER_SENDER_BOOTSTRAP.fallback_local_port,
      target_domains: firstNonEmpty(SERVER_SENDER_BOOTSTRAP.target_domains, DEFAULT_TARGET_DOMAINS),
    },
  });
}

function mergeServerBootstrapFallback(stored, req) {
  const normalized = normalizeBootstrapPayload(stored);
  const suggested = serverSuggestedBootstrap(req);
  return {
    ...normalized,
    sender: {
      ...normalized.sender,
      proxy_server: normalized.sender.proxy_server || suggested.sender.proxy_server,
      proxy_port: normalized.sender.proxy_port || suggested.sender.proxy_port,
      proxy_uuid: normalized.sender.proxy_uuid || suggested.sender.proxy_uuid,
      socks_listen_port: normalized.sender.socks_listen_port || suggested.sender.socks_listen_port,
      fallback_mode: normalized.sender.fallback_mode || suggested.sender.fallback_mode,
      fallback_local_port:
        normalized.sender.fallback_local_port || suggested.sender.fallback_local_port,
      target_domains: normalized.sender.target_domains || suggested.sender.target_domains,
    },
  };
}

function loadClientBootstrap(req = null) {
  ensureClientBootstrapFile();
  try {
    const raw = JSON.parse(fs.readFileSync(CLIENT_BOOTSTRAP_FILE, "utf-8"));
    return mergeServerBootstrapFallback(raw, req);
  } catch {
    return mergeServerBootstrapFallback({}, req);
  }
}

function saveClientBootstrap(payload) {
  const normalized = normalizeBootstrapPayload(payload);
  writeJsonAtomic(CLIENT_BOOTSTRAP_FILE, normalized);
  return normalized;
}

function ensureReleasesDir() {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}

function normalizeAttachment(record) {
  const dataUrl = safeText(record?.dataUrl);
  const size = Math.max(0, Number.parseInt(String(record?.size || "0"), 10) || 0);
  if (!dataUrl || size > MAX_ATTACHMENT_BYTES) {
    return null;
  }

  return {
    kind: safeText(record?.kind) === "image" ? "image" : "file",
    name: safeText(record?.name).slice(0, 200) || "file",
    mime: safeText(record?.mime).slice(0, 200),
    size,
    dataUrl,
  };
}

function normalizeReplyTarget(record) {
  const id = safeText(record?.id);
  if (!id) return null;

  return {
    id,
    from: safeText(record?.from || record?.username),
    displayName: safeText(record?.displayName || record?.username || record?.from) || "消息",
    preview: safeText(record?.preview).slice(0, 240) || "原消息",
    timestamp: safeText(record?.timestamp),
  };
}

function normalizeForwardedFrom(record) {
  const from = safeText(record?.from || record?.username);
  if (!from) return null;

  return {
    from,
    displayName: safeText(record?.displayName || record?.username || record?.from) || "转发消息",
  };
}

function normalizeReadByEntry(record) {
  const username = safeText(record?.username || record?.from);
  if (!username) return null;
  return {
    username,
    displayName: safeText(record?.displayName || record?.username || record?.from) || username,
    readAt: safeText(record?.readAt || record?.timestamp) || nowIso(),
  };
}

function stableMessageId(record) {
  const payload = {
    scope: safeText(record?.scope),
    from: safeText(record?.from || record?.username),
    to: safeText(record?.to),
    username: safeText(record?.username || record?.from),
    text: String(record?.text || ""),
    timestamp: safeText(record?.timestamp),
    subnetKey: safeText(record?.subnetKey),
    subnetLabel: safeText(record?.subnetLabel || record?.roomScope),
    replyTo: safeText(record?.replyTo?.id),
  };
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

function normalizeHistoryMessage(record) {
  const recalled = Boolean(record?.recalled);
  const scope = safeText(record?.scope) === "private" ? "private" : "subnet";
  const text = recalled ? "" : String(record?.text || "").slice(0, 8000);
  const attachments = recalled
    ? []
    : Array.isArray(record?.attachments)
      ? record.attachments
          .map(normalizeAttachment)
          .filter(Boolean)
          .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
      : [];
  const replyTo = normalizeReplyTarget(record?.replyTo);
  const forwardedFrom = normalizeForwardedFrom(record?.forwardedFrom);

  if (!recalled && !safeText(text) && !attachments.length) {
    return null;
  }

  return {
    id: safeText(record?.id) || stableMessageId(record),
    type: "chat",
    scope,
    from: safeText(record?.from || record?.username),
    to: safeText(record?.to),
    username: safeText(record?.username || record?.from),
    displayName: safeText(record?.displayName || record?.username || record?.from),
    avatar: safeText(record?.avatar),
    text,
    attachments,
    replyTo,
    forwardedFrom,
    subnetKey: safeText(record?.subnetKey),
    subnetLabel: safeText(record?.subnetLabel || record?.roomScope),
    timestamp: safeText(record?.timestamp) || nowIso(),
    readAt: scope === "private" ? safeText(record?.readAt) : "",
    readBy:
      scope === "subnet"
        ? Array.isArray(record?.readBy)
          ? record.readBy.map(normalizeReadByEntry).filter(Boolean)
          : []
        : [],
    edited: Boolean(record?.edited),
    editedAt: Boolean(record?.edited) ? safeText(record?.editedAt) || nowIso() : "",
    recalled,
    recalledAt: recalled ? safeText(record?.recalledAt) || nowIso() : "",
  };
}

function messageActivityTimestamp(record) {
  const readByLatest = Array.isArray(record?.readBy)
    ? record.readBy
        .map((item) => safeText(item?.readAt))
        .filter(Boolean)
        .sort()
        .at(-1)
    : "";
  return safeText(
    readByLatest || record?.readAt || record?.editedAt || record?.recalledAt || record?.timestamp,
  );
}

function loadChatHistoryStore() {
  ensureChatHistoryFile();
  try {
    const raw = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, "utf-8"));
    const items = Array.isArray(raw.history)
      ? raw.history.map(normalizeHistoryMessage).filter(Boolean)
      : [];
    if (items.length > HISTORY_MAX) {
      items.splice(0, items.length - HISTORY_MAX);
    }
    return items;
  } catch {
    return [];
  }
}

function saveChatHistoryStore(items) {
  const history = Array.isArray(items) ? items.map(normalizeHistoryMessage).filter(Boolean) : [];
  if (history.length > HISTORY_MAX) {
    history.splice(0, history.length - HISTORY_MAX);
  }
  writeJsonAtomic(CHAT_HISTORY_FILE, { history });
}

const history = loadChatHistoryStore();

function loadGptUsageStore() {
  ensureGptUsageFile();
  try {
    const raw = JSON.parse(fs.readFileSync(GPT_USAGE_FILE, "utf-8"));
    const events = Array.isArray(raw.events)
      ? raw.events.map(normalizeUsageEvent).filter((item) => item.username)
      : [];
    return { events };
  } catch {
    return { events: [] };
  }
}

function saveGptUsageStore(store) {
  const events = Array.isArray(store?.events)
    ? store.events.map(normalizeUsageEvent).filter((item) => item.username)
    : [];
  if (events.length > GPT_USAGE_MAX) {
    events.splice(0, events.length - GPT_USAGE_MAX);
  }
  writeJsonAtomic(GPT_USAGE_FILE, { events });
}

function recordGptUsage(username, count = 1) {
  const normalizedUsername = safeText(username);
  if (!normalizedUsername) return;
  const usageStore = loadGptUsageStore();
  usageStore.events.push({
    username: normalizedUsername,
    timestamp: nowIso(),
    count: Math.max(1, Number.parseInt(String(count || "1"), 10) || 1),
  });
  saveGptUsageStore(usageStore);
}

// ===== 组队(共享)日历: 房间(subnetKey)维度的团队事件 =====
// 数据模型 TeamEvent {
//   id, subnetKey, title, description?, location?, start(ISO), end(ISO), allDay,
//   organizer(username), attendees:[{username, displayName, rsvp}], color?,
//   createdBy, createdAt, updatedAt
// }
// 持久化镜像聊天历史: ensure -> load(normalize) -> writeJsonAtomic。

const CALENDAR_RSVP_VALUES = ["needs_action", "accept", "decline", "tentative"];

function ensureCalendarsFile() {
  fs.mkdirSync(path.dirname(CALENDARS_FILE), { recursive: true });
  if (!fs.existsSync(CALENDARS_FILE)) {
    fs.writeFileSync(CALENDARS_FILE, JSON.stringify({ events: [] }, null, 2), "utf-8");
  }
}

function normalizeRsvp(value) {
  const v = safeText(value);
  return CALENDAR_RSVP_VALUES.includes(v) ? v : "needs_action";
}

function normalizeAttendee(record) {
  const username = safeText(record?.username);
  if (!username) return null;
  return {
    username,
    displayName: safeText(record?.displayName) || username,
    rsvp: normalizeRsvp(record?.rsvp),
  };
}

function normalizeTeamEvent(record) {
  const id = safeText(record?.id);
  const title = safeText(record?.title).slice(0, 200);
  const start = safeText(record?.start);
  const end = safeText(record?.end);
  if (!id || !start) return null;
  const attendees = Array.isArray(record?.attendees)
    ? record.attendees.map(normalizeAttendee).filter(Boolean)
    : [];
  // 同名去重 (后者覆盖前者)。
  const dedupAttendees = [];
  const seen = new Set();
  for (const a of attendees) {
    if (seen.has(a.username)) {
      const idx = dedupAttendees.findIndex((x) => x.username === a.username);
      if (idx >= 0) dedupAttendees[idx] = a;
      continue;
    }
    seen.add(a.username);
    dedupAttendees.push(a);
  }
  return {
    id,
    subnetKey: safeText(record?.subnetKey),
    title,
    description: safeText(record?.description).slice(0, 2000),
    location: safeText(record?.location).slice(0, 200),
    start,
    end: end || start,
    allDay: Boolean(record?.allDay),
    organizer: safeText(record?.organizer),
    attendees: dedupAttendees,
    color: safeText(record?.color).slice(0, 32),
    createdBy: safeText(record?.createdBy),
    createdAt: safeText(record?.createdAt) || nowIso(),
    updatedAt: safeText(record?.updatedAt) || nowIso(),
  };
}

function loadCalendarStore() {
  ensureCalendarsFile();
  try {
    const raw = JSON.parse(fs.readFileSync(CALENDARS_FILE, "utf-8"));
    const events = Array.isArray(raw.events)
      ? raw.events.map(normalizeTeamEvent).filter(Boolean)
      : [];
    return { events };
  } catch {
    return { events: [] };
  }
}

function saveCalendarStore(store) {
  const events = Array.isArray(store?.events)
    ? store.events.map(normalizeTeamEvent).filter(Boolean)
    : [];
  writeJsonAtomic(CALENDARS_FILE, { events });
}

function eventsForSubnet(subnetKey) {
  return loadCalendarStore().events.filter((e) => e.subnetKey === subnetKey);
}

// —— 个人云端存储 (按用户隔离: 个人日历 calendar / 待办备忘 tasks) ——
// 结构: { stores: { [username]: { calendar: {rev,updatedAt,data}, tasks: {rev,updatedAt,data} } } }
// rev 为单调递增整数, 用于乐观并发: 客户端写入须带 baseRev=当前 rev, 不匹配则拒绝(防止老版本覆盖新版本)。
const USER_STORE_KINDS = new Set(["calendar", "tasks", "notes"]);

function loadUserStores() {
  try {
    if (!fs.existsSync(USER_STORES_FILE)) return { stores: {} };
    const raw = JSON.parse(fs.readFileSync(USER_STORES_FILE, "utf8"));
    return raw && typeof raw.stores === "object" && raw.stores ? raw : { stores: {} };
  } catch {
    return { stores: {} };
  }
}

function saveUserStores(store) {
  writeJsonAtomic(USER_STORES_FILE, { stores: store?.stores || {} });
}

function getUserStoreEntry(stores, username, kind) {
  const u = stores.stores[username];
  const e = u && u[kind];
  return e && typeof e === "object" && Number.isInteger(e.rev)
    ? e
    : { rev: 0, updatedAt: "", data: null };
}

// 纯函数: 对 stores 做一次乐观并发写入。baseRev 必须等于当前 rev, 否则返回冲突(不修改 stores)。
// 返回 { ok, conflict?, rev, updatedAt, data }; ok 时 stores 已就地更新(调用方负责持久化)。
function putUserStore(stores, username, kind, baseRev, data) {
  const entry = getUserStoreEntry(stores, username, kind);
  if (baseRev !== entry.rev) {
    return {
      ok: false,
      conflict: true,
      rev: entry.rev,
      updatedAt: entry.updatedAt,
      data: entry.data,
    };
  }
  const next = { rev: entry.rev + 1, updatedAt: nowIso(), data };
  stores.stores[username] = stores.stores[username] || {};
  stores.stores[username][kind] = next;
  return { ok: true, rev: next.rev, updatedAt: next.updatedAt, data };
}

// 把负载实时下发给同一用户的其它在线端 (按 username 匹配, 排除发起端 token)。
function broadcastToUser(username, payload, exceptToken) {
  for (const client of wsClients) {
    if (client.username !== username) continue;
    if (exceptToken && client.token === exceptToken) continue;
    sendToClient(client, payload);
  }
}

function findUser(username) {
  const store = loadUserStore();
  const user = store.users.find((item) => item.username === username && !item.disabled);
  return { store, user };
}

function hasEnabledAdminUser() {
  const store = loadUserStore();
  return store.users.some((item) => item.isAdmin && !item.disabled);
}

function hashPassword(password, salt, iterations, digest) {
  const actualIterations = Number.isInteger(iterations) ? iterations : 120000;
  const actualDigest = digest || "sha256";
  return crypto.pbkdf2Sync(password, salt, actualIterations, 32, actualDigest).toString("hex");
}

function verifyPassword(user, password) {
  if (!user || !user.passwordHash || !user.salt) return false;
  const actual = hashPassword(password, user.salt, user.iterations, user.digest);
  try {
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(user.passwordHash));
  } catch {
    return false;
  }
}

function makeToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeIp(rawIp) {
  const raw = String(rawIp || "").trim();
  if (!raw) return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.replace("::ffff:", "");
  if (raw === "::1") return "127.0.0.1";
  return raw;
}

// 登录限流辅助: 按 IP 记失败次数, 达到阈值后锁定一段时间。
function loginLockState(ip) {
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockUntil && rec.lockUntil > Date.now()) {
    return { locked: true, retryAfterMs: rec.lockUntil - Date.now() };
  }
  return { locked: false, retryAfterMs: 0 };
}
function recordLoginFail(ip) {
  const rec = loginAttempts.get(ip) || { fails: 0, lockUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    rec.lockUntil = Date.now() + LOGIN_LOCK_MS;
    rec.fails = 0;
  }
  loginAttempts.set(ip, rec);
}
function clearLoginFails(ip) {
  loginAttempts.delete(ip);
}

function subnetKeyFromIp(ip) {
  // 移除网段隔离机制，使得房间消息跨网段互通
  return "global";
}

function subnetLabelFromIp(ip) {
  return "公共房间";
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  });
  res.end(text);
}

function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

function extractBearer(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      const ws = wsByToken.get(token);
      if (ws && ws.readyState === ws.OPEN) {
        ws.close(4002, "session_expired");
      }
      wsByToken.delete(token);
    }
  }
  for (const [token, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function getOnlineClientMap() {
  const map = new Map();
  for (const client of wsClients) {
    if (client.readyState !== client.OPEN || !client.username) continue;
    if (!map.has(client.username)) {
      map.set(client.username, client);
    }
  }
  return map;
}

function activeUsers() {
  const list = [];
  const map = getOnlineClientMap();
  for (const [username, client] of map.entries()) {
    list.push({
      username,
      displayName: safeText(client.displayName) || username,
      avatar: safeText(client.avatar),
      avatarKind: safeText(client.avatarKind) || inferAvatarKind(client.avatar),
      subnetKey: safeText(client.subnetKey),
      subnetLabel: safeText(client.subnetLabel),
      client: normalizeClientInfo(client.clientInfo),
      online: true,
    });
  }

  list.sort((a, b) => a.username.localeCompare(b.username));
  return list;
}

function buildUserDirectory() {
  const store = loadUserStore();
  const onlineMap = getOnlineClientMap();

  const users = store.users
    .filter((item) => !item.disabled)
    .map((user) => {
      const onlineClient = onlineMap.get(user.username);
      return {
        username: user.username,
        displayName: safeText(user.displayName) || user.username,
        avatar: safeText(user.avatar),
        avatarKind: safeText(user.avatarKind) || inferAvatarKind(user.avatar),
        bio: safeText(user.bio),
        online: Boolean(onlineClient),
        subnetKey: safeText(onlineClient?.subnetKey),
        subnetLabel: safeText(onlineClient?.subnetLabel),
        client: onlineClient
          ? normalizeClientInfo(onlineClient.clientInfo)
          : normalizeClientInfo(user.lastClient),
      };
    });

  users.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return users;
}

function getPublicProfile(username) {
  const { user } = findUser(username);
  if (!user) {
    return {
      username,
      displayName: username,
      avatar: "",
      avatarKind: "emoji",
      bio: "",
    };
  }

  return {
    username: user.username,
    displayName: safeText(user.displayName) || user.username,
    avatar: safeText(user.avatar),
    avatarKind: safeText(user.avatarKind) || inferAvatarKind(user.avatar),
    bio: safeText(user.bio),
  };
}

function sendToClient(client, payload) {
  if (!client || client.readyState !== client.OPEN) return;
  client.send(JSON.stringify(payload));
}

function broadcastToSubnet(subnetKey, payload) {
  for (const client of wsClients) {
    if (client.subnetKey === subnetKey) {
      sendToClient(client, payload);
    }
  }
}

function broadcastPresence() {
  const online = activeUsers();
  for (const client of wsClients) {
    sendToClient(client, {
      type: "presence",
      users: online,
      roomScope: client.subnetLabel,
      timestamp: nowIso(),
    });
  }
}

function addHistory(message) {
  const normalized = normalizeHistoryMessage(message);
  if (!normalized) return;
  history.push(normalized);
  if (history.length > HISTORY_MAX) {
    history.splice(0, history.length - HISTORY_MAX);
  }
  saveChatHistoryStore(history);
}

function resolveAdminSessionByToken(token) {
  const normalized = safeText(token);
  if (!normalized) return null;
  const session = adminSessions.get(normalized);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(normalized);
    return null;
  }
  return session;
}

function requireAdminSession(req, res) {
  const token = extractBearer(req);
  const session = resolveAdminSessionByToken(token);
  if (!session) {
    sendText(res, 401, "管理员未授权");
    return null;
  }
  return session;
}

function createUserRecord(username, password, extra = {}) {
  const normalized = safeText(username);
  const pwd = String(password || "");
  if (!normalized) {
    throw new Error("用户名不能为空");
  }
  if (pwd.length < 6) {
    throw new Error("密码长度至少 6 位");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const now = nowIso();
  return normalizeUserRecord({
    username: normalized,
    salt,
    passwordHash: hashPassword(pwd, salt, 120000, "sha256"),
    iterations: 120000,
    digest: "sha256",
    avatar: safeText(extra.avatar).slice(0, MAX_AVATAR_LENGTH),
    bio: safeText(extra.bio).slice(0, 200),
    displayName: safeText(extra.displayName) || normalized,
    isAdmin: Boolean(extra.isAdmin),
    disabled: Boolean(extra.disabled),
    createdAt: safeText(extra.createdAt) || now,
    updatedAt: now,
  });
}

function readRawBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function adminUserSummary(user) {
  const onlineMap = getOnlineClientMap();
  const onlineClient = onlineMap.get(user.username);
  return {
    username: user.username,
    displayName: safeText(user.displayName) || user.username,
    avatar: safeText(user.avatar),
    avatarKind: safeText(user.avatarKind) || inferAvatarKind(user.avatar),
    bio: safeText(user.bio),
    isAdmin: Boolean(user.isAdmin),
    disabled: Boolean(user.disabled),
    online: Boolean(onlineClient),
    client: onlineClient
      ? normalizeClientInfo(onlineClient.clientInfo)
      : normalizeClientInfo(user.lastClient),
    createdAt: safeText(user.createdAt),
    updatedAt: safeText(user.updatedAt),
  };
}

function getBaseUrl(req) {
  const proto = safeText(req.headers["x-forwarded-proto"]) || "http";
  const host = safeText(req.headers["x-forwarded-host"] || req.headers.host);
  return host ? `${proto}://${host}` : "";
}

function safeDownloadName(rawName) {
  const base = path
    .basename(String(rawName || "").trim())
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
  return base || "";
}

function releasePublicUrl(req, fileName) {
  const base = getBaseUrl(req);
  if (!base) return "";
  return `${base}/downloads/${encodeURIComponent(fileName)}`;
}

function serveReleaseDownload(req, res, pathname) {
  const fileName = decodeURIComponent(String(pathname || "").replace(/^\/downloads\//, ""));
  const safeName = safeDownloadName(fileName);
  if (!safeName) {
    sendText(res, 404, "Not Found");
    return true;
  }
  const filePath = path.join(RELEASES_DIR, safeName);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not Found");
    return true;
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": fs.statSync(filePath).size,
    "Content-Disposition": `attachment; filename="${safeName}"`,
    "Access-Control-Allow-Origin": CORS_ORIGIN,
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function findHistoryMessage(messageId) {
  const id = safeText(messageId);
  if (!id) return { index: -1, message: null };
  const index = history.findIndex((item) => item.id === id);
  return {
    index,
    message: index >= 0 ? history[index] : null,
  };
}

function persistHistorySnapshot() {
  saveChatHistoryStore(history);
}

function buildHistorySyncPayload(client, sinceTimestamp = "") {
  const visible = visibleHistoryForClient(client);
  const sinceMs = safeText(sinceTimestamp) ? new Date(sinceTimestamp).getTime() : Number.NaN;
  const filtered = Number.isFinite(sinceMs)
    ? visible.filter((item) => {
        const ts = new Date(messageActivityTimestamp(item)).getTime();
        return Number.isFinite(ts) && ts > sinceMs;
      })
    : visible;

  return {
    type: "history_sync",
    messages: filtered,
    roomScope: client.subnetLabel,
    timestamp: nowIso(),
  };
}

function visibleHistoryForIdentity(username, subnetKey) {
  return history.filter((item) => {
    if (item.scope === "private") {
      return item.from === username || item.to === username;
    }
    return item.subnetKey === subnetKey;
  });
}

function visibleHistoryForClient(client) {
  return visibleHistoryForIdentity(client.username, client.subnetKey);
}

function markPrivateMessagesRead(username, messageIds, conversationWith = "") {
  const reader = safeText(username);
  const fromUser = safeText(conversationWith);
  const ids = Array.isArray(messageIds)
    ? [...new Set(messageIds.map((item) => safeText(item)).filter(Boolean))]
    : [];

  if (!reader || !ids.length) return [];

  const now = nowIso();
  const updated = [];

  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (item.scope !== "private") continue;
    if (item.to !== reader) continue;
    if (fromUser && item.from !== fromUser) continue;
    if (!ids.includes(item.id)) continue;
    if (safeText(item.readAt)) continue;

    const next = {
      ...item,
      readAt: now,
    };
    history[index] = next;
    updated.push(next);
  }

  if (updated.length) {
    persistHistorySnapshot();
  }

  return updated;
}

function markSubnetMessagesRead(client, messageIds) {
  const reader = safeText(client?.username);
  const displayName = safeText(client?.displayName) || reader;
  const subnetKey = safeText(client?.subnetKey);
  const ids = Array.isArray(messageIds)
    ? [...new Set(messageIds.map((item) => safeText(item)).filter(Boolean))]
    : [];

  if (!reader || !subnetKey || !ids.length) return [];

  const now = nowIso();
  const updated = [];

  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (item.scope !== "subnet") continue;
    if (item.subnetKey !== subnetKey) continue;
    if (!ids.includes(item.id)) continue;
    if (item.system || item.recalled) continue;
    if (item.from === reader) continue;

    const currentReaders = Array.isArray(item.readBy)
      ? item.readBy.map(normalizeReadByEntry).filter(Boolean)
      : [];
    if (currentReaders.some((entry) => entry.username === reader)) continue;

    const next = {
      ...item,
      readBy: [
        ...currentReaders,
        {
          username: reader,
          displayName,
          readAt: now,
        },
      ],
    };
    history[index] = next;
    updated.push(next);
  }

  if (updated.length) {
    persistHistorySnapshot();
  }

  return updated;
}

function closeDuplicateConnections(username, exceptClient) {
  for (const client of wsClients) {
    if (
      client !== exceptClient &&
      client.username === username &&
      client.readyState === client.OPEN
    ) {
      client.close(4003, "duplicate_login");
    }
  }
}

function resolveSessionByToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function applyProfileUpdate(session, user, payload) {
  const displayName = safeText(payload?.displayName).slice(0, 30) || user.username;
  const bio = safeText(payload?.bio).slice(0, 200);
  const avatarKind = "emoji";
  const avatar = toSingleAvatarChar(payload?.avatar);

  user.displayName = displayName;
  user.bio = bio;
  user.avatarKind = avatarKind;
  user.avatar = avatar;
  user.updatedAt = nowIso();

  session.displayName = displayName;
  session.avatarKind = avatarKind;
  session.avatar = avatar;

  const ws = wsByToken.get(session.token);
  if (ws && ws.readyState === ws.OPEN) {
    ws.displayName = displayName;
    ws.avatarKind = avatarKind;
    ws.avatar = avatar;
  }
}

function parseRangeBoundary(rawValue, endOfDay = false) {
  const raw = safeText(rawValue);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const parsed = new Date(`${raw}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildGptUsageStats(fromRaw, toRaw) {
  const fromDate = parseRangeBoundary(fromRaw, false);
  const toDate = parseRangeBoundary(toRaw, true);

  if (fromRaw && !fromDate) {
    throw new Error("开始时间格式不正确");
  }
  if (toRaw && !toDate) {
    throw new Error("结束时间格式不正确");
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new Error("开始时间不能晚于结束时间");
  }

  const usageStore = loadGptUsageStore();
  const fromMs = fromDate ? fromDate.getTime() : Number.NEGATIVE_INFINITY;
  const toMs = toDate ? toDate.getTime() : Number.POSITIVE_INFINITY;

  const filteredEvents = usageStore.events.filter((item) => {
    const ts = new Date(item.timestamp).getTime();
    if (!Number.isFinite(ts)) return false;
    return ts >= fromMs && ts <= toMs;
  });

  const userStore = loadUserStore();
  const displayNameMap = new Map(
    userStore.users
      .filter((item) => !item.disabled)
      .map((item) => [item.username, safeText(item.displayName) || item.username]),
  );

  const counter = new Map();
  let totalQueries = 0;

  for (const item of filteredEvents) {
    const username = safeText(item.username);
    const count = Math.max(1, Number(item.count) || 1);
    if (!username) continue;
    counter.set(username, (counter.get(username) || 0) + count);
    totalQueries += count;
  }

  const users = [...counter.entries()]
    .map(([username, count]) => ({
      username,
      displayName: displayNameMap.get(username) || username,
      count,
      ratio: totalQueries > 0 ? count / totalQueries : 0,
    }))
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));

  return {
    from: fromDate ? fromDate.toISOString() : "",
    to: toDate ? toDate.toISOString() : "",
    totalQueries,
    userCount: users.length,
    users,
    serverTime: nowIso(),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = reqUrl.pathname;

  if (req.method === "GET" && pathname.startsWith("/downloads/")) {
    ensureReleasesDir();
    if (serveReleaseDownload(req, res, pathname)) {
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      serverTime: nowIso(),
      online: activeUsers().length,
      sessions: sessions.size,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/login") {
    try {
      cleanupExpiredSessions();
      const body = await readBody(req);
      const payload = safeParseJson(body);
      const username = safeText(payload?.username);
      const password = String(payload?.password || "");
      const clientInfo = normalizeClientInfo({
        ...(payload?.client && typeof payload.client === "object" ? payload.client : {}),
        reportedAt: nowIso(),
      });

      if (!username || !password) {
        sendText(res, 400, "用户名或密码不能为空");
        return;
      }

      const remoteIp = normalizeIp(req.socket?.remoteAddress);
      const lock = loginLockState(remoteIp);
      if (lock.locked) {
        sendText(res, 429, `登录失败次数过多，请 ${Math.ceil(lock.retryAfterMs / 1000)} 秒后再试`);
        return;
      }

      const { store, user } = findUser(username);
      if (!user || !verifyPassword(user, password)) {
        recordLoginFail(remoteIp);
        sendText(res, 401, "账号或密码错误");
        return;
      }
      clearLoginFails(remoteIp);

      for (const [oldToken, session] of sessions.entries()) {
        if (session.username === username) {
          sessions.delete(oldToken);
          const oldWs = wsByToken.get(oldToken);
          if (oldWs && oldWs.readyState === oldWs.OPEN) {
            oldWs.close(4003, "duplicate_login");
          }
          wsByToken.delete(oldToken);
        }
      }

      const token = makeToken();
      const now = Date.now();
      const subnetKey = subnetKeyFromIp(remoteIp);
      const subnetLabel = subnetLabelFromIp(remoteIp);

      user.lastClient = clientInfo;
      user.updatedAt = nowIso();
      saveUserStore(store);

      sessions.set(token, {
        token,
        username,
        displayName: safeText(user.displayName) || username,
        avatar: safeText(user.avatar),
        avatarKind: safeText(user.avatarKind) || inferAvatarKind(user.avatar),
        issuedAt: now,
        expiresAt: now + SESSION_TTL_MS,
        subnetKey,
        subnetLabel,
        clientInfo,
      });

      sendJson(res, 200, {
        token,
        username,
        profile: getPublicProfile(username),
        roomScope: subnetLabel,
        users: buildUserDirectory(),
        history: visibleHistoryForIdentity(username, subnetKey),
      });
    } catch (err) {
      sendText(res, 500, err.message || "登录失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const token = extractBearer(req);
    if (!token) {
      sendText(res, 401, "未授权");
      return;
    }

    sessions.delete(token);
    const ws = wsByToken.get(token);
    if (ws && ws.readyState === ws.OPEN) {
      ws.close(4000, "logout");
    }
    wsByToken.delete(token);

    sendJson(res, 200, { ok: true });
    setTimeout(broadcastPresence, 10);
    return;
  }

  if (req.method === "GET" && pathname === "/api/users") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    sendJson(res, 200, {
      users: buildUserDirectory(),
      roomScope: session.subnetLabel,
      timestamp: nowIso(),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/profile") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    sendJson(res, 200, {
      profile: getPublicProfile(session.username),
      roomScope: session.subnetLabel,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    try {
      cleanupExpiredSessions();
      const body = await readBody(req);
      const payload = safeParseJson(body);
      const username = safeText(payload?.username);
      const password = String(payload?.password || "");
      const remoteIp = normalizeIp(req.socket?.remoteAddress);
      const lock = loginLockState(remoteIp);
      if (lock.locked) {
        sendText(res, 429, `登录失败次数过多，请 ${Math.ceil(lock.retryAfterMs / 1000)} 秒后再试`);
        return;
      }
      const { user } = findUser(username);

      if (!user || !user.isAdmin || user.disabled || !verifyPassword(user, password)) {
        recordLoginFail(remoteIp);
        sendText(res, 401, "管理员账号或密码错误");
        return;
      }
      clearLoginFails(remoteIp);

      const token = makeToken();
      const now = Date.now();
      adminSessions.set(token, {
        token,
        username,
        displayName: safeText(user.displayName) || username,
        issuedAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });

      sendJson(res, 200, {
        token,
        profile: adminUserSummary(user),
      });
    } catch (err) {
      sendText(res, 500, err.message || "管理员登录失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/setup") {
    try {
      if (hasEnabledAdminUser()) {
        sendText(res, 409, "服务器已经存在管理员账号");
        return;
      }
      const body = await readBody(req);
      const payload = safeParseJson(body) || {};
      const username = safeText(payload.username);
      const password = String(payload.password || "");
      const displayName = safeText(payload.displayName) || username;

      const store = loadUserStore();
      const existing = store.users.find((item) => item.username === username);
      if (existing) {
        sendText(res, 409, "该用户已存在");
        return;
      }

      const record = createUserRecord(username, password, {
        displayName,
        isAdmin: true,
      });
      store.users.push(record);
      saveUserStore(store);

      const token = makeToken();
      const now = Date.now();
      adminSessions.set(token, {
        token,
        username,
        displayName: safeText(record.displayName) || username,
        issuedAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });

      sendJson(res, 200, {
        token,
        profile: adminUserSummary(record),
      });
    } catch (err) {
      sendText(res, 400, err.message || "初始化管理员失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = extractBearer(req);
    if (token) {
      adminSessions.delete(token);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    const store = loadUserStore();
    sendJson(res, 200, {
      users: store.users.map(adminUserSummary).sort((a, b) => a.username.localeCompare(b.username)),
      admin: {
        username: adminSession.username,
        displayName: adminSession.displayName,
      },
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/users") {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    try {
      const body = await readBody(req);
      const payload = safeParseJson(body) || {};
      const username = safeText(payload.username);
      const password = String(payload.password || "");
      const store = loadUserStore();
      const existing = store.users.find((item) => item.username === username);
      if (existing) {
        sendText(res, 409, "该用户已存在");
        return;
      }

      const record = createUserRecord(username, password, payload);
      store.users.push(record);
      saveUserStore(store);
      sendJson(res, 200, {
        ok: true,
        user: adminUserSummary(record),
      });
    } catch (err) {
      sendText(res, 400, err.message || "创建用户失败");
    }
    return;
  }

  if (
    (req.method === "PATCH" || req.method === "PUT") &&
    pathname.startsWith("/api/admin/users/")
  ) {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    try {
      const username = decodeURIComponent(pathname.slice("/api/admin/users/".length));
      const store = loadUserStore();
      const user = store.users.find((item) => item.username === username);
      if (!user) {
        sendText(res, 404, "用户不存在");
        return;
      }

      const body = await readBody(req);
      const payload = safeParseJson(body) || {};
      const nextPassword = String(payload.password || "");

      if (typeof payload.displayName !== "undefined")
        user.displayName = safeText(payload.displayName).slice(0, 30) || user.username;
      if (typeof payload.bio !== "undefined") user.bio = safeText(payload.bio).slice(0, 200);
      if (typeof payload.avatar !== "undefined") {
        user.avatar = safeText(payload.avatar).slice(0, MAX_AVATAR_LENGTH);
        user.avatarKind = inferAvatarKind(user.avatar);
      }
      if (typeof payload.disabled !== "undefined") user.disabled = Boolean(payload.disabled);
      if (typeof payload.isAdmin !== "undefined") user.isAdmin = Boolean(payload.isAdmin);
      if (nextPassword) {
        const salt = crypto.randomBytes(16).toString("hex");
        user.salt = salt;
        user.passwordHash = hashPassword(nextPassword, salt, 120000, "sha256");
        user.iterations = 120000;
        user.digest = "sha256";
      }
      user.updatedAt = nowIso();
      saveUserStore(store);
      sendJson(res, 200, {
        ok: true,
        user: adminUserSummary(normalizeUserRecord(user)),
      });
    } catch (err) {
      sendText(res, 400, err.message || "更新用户失败");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/bootstrap") {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    sendJson(res, 200, loadClientBootstrap(req));
    return;
  }

  if ((req.method === "PUT" || req.method === "POST") && pathname === "/api/admin/bootstrap") {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    try {
      const body = await readBody(req, 512 * 1024);
      const payload = safeParseJson(body) || {};
      const saved = saveClientBootstrap(payload);
      sendJson(res, 200, {
        ok: true,
        bootstrap: saved,
      });
    } catch (err) {
      sendText(res, 400, err.message || "保存客户端配置失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/releases/upload") {
    const adminSession = requireAdminSession(req, res);
    if (!adminSession) return;
    try {
      ensureReleasesDir();
      const platformKey = safeText(
        reqUrl.searchParams.get("platform") || req.headers["x-update-platform"],
      );
      if (!["windows", "macos"].includes(platformKey)) {
        sendText(res, 400, "缺少合法的平台标识");
        return;
      }
      const requestedName = safeDownloadName(
        reqUrl.searchParams.get("fileName") || req.headers["x-file-name"],
      );
      if (!requestedName) {
        sendText(res, 400, "缺少文件名");
        return;
      }
      const body = await readRawBody(req, 512 * 1024 * 1024);
      const filePath = path.join(RELEASES_DIR, requestedName);
      fs.writeFileSync(filePath, body);

      const bootstrap = loadClientBootstrap();
      bootstrap.update.version =
        safeText(reqUrl.searchParams.get("version") || req.headers["x-update-version"]) ||
        bootstrap.update.version;
      bootstrap.update.notes =
        safeText(reqUrl.searchParams.get("notes") || req.headers["x-update-notes"]) ||
        bootstrap.update.notes;
      bootstrap.update.publishedAt = nowIso();
      bootstrap.update[platformKey] = {
        url: releasePublicUrl(req, requestedName),
        fileName: requestedName,
      };
      const saved = saveClientBootstrap(bootstrap);

      sendJson(res, 200, {
        ok: true,
        fileName: requestedName,
        url: saved.update[platformKey].url,
        bootstrap: saved,
      });
    } catch (err) {
      sendText(res, 400, err.message || "上传安装包失败");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/client/bootstrap") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    sendJson(res, 200, {
      ...loadClientBootstrap(req),
      fetchedAt: nowIso(),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/profile/update") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    try {
      const body = await readBody(req, MAX_AVATAR_LENGTH + 64 * 1024);
      const payload = safeParseJson(body);
      const { store, user } = findUser(session.username);
      if (!user) {
        sendText(res, 404, "用户不存在");
        return;
      }

      applyProfileUpdate(session, user, payload || {});
      saveUserStore(store);

      const ws = wsByToken.get(token);
      if (ws && ws.readyState === ws.OPEN) {
        sendToClient(ws, {
          type: "session",
          username: ws.username,
          displayName: ws.displayName,
          avatar: ws.avatar,
          avatarKind: ws.avatarKind,
          roomScope: ws.subnetLabel,
          timestamp: nowIso(),
        });
      }

      broadcastPresence();
      sendJson(res, 200, {
        ok: true,
        profile: getPublicProfile(session.username),
      });
    } catch (err) {
      sendText(res, 500, err.message || "更新资料失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/profile/avatar") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    try {
      const body = await readBody(req);
      const payload = safeParseJson(body);
      const avatar = safeText(payload?.avatar);

      const { store, user } = findUser(session.username);
      if (!user) {
        sendText(res, 404, "用户不存在");
        return;
      }

      applyProfileUpdate(session, user, {
        displayName: user.displayName,
        bio: user.bio,
        avatar,
        avatarKind: inferAvatarKind(avatar),
      });

      saveUserStore(store);
      broadcastPresence();
      sendJson(res, 200, { ok: true, profile: getPublicProfile(session.username) });
    } catch (err) {
      sendText(res, 500, err.message || "更新头像失败");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/gpt/usage") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    try {
      const body = await readBody(req, 32 * 1024);
      const payload = safeParseJson(body) || {};
      const count = Math.max(
        1,
        Math.min(20, Number.parseInt(String(payload?.count || "1"), 10) || 1),
      );
      recordGptUsage(session.username, count);

      sendJson(res, 200, {
        ok: true,
        username: session.username,
        count,
        recordedAt: nowIso(),
      });
    } catch (err) {
      sendText(res, 500, err.message || "记录 GPT 使用次数失败");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/gpt/stats") {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }

    try {
      const stats = buildGptUsageStats(
        reqUrl.searchParams.get("from"),
        reqUrl.searchParams.get("to"),
      );
      sendJson(res, 200, stats);
    } catch (err) {
      sendText(res, 400, err.message || "查询 GPT 使用统计失败");
    }
    return;
  }

  // ===== 组队(共享)日历 REST =====
  // 鉴权统一: 复用聊天 token (extractBearer + resolveSessionByToken)。
  // 房间维度: 一律以 session.subnetKey 落库, 忽略客户端传入的 scope (同聊天信任模型)。
  // 变更后通过 WS broadcastToSubnet 广播给同房间在线客户端实时更新。
  if (pathname === "/api/team-calendar/events" && req.method === "GET") {
    const session = resolveSessionByToken(extractBearer(req));
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }
    sendJson(res, 200, { events: eventsForSubnet(session.subnetKey), serverTime: nowIso() });
    return;
  }

  if (pathname === "/api/team-calendar/events" && req.method === "POST") {
    const session = resolveSessionByToken(extractBearer(req));
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }
    try {
      const payload = safeParseJson(await readBody(req)) || {};
      const title = safeText(payload.title).slice(0, 200);
      const start = safeText(payload.start);
      if (!title || !start) {
        sendText(res, 400, "标题与开始时间必填");
        return;
      }
      const store = loadCalendarStore();
      const event = normalizeTeamEvent({
        ...payload,
        id: crypto.randomUUID(),
        subnetKey: session.subnetKey, // 服务端盖章
        title,
        organizer: session.username, // 组织者 = 创建者
        createdBy: session.username,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      store.events.push(event);
      saveCalendarStore(store);
      broadcastToSubnet(session.subnetKey, { type: "calendar_event_created", event });
      sendJson(res, 200, { event });
    } catch (err) {
      sendText(res, 500, err.message || "创建事件失败");
    }
    return;
  }

  // /api/team-calendar/events/:id  (PATCH / DELETE) 以及 .../:id/rsvp (POST)
  if (pathname.startsWith("/api/team-calendar/events/")) {
    const session = resolveSessionByToken(extractBearer(req));
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }
    const rest = pathname.slice("/api/team-calendar/events/".length);
    const isRsvp = rest.endsWith("/rsvp");
    const eventId = decodeURIComponent(isRsvp ? rest.slice(0, -"/rsvp".length) : rest);

    if (isRsvp && req.method === "POST") {
      try {
        const payload = safeParseJson(await readBody(req)) || {};
        const status = normalizeRsvp(payload.status);
        const store = loadCalendarStore();
        const event = store.events.find(
          (e) => e.id === eventId && e.subnetKey === session.subnetKey,
        );
        if (!event) {
          sendText(res, 404, "事件不存在");
          return;
        }
        const existing = event.attendees.find((a) => a.username === session.username);
        if (existing) {
          existing.rsvp = status;
        } else {
          // 允许房间成员主动响应即使未被显式邀请。
          event.attendees.push({
            username: session.username,
            displayName: session.displayName || session.username,
            rsvp: status,
          });
        }
        event.updatedAt = nowIso();
        saveCalendarStore(store);
        broadcastToSubnet(session.subnetKey, { type: "calendar_event_updated", event });
        sendJson(res, 200, { event });
      } catch (err) {
        sendText(res, 500, err.message || "更新 RSVP 失败");
      }
      return;
    }

    if (req.method === "PATCH") {
      try {
        const payload = safeParseJson(await readBody(req)) || {};
        const store = loadCalendarStore();
        const idx = store.events.findIndex(
          (e) => e.id === eventId && e.subnetKey === session.subnetKey,
        );
        if (idx < 0) {
          sendText(res, 404, "事件不存在");
          return;
        }
        const prev = store.events[idx];
        // MVP: 组织者或任意房间成员可编辑; 关键字段(id/subnetKey/organizer/createdBy/createdAt)不可被客户端改。
        const merged = normalizeTeamEvent({
          ...prev,
          ...payload,
          id: prev.id,
          subnetKey: prev.subnetKey,
          organizer: prev.organizer,
          createdBy: prev.createdBy,
          createdAt: prev.createdAt,
          updatedAt: nowIso(),
        });
        store.events[idx] = merged;
        saveCalendarStore(store);
        broadcastToSubnet(session.subnetKey, { type: "calendar_event_updated", event: merged });
        sendJson(res, 200, { event: merged });
      } catch (err) {
        sendText(res, 500, err.message || "编辑事件失败");
      }
      return;
    }

    if (req.method === "DELETE") {
      const store = loadCalendarStore();
      const idx = store.events.findIndex(
        (e) => e.id === eventId && e.subnetKey === session.subnetKey,
      );
      if (idx < 0) {
        sendText(res, 404, "事件不存在");
        return;
      }
      // 仅组织者可删除。
      if (store.events[idx].organizer !== session.username) {
        sendText(res, 403, "只有组织者可以删除事件");
        return;
      }
      store.events.splice(idx, 1);
      saveCalendarStore(store);
      broadcastToSubnet(session.subnetKey, { type: "calendar_event_deleted", id: eventId });
      sendJson(res, 200, { ok: true, id: eventId });
      return;
    }
  }

  // 个人云端存储 (按用户隔离, 多端同步 + 乐观并发防覆盖)。/api/user-store/:kind  kind=calendar|tasks
  if (pathname.startsWith("/api/user-store/")) {
    const token = extractBearer(req);
    const session = resolveSessionByToken(token);
    if (!session) {
      sendText(res, 401, "未授权");
      return;
    }
    const kind = decodeURIComponent(pathname.slice("/api/user-store/".length));
    if (!USER_STORE_KINDS.has(kind)) {
      sendText(res, 404, "Not Found");
      return;
    }

    if (req.method === "GET") {
      const entry = getUserStoreEntry(loadUserStores(), session.username, kind);
      sendJson(res, 200, { rev: entry.rev, updatedAt: entry.updatedAt, data: entry.data });
      return;
    }

    if (req.method === "PUT") {
      try {
        const payload = safeParseJson(await readBody(req, 8 * 1024 * 1024)) || {};
        const baseRev = Number.isInteger(payload.baseRev) ? payload.baseRev : 0;
        const data = payload.data;
        if (!data || typeof data !== "object") {
          sendText(res, 400, "data 必填");
          return;
        }
        const stores = loadUserStores();
        // 乐观并发: baseRev 必须等于服务端当前 rev, 否则拒绝, 防止老版本覆盖新版本。
        const result = putUserStore(stores, session.username, kind, baseRev, data);
        if (!result.ok) {
          sendJson(res, 409, result);
          return;
        }
        saveUserStores(stores);
        // 实时下发给该用户其它在线端 (排除发起端)。
        broadcastToUser(
          session.username,
          {
            type: "user_store_updated",
            kind,
            rev: result.rev,
            updatedAt: result.updatedAt,
            data,
          },
          token,
        );
        sendJson(res, 200, { ok: true, rev: result.rev, updatedAt: result.updatedAt });
      } catch (err) {
        sendText(res, 500, err.message || "保存失败");
      }
      return;
    }
  }

  sendText(res, 404, "Not Found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const reqUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (reqUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  cleanupExpiredSessions();
  const token = String(reqUrl.searchParams.get("token") || "").trim();
  const session = resolveSessionByToken(token);
  if (!token || !session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.token = token;
    ws.username = session.username;
    ws.displayName = session.displayName || session.username;
    ws.avatar = session.avatar || "";
    ws.avatarKind = session.avatarKind || inferAvatarKind(session.avatar);
    ws.clientInfo = normalizeClientInfo(session.clientInfo);
    ws.clientIp = normalizeIp(request.socket?.remoteAddress);
    ws.subnetKey = subnetKeyFromIp(ws.clientIp);
    ws.subnetLabel = subnetLabelFromIp(ws.clientIp);
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  wsClients.add(ws);
  wsByToken.set(ws.token, ws);
  closeDuplicateConnections(ws.username, ws);

  sendToClient(ws, {
    type: "session",
    username: ws.username,
    displayName: ws.displayName,
    avatar: ws.avatar,
    avatarKind: ws.avatarKind,
    client: normalizeClientInfo(ws.clientInfo),
    roomScope: ws.subnetLabel,
    timestamp: nowIso(),
  });

  sendToClient(ws, {
    type: "history",
    messages: visibleHistoryForClient(ws),
    roomScope: ws.subnetLabel,
    timestamp: nowIso(),
  });

  broadcastToSubnet(ws.subnetKey, {
    type: "system",
    text: `${ws.displayName || ws.username} 已上线`,
    scope: "subnet",
    timestamp: nowIso(),
  });
  broadcastPresence();

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (payload?.type === "history_sync") {
      sendToClient(ws, buildHistorySyncPayload(ws, payload?.since));
      return;
    }

    if (payload?.type === "chat_recall") {
      const { index, message } = findHistoryMessage(payload?.messageId);
      if (!message || index < 0) {
        sendToClient(ws, {
          type: "error",
          text: "该消息不存在或已不可撤回",
          timestamp: nowIso(),
        });
        return;
      }

      if (message.from !== ws.username) {
        sendToClient(ws, {
          type: "error",
          text: "只能撤回自己发送的消息",
          timestamp: nowIso(),
        });
        return;
      }

      if (message.recalled) {
        sendToClient(ws, {
          type: "error",
          text: "该消息已经撤回",
          timestamp: nowIso(),
        });
        return;
      }

      const createdAt = new Date(message.timestamp).getTime();
      if (Number.isFinite(createdAt) && Date.now() - createdAt > RECALL_EDITABLE_WINDOW_MS) {
        sendToClient(ws, {
          type: "error",
          text: "该消息已超过可撤回时间",
          timestamp: nowIso(),
        });
        return;
      }

      const recalledMessage = {
        ...message,
        text: "",
        attachments: [],
        recalled: true,
        recalledAt: nowIso(),
      };
      history[index] = recalledMessage;
      persistHistorySnapshot();

      const payloadToSend = {
        type: "chat_recall",
        message: recalledMessage,
        roomScope: ws.subnetLabel,
        timestamp: nowIso(),
      };

      if (message.scope === "private") {
        const recipients = new Set([message.from, message.to].filter(Boolean));
        for (const client of wsClients) {
          if (client.readyState !== client.OPEN) continue;
          if (!recipients.has(client.username)) continue;
          sendToClient(client, payloadToSend);
        }
      } else {
        broadcastToSubnet(message.subnetKey, payloadToSend);
      }
      return;
    }

    if (payload?.type === "chat_read") {
      const scope = payload?.scope === "subnet" ? "subnet" : "private";
      const conversationWith = safeText(payload?.with);
      const messageIds = Array.isArray(payload?.messageIds) ? payload.messageIds : [];
      if (scope === "private") {
        const updated = markPrivateMessagesRead(ws.username, messageIds, conversationWith);
        if (!updated.length) {
          return;
        }

        const notifyPayload = {
          type: "chat_read",
          messages: updated,
          reader: ws.username,
          conversationWith,
          timestamp: nowIso(),
        };

        const recipients = new Set(updated.flatMap((item) => [item.from, item.to]).filter(Boolean));
        for (const client of wsClients) {
          if (client.readyState !== client.OPEN) continue;
          if (!recipients.has(client.username)) continue;
          sendToClient(client, notifyPayload);
        }
        return;
      }

      const updated = markSubnetMessagesRead(ws, messageIds);
      if (!updated.length) {
        return;
      }

      const notifyPayload = {
        type: "chat_read",
        scope: "subnet",
        messages: updated,
        reader: ws.username,
        timestamp: nowIso(),
      };

      broadcastToSubnet(ws.subnetKey, notifyPayload);
      return;
    }

    if (payload?.type === "chat_edit") {
      const { index, message } = findHistoryMessage(payload?.messageId);
      if (!message || index < 0) {
        sendToClient(ws, {
          type: "error",
          text: "该消息不存在或已无法编辑",
          timestamp: nowIso(),
        });
        return;
      }

      if (message.from !== ws.username) {
        sendToClient(ws, {
          type: "error",
          text: "只能编辑自己发送的消息",
          timestamp: nowIso(),
        });
        return;
      }

      if (message.recalled) {
        sendToClient(ws, {
          type: "error",
          text: "已撤回的消息不能编辑",
          timestamp: nowIso(),
        });
        return;
      }

      if (Array.isArray(message.attachments) && message.attachments.length) {
        sendToClient(ws, {
          type: "error",
          text: "暂不支持编辑带附件的消息",
          timestamp: nowIso(),
        });
        return;
      }

      const text = String(payload?.text || "").slice(0, 8000);
      if (!safeText(text)) {
        sendToClient(ws, {
          type: "error",
          text: "编辑后的消息内容不能为空",
          timestamp: nowIso(),
        });
        return;
      }

      const editedMessage = {
        ...message,
        text,
        edited: true,
        editedAt: nowIso(),
      };
      history[index] = editedMessage;
      persistHistorySnapshot();

      const payloadToSend = {
        type: "chat_edit",
        message: editedMessage,
        roomScope: ws.subnetLabel,
        timestamp: nowIso(),
      };

      if (message.scope === "private") {
        const recipients = new Set([message.from, message.to].filter(Boolean));
        for (const client of wsClients) {
          if (client.readyState !== client.OPEN) continue;
          if (!recipients.has(client.username)) continue;
          sendToClient(client, payloadToSend);
        }
      } else {
        broadcastToSubnet(message.subnetKey, payloadToSend);
      }
      return;
    }

    if (payload?.type === "chat_typing") {
      const scope = payload?.scope === "private" ? "private" : "subnet";
      const active = payload?.active !== false;

      if (scope === "private") {
        const to = safeText(payload?.to);
        if (!to || to === ws.username) {
          return;
        }

        for (const client of wsClients) {
          if (client.readyState !== client.OPEN) continue;
          if (client.username !== to) continue;
          sendToClient(client, {
            type: "chat_typing",
            scope: "private",
            active,
            from: ws.username,
            displayName: ws.displayName,
            timestamp: nowIso(),
          });
        }
        return;
      }

      for (const client of wsClients) {
        if (client.readyState !== client.OPEN) continue;
        if (client.subnetKey !== ws.subnetKey) continue;
        if (client === ws) continue;
        sendToClient(client, {
          type: "chat_typing",
          scope: "subnet",
          active,
          from: ws.username,
          displayName: ws.displayName,
          subnetKey: ws.subnetKey,
          subnetLabel: ws.subnetLabel,
          timestamp: nowIso(),
        });
      }
      return;
    }

    if (payload?.type !== "chat") return;

    const text = String(payload?.text || "").slice(0, 8000);
    const attachments = Array.isArray(payload?.attachments)
      ? payload.attachments
          .map(normalizeAttachment)
          .filter(Boolean)
          .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
      : [];
    const replyTo = normalizeReplyTarget(payload?.replyTo);
    const forwardedFrom = normalizeForwardedFrom(payload?.forwardedFrom);
    if (!safeText(text) && !attachments.length) return;

    const scope = payload?.scope === "private" ? "private" : "subnet";

    if (scope === "private") {
      const to = safeText(payload?.to);
      if (!to) {
        sendToClient(ws, {
          type: "error",
          text: "请选择私聊联系人",
          timestamp: nowIso(),
        });
        return;
      }

      const { user: targetUser } = findUser(to);
      if (!targetUser) {
        sendToClient(ws, {
          type: "error",
          text: `目标用户不存在: ${to}`,
          timestamp: nowIso(),
        });
        return;
      }

      let targetClient = null;
      for (const client of wsClients) {
        if (client.readyState === client.OPEN && client.username === to) {
          targetClient = client;
          break;
        }
      }

      const message = {
        id: crypto.randomUUID(),
        type: "chat",
        scope: "private",
        from: ws.username,
        to,
        username: ws.username,
        displayName: ws.displayName,
        avatar: ws.avatar || "",
        text,
        attachments,
        replyTo,
        forwardedFrom,
        timestamp: nowIso(),
        readAt: "",
        edited: false,
        editedAt: "",
      };

      addHistory(message);
      sendToClient(ws, message);
      if (targetClient && targetClient !== ws) {
        sendToClient(targetClient, message);
      }
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      type: "chat",
      scope: "subnet",
      from: ws.username,
      username: ws.username,
      displayName: ws.displayName,
      avatar: ws.avatar || "",
      subnetKey: ws.subnetKey,
      subnetLabel: ws.subnetLabel,
      text,
      attachments,
      replyTo,
      forwardedFrom,
      timestamp: nowIso(),
      readBy: [],
      edited: false,
      editedAt: "",
    };

    addHistory(message);
    broadcastToSubnet(ws.subnetKey, message);
  });

  ws.on("close", () => {
    wsClients.delete(ws);
    if (ws.token) {
      wsByToken.delete(ws.token);
    }

    broadcastToSubnet(ws.subnetKey, {
      type: "system",
      text: `${ws.displayName || ws.username || "成员"} 已离线`,
      scope: "subnet",
      timestamp: nowIso(),
    });
    broadcastPresence();
  });
});

process.on("uncaughtException", (err) => {
  console.error(`[collab] ${nowIso()} uncaughtException:`, (err && err.stack) || err);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[collab] ${nowIso()} unhandledRejection:`, (reason && reason.stack) || reason);
});

// 仅作为主入口运行时才监听端口并起定时器; 被 require (如单元测试) 时只导出可测函数, 不起服务。
if (require.main === module) {
  setInterval(cleanupExpiredSessions, 60 * 1000);
  server.listen(PORT, HOST, () => {
    console.log(`[collab] server listening on http://${HOST}:${PORT}`);
    console.log(`[collab] users file: ${USERS_FILE}`);
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  writeJsonAtomic,
  normalizeIp,
  loginLockState,
  recordLoginFail,
  clearLoginFails,
  safeParseJson,
  normalizeUserRecord,
  getUserStoreEntry,
  putUserStore,
};
