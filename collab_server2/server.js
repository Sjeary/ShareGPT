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
const CHAT_HISTORY_FILE = process.env.CHAT_HISTORY_FILE || path.join(__dirname, "data", "chat_history.json");
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS || `${24 * 60 * 60 * 1000}`, 10);
const HISTORY_MAX = Number.parseInt(process.env.HISTORY_MAX || "2000", 10);
const MAX_AVATAR_LENGTH = Number.parseInt(process.env.MAX_AVATAR_LENGTH || `${150 * 1024}`, 10);
const GPT_USAGE_MAX = Number.parseInt(process.env.GPT_USAGE_MAX || "50000", 10);
const MAX_ATTACHMENTS_PER_MESSAGE = Number.parseInt(process.env.MAX_ATTACHMENTS_PER_MESSAGE || "4", 10);
const MAX_ATTACHMENT_BYTES = Number.parseInt(process.env.MAX_ATTACHMENT_BYTES || `${30 * 1024 * 1024}`, 10);
const RECALL_EDITABLE_WINDOW_MS = Number.parseInt(process.env.RECALL_EDITABLE_WINDOW_MS || `${7 * 24 * 60 * 60 * 1000}`, 10);

const sessions = new Map();
const wsClients = new Set();
const wsByToken = new Map();

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

function normalizeUserRecord(record) {
  const username = safeText(record?.username);
  const displayName = safeText(record?.displayName) || username;
  const avatar = safeText(record?.avatar).slice(0, MAX_AVATAR_LENGTH);
  const avatarKind = ["emoji", "url", "image"].includes(record?.avatarKind) ? record.avatarKind : inferAvatarKind(avatar);
  const bio = safeText(record?.bio).slice(0, 200);

  return {
    ...record,
    username,
    displayName,
    avatar,
    avatarKind,
    bio,
    disabled: Boolean(record?.disabled),
  };
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
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), "utf-8");
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
    : (Array.isArray(record?.attachments)
      ? record.attachments.map(normalizeAttachment).filter(Boolean).slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
      : []);
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
    readBy: scope === "subnet"
      ? (Array.isArray(record?.readBy) ? record.readBy.map(normalizeReadByEntry).filter(Boolean) : [])
      : [],
    edited: Boolean(record?.edited),
    editedAt: Boolean(record?.edited) ? (safeText(record?.editedAt) || nowIso()) : "",
    recalled,
    recalledAt: recalled ? (safeText(record?.recalledAt) || nowIso()) : "",
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
  return safeText(readByLatest || record?.readAt || record?.editedAt || record?.recalledAt || record?.timestamp);
}

function loadChatHistoryStore() {
  ensureChatHistoryFile();
  try {
    const raw = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, "utf-8"));
    const items = Array.isArray(raw.history) ? raw.history.map(normalizeHistoryMessage).filter(Boolean) : [];
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
  fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify({ history }, null, 2), "utf-8");
}

const history = loadChatHistoryStore();

function loadGptUsageStore() {
  ensureGptUsageFile();
  try {
    const raw = JSON.parse(fs.readFileSync(GPT_USAGE_FILE, "utf-8"));
    const events = Array.isArray(raw.events) ? raw.events.map(normalizeUsageEvent).filter((item) => item.username) : [];
    return { events };
  } catch {
    return { events: [] };
  }
}

function saveGptUsageStore(store) {
  const events = Array.isArray(store?.events) ? store.events.map(normalizeUsageEvent).filter((item) => item.username) : [];
  if (events.length > GPT_USAGE_MAX) {
    events.splice(0, events.length - GPT_USAGE_MAX);
  }
  fs.writeFileSync(GPT_USAGE_FILE, JSON.stringify({ events }, null, 2), "utf-8");
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

function findUser(username) {
  const store = loadUserStore();
  const user = store.users.find((item) => item.username === username && !item.disabled);
  return { store, user };
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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    if (client !== exceptClient && client.username === username && client.readyState === client.OPEN) {
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
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = reqUrl.pathname;

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

      if (!username || !password) {
        sendText(res, 400, "用户名或密码不能为空");
        return;
      }

      const { store, user } = findUser(username);
      if (!user || !verifyPassword(user, password)) {
        sendText(res, 401, "账号或密码错误");
        return;
      }

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
      const remoteIp = normalizeIp(req.socket?.remoteAddress);
      const subnetKey = subnetKeyFromIp(remoteIp);
      const subnetLabel = subnetLabelFromIp(remoteIp);

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
      const count = Math.max(1, Math.min(20, Number.parseInt(String(payload?.count || "1"), 10) || 1));
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
      const stats = buildGptUsageStats(reqUrl.searchParams.get("from"), reqUrl.searchParams.get("to"));
      sendJson(res, 200, stats);
    } catch (err) {
      sendText(res, 400, err.message || "查询 GPT 使用统计失败");
    }
    return;
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
      ? payload.attachments.map(normalizeAttachment).filter(Boolean).slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
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

setInterval(cleanupExpiredSessions, 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[collab] server listening on http://${HOST}:${PORT}`);
  console.log(`[collab] users file: ${USERS_FILE}`);
});
