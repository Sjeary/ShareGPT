const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_EVENTS = 100_000;
const REQUEST_ID_PATTERN = /^[a-z0-9-]{8,100}$/i;

function safeText(value, max = 200) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best-effort cleanup must not hide the original write error.
    }
  }
}

function loadUsage(file) {
  if (!fs.existsSync(file)) return { version: 1, events: [] };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: 1,
      events: Array.isArray(value?.events) ? value.events : [],
    };
  } catch {
    throw new Error("翻译用量文件损坏，原文件未修改");
  }
}

function normalizeUsageEvent(value) {
  const requestId = safeText(value?.requestId, 100);
  if (requestId && !REQUEST_ID_PATTERN.test(requestId)) throw new Error("requestId 无效");
  return {
    id: safeText(value?.id, 100),
    requestId,
    username: safeText(value?.username, 80),
    profileId: safeText(value?.profileId, 64),
    profileName: safeText(value?.profileName, 80),
    timestamp: safeText(value?.timestamp, 40),
    inputChars: safeCount(value?.inputChars),
    outputChars: safeCount(value?.outputChars),
    inputTokens: safeCount(value?.inputTokens),
    outputTokens: safeCount(value?.outputTokens),
    totalTokens: safeCount(value?.totalTokens),
    costMicros: safeCount(value?.costMicros),
    currency: safeText(value?.currency, 8).toUpperCase() || "USD",
  };
}

function recordUsage(file, payload, maxEvents = DEFAULT_MAX_EVENTS) {
  const event = normalizeUsageEvent({
    ...payload,
    id: payload?.id || require("node:crypto").randomUUID(),
    timestamp: payload?.timestamp || new Date().toISOString(),
  });
  if (!event.username || !event.profileId) throw new Error("翻译用量缺少账号或配置 ID");
  const store = loadUsage(file);
  if (
    event.requestId &&
    store.events.some(
      (item) => item.username === event.username && item.requestId === event.requestId,
    )
  ) {
    return { recorded: false, event };
  }
  store.events.push(event);
  if (store.events.length > maxEvents) {
    store.events.splice(0, store.events.length - maxEvents);
  }
  writeJsonAtomic(file, store);
  return { recorded: true, event };
}

function parseBoundary(value, endOfDay = false) {
  const text = safeText(value, 40);
  if (!text) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(dateOnly ? `${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : text);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function queryUsage(file, filters = {}) {
  const from = parseBoundary(filters.from);
  const to = parseBoundary(filters.to, true);
  const username = safeText(filters.username, 80);
  const profileId = safeText(filters.profileId, 64);
  const events = loadUsage(file)
    .events.map(normalizeUsageEvent)
    .filter((event) => {
      const timestamp = new Date(event.timestamp).getTime();
      if (from !== null && timestamp < from) return false;
      if (to !== null && timestamp > to) return false;
      if (username && event.username !== username) return false;
      if (profileId && event.profileId !== profileId) return false;
      return true;
    });

  const totals = {
    requests: events.length,
    inputChars: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costByCurrency: {},
  };
  const profileRows = new Map();
  const userRows = new Map();

  for (const event of events) {
    totals.inputChars += event.inputChars;
    totals.outputChars += event.outputChars;
    totals.inputTokens += event.inputTokens;
    totals.outputTokens += event.outputTokens;
    totals.totalTokens += event.totalTokens;
    totals.costByCurrency[event.currency] =
      (totals.costByCurrency[event.currency] || 0) + event.costMicros;

    const profile = profileRows.get(event.profileId) || {
      profileId: event.profileId,
      profileName: event.profileName || event.profileId,
      requests: 0,
      totalTokens: 0,
      costByCurrency: {},
    };
    profile.requests += 1;
    profile.totalTokens += event.totalTokens;
    profile.costByCurrency[event.currency] =
      (profile.costByCurrency[event.currency] || 0) + event.costMicros;
    profileRows.set(event.profileId, profile);

    const user = userRows.get(event.username) || {
      username: event.username,
      requests: 0,
      totalTokens: 0,
      costByCurrency: {},
    };
    user.requests += 1;
    user.totalTokens += event.totalTokens;
    user.costByCurrency[event.currency] =
      (user.costByCurrency[event.currency] || 0) + event.costMicros;
    userRows.set(event.username, user);
  }

  return {
    filters: {
      from: safeText(filters.from, 40),
      to: safeText(filters.to, 40),
      username,
      profileId,
    },
    totals,
    byProfile: Array.from(profileRows.values()).sort((a, b) => b.requests - a.requests),
    byUser: Array.from(userRows.values()).sort((a, b) => b.requests - a.requests),
    recent: events.slice(-100).reverse(),
  };
}

function createTranslationUsageService({ file, maxEvents = DEFAULT_MAX_EVENTS }) {
  return {
    record: (payload) => recordUsage(file, payload, maxEvents),
    query: (filters) => queryUsage(file, filters),
  };
}

module.exports = {
  createTranslationUsageService,
  loadUsage,
  normalizeUsageEvent,
  queryUsage,
  recordUsage,
};
