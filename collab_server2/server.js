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
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS || `${24 * 60 * 60 * 1000}`, 10);
const HISTORY_MAX = Number.parseInt(process.env.HISTORY_MAX || "200", 10);
const MAX_AVATAR_LENGTH = Number.parseInt(process.env.MAX_AVATAR_LENGTH || `${150 * 1024}`, 10);
const GPT_USAGE_MAX = Number.parseInt(process.env.GPT_USAGE_MAX || "50000", 10);

const sessions = new Map();
const wsClients = new Set();
const wsByToken = new Map();
const history = [];

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
  history.push(message);
  if (history.length > HISTORY_MAX) {
    history.splice(0, history.length - HISTORY_MAX);
  }
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

    if (payload?.type !== "chat") return;

    const text = String(payload?.text || "").trim();
    if (!text) return;

    const scope = payload?.scope === "private" ? "private" : "subnet";

    if (scope === "private") {
      const to = safeText(payload?.to);
      if (!to) {
        sendToClient(ws, {
          type: "error",
          text: "请选择私聊在线用户",
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

      if (!targetClient) {
        sendToClient(ws, {
          type: "error",
          text: `目标用户不在线: ${to}`,
          timestamp: nowIso(),
        });
        return;
      }

      const message = {
        type: "chat",
        scope: "private",
        from: ws.username,
        to,
        username: ws.username,
        displayName: ws.displayName,
        avatar: ws.avatar || "",
        text: text.slice(0, 2000),
        timestamp: nowIso(),
      };

      addHistory(message);
      sendToClient(ws, message);
      if (targetClient !== ws) {
        sendToClient(targetClient, message);
      }
      return;
    }

    const message = {
      type: "chat",
      scope: "subnet",
      from: ws.username,
      username: ws.username,
      displayName: ws.displayName,
      avatar: ws.avatar || "",
      subnetKey: ws.subnetKey,
      subnetLabel: ws.subnetLabel,
      text: text.slice(0, 2000),
      timestamp: nowIso(),
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
