const state = {
  settings: null,
  status: null,
  mode: "sender",
  view: "sender",
  deviceInfo: null,
  contextMenuOpen: false,
  windowFocused: typeof document !== "undefined" ? document.hasFocus() : true,
  ui: {
    setupGuideDismissed: false,
    aiEventsBound: false,
  },
  collab: {
    serverUrl: "",
    username: "",
    token: "",
    ws: null,
    connected: false,
    avatar: "",
    displayName: "",
    roomScope: "-",
    userDirectory: [],
    pinnedUsers: new Set(),
    rememberPassword: false,
    savedPassword: "",
    notifyMessagePopup: true,
    notifyUserOnline: false,
    messagesByConversation: new Map(),
    unreadByConversation: new Map(),
    knownOnlineUsers: new Set(),
    presenceReady: false,
  },
  gpt: {
    partition: "persist:gpt-chat",
    homeUrl: "https://chatgpt.com/",
    lastUrl: "https://chatgpt.com/",
    proxyHost: "127.0.0.1",
    proxyPort: "1080",
    totalQueries: 0,
    queryUsers: {},
    statsTotalQueries: 0,
    statsUsers: {},
    statsEntries: [],
    statsUserCount: 0,
    statsFrom: "",
    statsTo: "",
    statsPreset: "30d",
    webviewInitialized: false,
    webviewLoading: false,
    lastTrackedQueryText: "",
    lastTrackedQueryAt: 0,
    canGoBack: false,
    canGoForward: false,
  },
  gemini: {
    partition: "persist:gemini-chat",
    homeUrl: "https://gemini.google.com/",
    lastUrl: "https://gemini.google.com/",
    proxyHost: "127.0.0.1",
    proxyPort: "1080",
    webviewInitialized: false,
    webviewLoading: false,
    canGoBack: false,
    canGoForward: false,
  },
};

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
const DEFAULT_TARGET_DOMAINS = [...new Set([...GPT_ALLOWED_HOSTS, ...GEMINI_ALLOWED_HOSTS])].join(",");
const GPT_QUERY_MARKER = "__GPT_QUERY__";
const GPT_PROXY_HOST = "127.0.0.1";
const GPT_PROXY_PORT = "1080";

const SOURCE_LABELS = {
  app: "系统",
  sender: "发送服务",
  receiver: "接收服务",
  collab: "账号服务",
  "receiver-singbox": "接收端",
  "receiver-frpc": "映射服务",
};

const el = (id) => document.getElementById(id);
const AI_HOST_IDS = {
  gpt: "gptViewHost",
  gemini: "geminiViewHost",
};
let aiLayoutSyncQueued = false;
let aiHostResizeObserver = null;

function safeText(value) {
  return String(value || "").trim();
}

function isPlaceholderValue(value) {
  const text = safeText(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes("your-server.example.com")
    || lower.includes("example.com")
    || lower.includes("your-uuid")
    || lower.includes("your-token")
    || lower === "your-account"
  );
}

function hasSenderConnectionReady() {
  const server = safeText(el("s_proxy_server")?.value || state.settings?.sender?.proxy_server);
  const port = safeText(el("s_proxy_port")?.value || state.settings?.sender?.proxy_port);
  const uuid = safeText(el("s_proxy_uuid")?.value || state.settings?.sender?.proxy_uuid);
  return !isPlaceholderValue(server) && /^\d+$/.test(port) && !isPlaceholderValue(uuid);
}

function hasCollabServiceReady() {
  const serverUrl = safeText(el("c_server_url")?.value || state.settings?.collab?.server_url);
  return !isPlaceholderValue(serverUrl) && /^https?:\/\//i.test(serverUrl);
}

function shouldShowSetupGuide() {
  return state.mode === "sender"
    && !state.ui.setupGuideDismissed
    && (!hasCollabServiceReady() || !hasSenderConnectionReady());
}

function buildSetupGuideItems() {
  const items = [];
  if (!hasCollabServiceReady()) {
    items.push("先填写账号服务地址，后续才能登录、同步联系人和加载统计。");
  }
  if (!hasSenderConnectionReady()) {
    items.push("补全发送端的服务器地址、连接端口和连接身份码，Sender 才能正常启动。");
  }
  items.push("发送服务启动后，ChatGPT 和 Gemini 页面都会复用当前 SOCKS5 代理。");
  return items;
}

function avatarMark(value, fallbackName = "") {
  const avatar = safeText(value);
  if (avatar) return avatar;
  const name = safeText(fallbackName);
  if (!name) return "?";
  return name[0].toUpperCase();
}

function setAvatarNode(node, value, fallbackName = "") {
  if (!node) return;

  const raw = safeText(value);
  node.textContent = "";

  if (raw && (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw))) {
    const img = document.createElement("img");
    img.src = raw;
    img.alt = "avatar";
    img.onerror = () => {
      node.textContent = avatarMark("", fallbackName);
    };
    node.appendChild(img);
    return;
  }

  node.textContent = avatarMark(raw, fallbackName);
}

function setTopAvatar(value, fallbackName = "") {
  setAvatarNode(el("topCollabAvatar"), value, fallbackName);
}

function setAccountAvatar(value, fallbackName = "") {
  setAvatarNode(el("c_account_avatar"), value, fallbackName);
}

function setRoomScope(scopeText) {
  const roomScope = safeText(scopeText) || "-";
  state.collab.roomScope = roomScope;
  if (el("c_room_scope")) el("c_room_scope").textContent = roomScope;
  if (el("c_room_channel_scope")) el("c_room_channel_scope").textContent = `房间：${roomScope}`;
  updateRoomUnreadBadge();
}

function syncAccountOverview() {
  const username = safeText(state.collab.username);
  const displayName = safeText(state.collab.displayName) || username;
  const nameNode = el("c_account_name");
  const metaNode = el("c_account_meta");
  const noteNode = el("c_account_note");
  const btnProfile = el("btnAccountProfile");
  const btnLogout = el("btnAccountLogout");

  if (!state.collab.token) {
    if (nameNode) nameNode.textContent = "未登录";
    if (metaNode) metaNode.textContent = "登录后可查看账号信息";
    if (noteNode) noteNode.textContent = "可设置昵称、头像和简介，便于联系人识别。";
    setAccountAvatar("", "");
    if (btnProfile) btnProfile.disabled = true;
    if (btnLogout) btnLogout.disabled = true;
    return;
  }

  const nameText = displayName && displayName !== username ? `${displayName} (${username})` : (displayName || username || "已登录");
  const statusText = safeText(el("c_conn_state")?.textContent) || (state.collab.connected ? "在线" : "连接中");
  const roomText = safeText(state.collab.roomScope) && state.collab.roomScope !== "-" ? `房间：${state.collab.roomScope}` : "房间：等待同步";

  if (nameNode) nameNode.textContent = nameText;
  if (metaNode) metaNode.textContent = `${statusText} · ${roomText}`;
  if (noteNode) {
    noteNode.textContent = state.collab.connected
      ? "消息服务已连接，可前往“联系人与聊天”发送消息。"
      : "账号已登录，正在连接消息服务。";
  }
  setAccountAvatar(state.collab.avatar, displayName || username);
  if (btnProfile) btnProfile.disabled = false;
  if (btnLogout) btnLogout.disabled = false;
}

function refreshTopIdentity() {
  const identityWrap = el("topCollabIdentity");
  const nameNode = el("topCollabName");
  const subNode = el("topCollabSub");
  const username = safeText(state.collab.username);
  const displayName = safeText(state.collab.displayName) || username;

  if (!state.collab.token) {
    if (identityWrap) identityWrap.classList.remove("active");
    if (nameNode) nameNode.textContent = "未登录";
    if (subNode) subNode.textContent = "登录后可查看账号信息";
    setTopAvatar("", "");
    syncAccountOverview();
    return;
  }

  if (identityWrap) identityWrap.classList.add("active");

  const nameText = displayName && displayName !== username ? `${displayName} (${username})` : (displayName || username || "已登录");
  const connText = safeText(el("c_conn_state")?.textContent) || (state.collab.connected ? "在线" : "连接中");
  const roomText = safeText(state.collab.roomScope) && state.collab.roomScope !== "-" ? ` · ${state.collab.roomScope}` : "";

  if (nameNode) nameNode.textContent = nameText;
  if (subNode) subNode.textContent = `${connText}${roomText}`;
  setTopAvatar(state.collab.avatar, displayName || username);
  syncAccountOverview();
}

function currentChatScope() {
  return safeText(el("c_chat_scope")?.value) || "subnet";
}

function isCollabOnline() {
  return Boolean(state.collab.token && state.collab.connected);
}

function formatTime(ts) {
  if (!ts) return new Date().toLocaleTimeString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toLocaleTimeString() : d.toLocaleTimeString();
}

function currentGptUser() {
  return safeText(state.collab.username) || "未登录账号";
}

function gptTotalQueries() {
  const derived = Object.values(state.gpt.queryUsers || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return Math.max(Number(state.gpt.totalQueries) || 0, derived);
}

function currentGptUserQueries() {
  return Number(state.gpt.queryUsers[currentGptUser()] || 0);
}

function currentGptStatsUserQueries() {
  return Number(state.gpt.statsUsers[currentGptUser()] || 0);
}

function formatDateInputValue(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setGptStatsPreset(preset) {
  const now = new Date();
  const today = formatDateInputValue(now);

  if (preset === "all") {
    state.gpt.statsPreset = "all";
    state.gpt.statsFrom = "";
    state.gpt.statsTo = "";
    return;
  }

  const daysMap = { "7d": 7, "30d": 30, "90d": 90 };
  const days = daysMap[preset] || 30;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  state.gpt.statsPreset = preset in daysMap ? preset : "30d";
  state.gpt.statsFrom = formatDateInputValue(start);
  state.gpt.statsTo = today;
}

function syncGptStatsFilterInputs() {
  if (el("gptStatsPreset")) el("gptStatsPreset").value = state.gpt.statsPreset;
  if (el("gptStatsFrom")) {
    el("gptStatsFrom").value = state.gpt.statsFrom;
    el("gptStatsFrom").disabled = state.gpt.statsPreset !== "custom";
  }
  if (el("gptStatsTo")) {
    el("gptStatsTo").value = state.gpt.statsTo;
    el("gptStatsTo").disabled = state.gpt.statsPreset !== "custom";
  }
}

function readGptStatsRangeFromInputs() {
  const preset = safeText(el("gptStatsPreset")?.value) || state.gpt.statsPreset || "30d";
  state.gpt.statsPreset = preset;

  if (preset !== "custom") {
    setGptStatsPreset(preset);
  } else {
    state.gpt.statsFrom = safeText(el("gptStatsFrom")?.value);
    state.gpt.statsTo = safeText(el("gptStatsTo")?.value);
  }

  syncGptStatsFilterInputs();
}

function resolveGptProxyPort() {
  const value = safeText(el("s_socks_listen_port")?.value || state.settings?.sender?.socks_listen_port || state.gpt.proxyPort || GPT_PROXY_PORT);
  return /^\d+$/.test(value) ? value : GPT_PROXY_PORT;
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

function isGptAllowedUrl(rawUrl) {
  return isAllowedUrlForHosts(rawUrl, GPT_ALLOWED_HOSTS);
}

function normalizeGptUrl(rawUrl) {
  const url = safeText(rawUrl);
  if (url && isGptAllowedUrl(url)) {
    return url;
  }
  return state.gpt.homeUrl;
}

function isGeminiAllowedUrl(rawUrl) {
  return isAllowedUrlForHosts(rawUrl, GEMINI_ALLOWED_HOSTS);
}

function normalizeGeminiUrl(rawUrl) {
  const url = safeText(rawUrl);
  if (url && isGeminiAllowedUrl(url)) {
    return url;
  }
  return state.gemini.homeUrl;
}

function gptUserAgent() {
  return String(window.navigator.userAgent || "").replace(/\s*Electron\/[^\s]+/i, "");
}

function setGptFeedback(text = "", tone = "") {
  setPanelFeedback("gpt_feedback", text, tone);
}

function setGeminiFeedback(text = "", tone = "") {
  setPanelFeedback("gemini_feedback", text, tone);
}

function setGptStatsFeedback(text = "", tone = "") {
  setPanelFeedback("gpt_stats_feedback", text, tone);
}

function formatGptStatsRangeText() {
  const from = safeText(state.gpt.statsFrom);
  const to = safeText(state.gpt.statsTo);

  if (!from && !to) {
    return "统计范围：全部时间";
  }
  if (from && to) {
    return `统计范围：${from} 至 ${to}`;
  }
  if (from) {
    return `统计范围：${from} 之后`;
  }
  return `统计范围：截至 ${to}`;
}

function getAiState(kind) {
  return kind === "gpt" ? state.gpt : (kind === "gemini" ? state.gemini : null);
}

function getAiHostElement(kind) {
  return el(AI_HOST_IDS[kind] || "");
}

function shouldShowAiWorkspace(kind) {
  return state.mode === "sender"
    && state.view === kind
    && Boolean(state.status?.senderRunning)
    && Boolean(getAiHostElement(kind));
}

function syncSingleAiHost(kind) {
  const host = getAiHostElement(kind);
  if (!host || !window.api?.syncAiViewHost) return;

  const visible = shouldShowAiWorkspace(kind);
  if (!visible) {
    window.api.syncAiViewHost({ kind, visible: false }).catch(() => {});
    return;
  }

  const rect = host.getBoundingClientRect();
  const bounds = {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };

  window.api.syncAiViewHost({
    kind,
    visible: rect.width > 1 && rect.height > 1,
    bounds,
  }).catch(() => {});
}

function syncAiHostsLayout() {
  syncSingleAiHost("gpt");
  syncSingleAiHost("gemini");
}

function scheduleAiHostsLayoutSync() {
  if (aiLayoutSyncQueued) return;
  aiLayoutSyncQueued = true;
  window.requestAnimationFrame(() => {
    aiLayoutSyncQueued = false;
    syncAiHostsLayout();
  });
}

function initAiHostObservers() {
  if (aiHostResizeObserver || typeof ResizeObserver === "undefined") return;

  aiHostResizeObserver = new ResizeObserver(() => {
    scheduleAiHostsLayoutSync();
  });

  Object.values(AI_HOST_IDS).forEach((id) => {
    const node = el(id);
    if (node) aiHostResizeObserver.observe(node);
  });
}

function applyAiWorkspaceState(kind, payload = {}) {
  const target = getAiState(kind);
  if (!target) return;

  if (typeof payload.initialized === "boolean") {
    target.webviewInitialized = payload.initialized;
  }
  if (typeof payload.loading === "boolean") {
    target.webviewLoading = payload.loading;
  }
  if (typeof payload.canGoBack === "boolean") {
    target.canGoBack = payload.canGoBack;
  }
  if (typeof payload.canGoForward === "boolean") {
    target.canGoForward = payload.canGoForward;
  }

  const nextUrl = safeText(payload.url);
  if (nextUrl) {
    if (kind === "gpt" && isGptAllowedUrl(nextUrl)) {
      rememberGptUrl(nextUrl);
    }
    if (kind === "gemini" && isGeminiAllowedUrl(nextUrl)) {
      rememberGeminiUrl(nextUrl);
    }
  }
}

function bindAiWorkspaceEvents() {
  if (!window.api?.onAiEvent || state.ui.aiEventsBound) return;
  state.ui.aiEventsBound = true;

  window.api.onAiEvent((payload) => {
    const kind = safeText(payload?.kind);
    if (!kind) return;

    applyAiWorkspaceState(kind, payload);

    if (payload?.type === "console-message" && kind === "gpt") {
      handleGptTrackerMessage(payload.message);
    }

    if (payload?.type === "did-fail-load") {
      const errorText = payload.errorDescription || payload.errorCode || "未知错误";
      if (kind === "gpt") {
        setGptFeedback(`GPT 页面加载失败：${errorText}`, "error");
      } else if (kind === "gemini") {
        setGeminiFeedback(`Gemini 页面加载失败：${errorText}`, "error");
      }
    }

    if (payload?.type === "external-open-failed") {
      const errorText = payload.message || "未知错误";
      if (kind === "gpt") {
        setGptFeedback(`外部链接打开失败：${errorText}`, "error");
      } else if (kind === "gemini") {
        setGeminiFeedback(`外部链接打开失败：${errorText}`, "error");
      }
    }

    if (payload?.type === "dom-ready" && kind === "gpt") {
      installGptQueryTracker();
    }

    if (kind === "gpt") {
      updateGptRuntimeState();
    } else if (kind === "gemini") {
      updateGeminiRuntimeState();
    }
  });
}

function syncGptFullscreenState() {
  const shell = el("gptBrowserShell");
  const isFullscreen = Boolean(shell && document.fullscreenElement === shell);

  if (el("btnGptToggleFullscreen")) {
    el("btnGptToggleFullscreen").textContent = isFullscreen ? "退出全屏" : "全屏";
  }
}

function updateGptNavState() {
  if (el("btnGptBack")) el("btnGptBack").disabled = !state.gpt.canGoBack;
  if (el("btnGptForward")) el("btnGptForward").disabled = !state.gpt.canGoForward;
  if (el("btnGptReload")) el("btnGptReload").disabled = !Boolean(state.status?.senderRunning);
  if (el("btnGptOpenExternal")) {
    el("btnGptOpenExternal").disabled = !safeText(state.gpt.lastUrl);
  }

  syncGptFullscreenState();
}

function updateGptProxyInfo() {
  state.gpt.proxyPort = resolveGptProxyPort();
  if (el("gptProxyInfo")) {
    el("gptProxyInfo").textContent = `SOCKS5 ${state.gpt.proxyHost}:${state.gpt.proxyPort}`;
  }
}

function updateGptRuntimeState() {
  const runtimeNode = el("gptRuntimeState");
  const overlay = el("gptOverlay");
  const overlayTitle = el("gptOverlayTitle");
  const overlayText = el("gptOverlayText");
  const senderRunning = Boolean(state.status?.senderRunning);

  if (runtimeNode) {
    if (!senderRunning) {
      runtimeNode.textContent = "等待发送服务";
    } else if (state.gpt.webviewLoading) {
      runtimeNode.textContent = "正在加载";
    } else if (state.gpt.webviewInitialized) {
      runtimeNode.textContent = "已打开";
    } else {
      runtimeNode.textContent = "准备打开";
    }
  }

  updateGptNavState();

  if (!overlay || !overlayTitle || !overlayText) {
    scheduleAiHostsLayoutSync();
    return;
  }

  if (!senderRunning) {
    overlay.hidden = false;
    overlayTitle.textContent = "请先开启发送服务";
    overlayText.textContent = `内置 ChatGPT 网页会通过 ${state.gpt.proxyHost}:${state.gpt.proxyPort} 代理访问。请先在“连接设置”中开启发送服务。`;
    scheduleAiHostsLayoutSync();
    return;
  }

  if (!state.gpt.webviewInitialized) {
    overlay.hidden = false;
    overlayTitle.textContent = "准备打开 ChatGPT";
    overlayText.textContent = "正在初始化内置页面并连接本地代理。第一次进入可能稍慢。";
    scheduleAiHostsLayoutSync();
    return;
  }

  overlay.hidden = true;
  scheduleAiHostsLayoutSync();
}

function renderGptStats() {
  const totalNode = el("gptTotalQueries");
  const currentNode = el("gptCurrentUserQueries");
  const userCountNode = el("gptUserCount");
  const pie = el("gptPieChart");
  const center = el("gptPieCenter");
  const legend = el("gptStatsLegend");
  const rangeNode = el("gptStatsRangeNote");
  const rawEntries = Array.isArray(state.gpt.statsEntries) && state.gpt.statsEntries.length
    ? state.gpt.statsEntries
    : Object.entries(state.gpt.statsUsers || {}).map(([username, count]) => ({ username, count }));
  const entries = rawEntries
    .map((item) => ({
      username: safeText(item?.username),
      displayName: safeText(item?.displayName),
      count: Number(item?.count) || 0,
    }))
    .filter((item) => item.username && item.count > 0)
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));

  const total = Number(state.gpt.statsTotalQueries) || 0;
  const current = currentGptStatsUserQueries();

  if (totalNode) totalNode.textContent = String(total);
  if (currentNode) currentNode.textContent = String(current);
  if (userCountNode) userCountNode.textContent = String(state.gpt.statsUserCount || entries.length);
  if (rangeNode) rangeNode.textContent = formatGptStatsRangeText();
  if (!pie || !center || !legend) return;

  legend.textContent = "";

  if (!entries.length || total <= 0) {
    pie.style.setProperty("--pie-fill", "conic-gradient(rgba(148, 163, 184, 0.18) 0deg 360deg)");
    center.textContent = "暂无统计";

    const empty = document.createElement("div");
    empty.className = "gpt-legend-empty";
    empty.textContent = "所选时间范围内还没有提问记录。";
    legend.appendChild(empty);
    return;
  }

  const colors = ["#0a84ff", "#f59e0b", "#fb7185", "#22c55e", "#a855f7", "#14b8a6", "#f97316", "#eab308"];
  let start = 0;
  const segments = [];

  entries.forEach((item, index) => {
    const count = item.count;
    const slice = (count / total) * 360;
    const end = start + slice;
    segments.push(`${colors[index % colors.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
    start = end;
  });

  pie.style.setProperty("--pie-fill", `conic-gradient(${segments.join(", ")})`);
  center.textContent = `总计 ${total} 次`;

  entries.forEach((item, index) => {
    const username = item.username;
    const count = item.count;
    const displayName = item.displayName && item.displayName !== username
      ? `${item.displayName} (${username})`
      : (item.displayName || username);
    const row = document.createElement("div");
    row.className = "gpt-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "gpt-legend-swatch";
    swatch.style.background = colors[index % colors.length];

    const copy = document.createElement("div");
    copy.className = "gpt-legend-copy";

    const name = document.createElement("strong");
    name.textContent = displayName;

    const detail = document.createElement("span");
    detail.textContent = `${Math.round((count / total) * 100)}% · ${count} 次提问`;

    const value = document.createElement("span");
    value.className = "gpt-legend-value";
    value.textContent = `${count} 次`;

    copy.appendChild(name);
    copy.appendChild(detail);
    row.appendChild(swatch);
    row.appendChild(copy);
    row.appendChild(value);
    legend.appendChild(row);
  });
}

function updateGptCounters() {
  if (el("gptMyQueryCount")) {
    el("gptMyQueryCount").textContent = String(currentGptUserQueries());
  }
  renderGptStats();
}

function registerGptQuery(text = "") {
  const normalizedText = safeText(text).slice(0, 160);
  const now = Date.now();

  if (!normalizedText) return;

  if (
    normalizedText
    && normalizedText === state.gpt.lastTrackedQueryText
    && now - state.gpt.lastTrackedQueryAt < 1800
  ) {
    return;
  }

  state.gpt.lastTrackedQueryText = normalizedText;
  state.gpt.lastTrackedQueryAt = now;
  reportGptUsage().catch((err) => {
    logLine("app", `上报 GPT 使用次数失败：${err.message || err}`);
  });
}

async function persistGptState() {
  await saveSettings({ silent: true });
}

async function loadGptSummaryStats() {
  if (!state.collab.serverUrl || !state.collab.token) {
    state.gpt.totalQueries = 0;
    state.gpt.queryUsers = {};
    updateGptCounters();
    return;
  }

  const response = await fetchWithFriendlyError(`${state.collab.serverUrl}/api/gpt/stats`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${state.collab.token}`,
    },
  }, 8000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `加载 GPT 使用统计失败（${response.status}）`);
  }

  const payload = await response.json();
  state.gpt.totalQueries = Number(payload.totalQueries) || 0;
  state.gpt.queryUsers = Object.fromEntries(
    (payload.users || []).map((item) => [safeText(item.username), Number(item.count) || 0]).filter(([username]) => username),
  );
  updateGptCounters();
  await persistGptState();
}

async function loadGptRangeStats(options = {}) {
  if (!state.collab.serverUrl || !state.collab.token) {
    state.gpt.statsTotalQueries = 0;
    state.gpt.statsUsers = {};
    state.gpt.statsEntries = [];
    state.gpt.statsUserCount = 0;
    renderGptStats();
    return;
  }

  const silent = Boolean(options.silent);
  const params = new URLSearchParams();
  if (state.gpt.statsFrom) params.set("from", state.gpt.statsFrom);
  if (state.gpt.statsTo) params.set("to", state.gpt.statsTo);

  const query = params.toString();
  const response = await fetchWithFriendlyError(`${state.collab.serverUrl}/api/gpt/stats${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${state.collab.token}`,
    },
  }, 8000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `查询 GPT 使用统计失败（${response.status}）`);
  }

  const payload = await response.json();
  state.gpt.statsTotalQueries = Number(payload.totalQueries) || 0;
  state.gpt.statsUserCount = Number(payload.userCount) || 0;
  state.gpt.statsEntries = (payload.users || []).map((item) => ({
    username: safeText(item?.username),
    displayName: safeText(item?.displayName),
    count: Number(item?.count) || 0,
    ratio: Number(item?.ratio) || 0,
  })).filter((item) => item.username && item.count > 0);
  state.gpt.statsUsers = Object.fromEntries(
    state.gpt.statsEntries.map((item) => [item.username, item.count]),
  );
  renderGptStats();
  await persistGptState();

  if (!silent) {
    setGptStatsFeedback("统计已更新。", "success");
  } else {
    setGptStatsFeedback("");
  }
}

async function reportGptUsage() {
  if (!state.collab.serverUrl || !state.collab.token) return;

  const response = await fetchWithFriendlyError(`${state.collab.serverUrl}/api/gpt/usage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.collab.token}`,
    },
    body: JSON.stringify({ count: 1 }),
  }, 8000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `记录 GPT 使用次数失败（${response.status}）`);
  }

  await loadGptSummaryStats();
  await loadGptRangeStats({ silent: true });
}

async function openGptExternal(rawUrl) {
  const url = safeText(rawUrl) || normalizeGptUrl(state.gpt.lastUrl);
  if (!url) return;
  await window.api.openExternal(url);
}

function rememberGptUrl(rawUrl) {
  const url = normalizeGptUrl(rawUrl);
  state.gpt.lastUrl = url;
  persistGptState().catch((err) => {
    logLine("app", `保存 GPT 页面位置失败：${err.message || err}`);
  });
}

function handleGptTrackerMessage(message) {
  const raw = String(message || "");
  if (!raw.startsWith(GPT_QUERY_MARKER)) return false;

  try {
    const payload = JSON.parse(raw.slice(GPT_QUERY_MARKER.length));
    registerGptQuery(payload?.text || "");
  } catch {
    registerGptQuery("");
  }
  return true;
}

function installGptQueryTracker() {
  if (!window.api?.executeAiJavaScript || !isGptAllowedUrl(state.gpt.lastUrl)) return;

  const marker = JSON.stringify(GPT_QUERY_MARKER);
  window.api.executeAiJavaScript({
    kind: "gpt",
    code: `
    (() => {
      if (window.__gptQueryTrackerInstalled) return;
      window.__gptQueryTrackerInstalled = true;

      const emit = () => {
        const textarea = document.querySelector("textarea");
        const editor = document.querySelector('[contenteditable="true"]');
        const text = String(textarea?.value || editor?.innerText || "").trim().slice(0, 160);
        console.log(${marker} + JSON.stringify({ text, stamp: Date.now() }));
      };

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        const target = event.target;
        const editable = Boolean(
          target?.closest?.("textarea")
          || target?.closest?.('[contenteditable="true"]')
          || target?.matches?.('[contenteditable="true"]'),
        );
        if (!editable) return;
        setTimeout(emit, 0);
      }, true);

      document.addEventListener("click", (event) => {
        const button = event.target?.closest?.(
          'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]',
        );
        if (!button) return;
        setTimeout(emit, 0);
      }, true);
    })();
  `,
  }).catch(() => {
    // ignore tracker injection failures
  });
}

async function ensureGptWorkspace(options = {}) {
  const forceReload = Boolean(options.forceReload);
  updateGptProxyInfo();
  updateGptRuntimeState();

  if (!state.status?.senderRunning) {
    return;
  }

  const payload = await window.api.ensureAiWorkspace({
    kind: "gpt",
    partition: state.gpt.partition,
    host: state.gpt.proxyHost,
    port: state.gpt.proxyPort,
    homeUrl: state.gpt.homeUrl,
    lastUrl: normalizeGptUrl(state.gpt.lastUrl),
    userAgent: gptUserAgent(),
    forceReload,
  });

  applyAiWorkspaceState("gpt", payload);
  updateGptRuntimeState();
}

function syncGeminiFullscreenState() {
  const shell = el("geminiBrowserShell");
  const isFullscreen = Boolean(shell && document.fullscreenElement === shell);

  if (el("btnGeminiToggleFullscreen")) {
    el("btnGeminiToggleFullscreen").textContent = isFullscreen ? "退出全屏" : "全屏";
  }
}

function updateGeminiNavState() {
  if (el("btnGeminiBack")) el("btnGeminiBack").disabled = !state.gemini.canGoBack;
  if (el("btnGeminiForward")) el("btnGeminiForward").disabled = !state.gemini.canGoForward;
  if (el("btnGeminiReload")) el("btnGeminiReload").disabled = !Boolean(state.status?.senderRunning);
  if (el("btnGeminiOpenExternal")) {
    el("btnGeminiOpenExternal").disabled = !safeText(state.gemini.lastUrl);
  }

  syncGeminiFullscreenState();
}

function updateGeminiProxyInfo() {
  state.gemini.proxyPort = resolveGptProxyPort();
  if (el("geminiProxyInfo")) {
    el("geminiProxyInfo").textContent = `SOCKS5 ${state.gemini.proxyHost}:${state.gemini.proxyPort}`;
  }
}

function updateGeminiRuntimeState() {
  const runtimeNode = el("geminiRuntimeState");
  const overlay = el("geminiOverlay");
  const overlayTitle = el("geminiOverlayTitle");
  const overlayText = el("geminiOverlayText");
  const senderRunning = Boolean(state.status?.senderRunning);

  if (runtimeNode) {
    if (!senderRunning) {
      runtimeNode.textContent = "等待发送服务";
    } else if (state.gemini.webviewLoading) {
      runtimeNode.textContent = "正在加载";
    } else if (state.gemini.webviewInitialized) {
      runtimeNode.textContent = "已打开";
    } else {
      runtimeNode.textContent = "准备打开";
    }
  }

  updateGeminiNavState();

  if (!overlay || !overlayTitle || !overlayText) {
    scheduleAiHostsLayoutSync();
    return;
  }

  if (!senderRunning) {
    overlay.hidden = false;
    overlayTitle.textContent = "请先开启发送服务";
    overlayText.textContent = `内置 Gemini 网页会通过 ${state.gemini.proxyHost}:${state.gemini.proxyPort} 代理访问。请先在“连接设置”中开启发送服务。`;
    scheduleAiHostsLayoutSync();
    return;
  }

  if (!state.gemini.webviewInitialized) {
    overlay.hidden = false;
    overlayTitle.textContent = "准备打开 Gemini";
    overlayText.textContent = "正在初始化内置页面并连接本地代理。Google 登录可能会跳转到账号验证页面。";
    scheduleAiHostsLayoutSync();
    return;
  }

  overlay.hidden = true;
  scheduleAiHostsLayoutSync();
}

async function openGeminiExternal(rawUrl) {
  const url = safeText(rawUrl) || normalizeGeminiUrl(state.gemini.lastUrl);
  if (!url) return;
  await window.api.openExternal(url);
}

function rememberGeminiUrl(rawUrl) {
  const url = normalizeGeminiUrl(rawUrl);
  state.gemini.lastUrl = url;
  persistGptState().catch((err) => {
    logLine("app", `保存 Gemini 页面位置失败：${err.message || err}`);
  });
}

async function ensureGeminiWorkspace(options = {}) {
  const forceReload = Boolean(options.forceReload);
  updateGeminiProxyInfo();
  updateGeminiRuntimeState();

  if (!state.status?.senderRunning) {
    return;
  }

  const payload = await window.api.ensureAiWorkspace({
    kind: "gemini",
    partition: state.gemini.partition,
    host: state.gemini.proxyHost,
    port: state.gemini.proxyPort,
    homeUrl: state.gemini.homeUrl,
    lastUrl: normalizeGeminiUrl(state.gemini.lastUrl),
    userAgent: gptUserAgent(),
    forceReload,
  });

  applyAiWorkspaceState("gemini", payload);
  updateGeminiRuntimeState();
}

function roomConversationKey(scopeText = state.collab.roomScope) {
  return `room:${safeText(scopeText) || "-"}`;
}

function privateConversationKey(username) {
  const user = safeText(username);
  return user ? `user:${user}` : "";
}

function currentConversationKey() {
  if (currentChatScope() === "private") {
    return privateConversationKey(el("c_chat_target")?.value);
  }
  return roomConversationKey();
}

function formatUnreadCount(count) {
  const value = Number(count) || 0;
  if (value <= 0) return "";
  return value > 99 ? "99+" : String(value);
}

function getUnreadCount(key) {
  return Number(state.collab.unreadByConversation.get(key) || 0);
}

function clearUnreadCount(key) {
  if (!key) return;
  state.collab.unreadByConversation.delete(key);
}

function increaseUnreadCount(key) {
  if (!key) return;
  const next = getUnreadCount(key) + 1;
  state.collab.unreadByConversation.set(key, next);
}

function resetConversationState() {
  state.collab.messagesByConversation = new Map();
  state.collab.unreadByConversation = new Map();
}

function resetPresenceState() {
  state.collab.knownOnlineUsers = new Set();
  state.collab.presenceReady = false;
}

function showToast(title, message, tone = "info") {
  const stack = el("toastStack");
  if (!stack) return;

  const card = document.createElement("article");
  card.className = "toast-card";
  card.dataset.tone = tone;

  const heading = document.createElement("strong");
  heading.textContent = safeText(title) || "提醒";

  const text = document.createElement("p");
  text.textContent = safeText(message);

  card.appendChild(heading);
  card.appendChild(text);
  stack.prepend(card);

  while (stack.childElementCount > 4) {
    stack.lastElementChild?.remove();
  }

  window.setTimeout(() => {
    card.remove();
  }, 4200);
}

function logLine(source, line) {
  const box = el("logBox");
  if (!box) return;
  const ts = new Date().toLocaleTimeString();
  const sourceLabel = SOURCE_LABELS[source] || source || "系统";
  box.textContent += `[${ts}] [${sourceLabel}] ${line}\n`;
  box.scrollTop = box.scrollHeight;
}

function appendToReceiverSplit(source, line) {
  const ts = new Date().toLocaleTimeString();

  if (source === "receiver-singbox") {
    const box = el("receiverSingboxLog");
    if (!box) return;
    box.textContent += `[${ts}] ${line}\n`;
    box.scrollTop = box.scrollHeight;
    return;
  }

  if (source === "receiver-frpc") {
    const box = el("receiverFrpcLog");
    if (!box) return;
    box.textContent += `[${ts}] ${line}\n`;
    box.scrollTop = box.scrollHeight;
  }
}

function getViewMeta(view) {
  const guest = state.mode === "sender" && !state.collab.token;
  const receiverMode = state.mode === "receiver";
  const viewMeta = {
    sender: {
      title: "连接设置",
      subtitle: "填写连接信息后，可开启发送端，让需要的网站通过这台设备访问。",
    },
    receiver: {
      title: "接收端设置",
      subtitle: "填写接收端信息后，可在当前设备开启接收服务，让另一台设备的连接通过这里完成接收和转发。",
    },
    logs: {
      title: "运行记录",
      subtitle: receiverMode
        ? "这里会显示接收服务、连接核心和端口映射的运行状态。"
        : "这里会显示运行状态，方便查看启动、停止和异常信息。",
    },
    account: guest
      ? {
          title: "账号登录",
          subtitle: "登录后即可使用连接设置、消息、ChatGPT 网页和 Gemini 网页。",
        }
      : {
          title: "账号与信息",
      subtitle: "在这里登录账号、查看状态，并管理账号资料。",
        },
    chat: {
      title: "联系人与聊天",
      subtitle: "左侧选择房间或联系人，右侧查看消息并继续聊天。",
    },
    "message-settings": {
      title: "消息设置",
      subtitle: "控制收到消息和联系人上线时的提醒方式。",
    },
    gpt: {
      title: "ChatGPT 网页",
      subtitle: "在软件内继续 ChatGPT 对话，并通过本地代理访问。",
    },
    gemini: {
      title: "Gemini 网页",
      subtitle: "在软件内打开 Gemini，并通过本地代理完成 Google 登录和对话。",
    },
    "gpt-stats": {
      title: "AI 使用统计",
      subtitle: "按时间范围查看账号提问次数分布。",
    },
  };

  return viewMeta[view] || viewMeta.sender;
}

function syncTopbarTitle(view) {
  const titleNode = el("topViewTitle");
  const subTitle = el("subTitle");
  const meta = getViewMeta(view);

  if (titleNode) titleNode.textContent = meta.title;
  if (subTitle) subTitle.textContent = meta.subtitle;
}

function getAvailableViews(mode = state.mode) {
  if (mode === "receiver") return ["receiver", "logs"];
  if (!state.collab.token) return ["account"];
  return ["sender", "logs", "account", "gpt", "gemini", "chat", "message-settings", "gpt-stats"];
}

function setActiveView(view) {
  const availableViews = getAvailableViews();
  const nextView = availableViews.includes(view) ? view : availableViews[0];
  const activeNavView = ["message-settings", "chat"].includes(nextView)
    ? "chat"
    : (nextView === "gpt-stats" ? "gpt-stats" : nextView);
  state.view = nextView;
  document.body.dataset.view = nextView;

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-view-panel") === nextView);
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-view-target") === activeNavView);
  });

  syncTopbarTitle(nextView);
  if (nextView === "chat") {
    syncChatConversation();
  }
  if (nextView === "gpt") {
    ensureGptWorkspace().catch((err) => {
      setGptFeedback(err.message || String(err), "error");
    });
  }
  if (nextView === "gemini") {
    ensureGeminiWorkspace().catch((err) => {
      setGeminiFeedback(err.message || String(err), "error");
    });
  }
  if (nextView === "gpt-stats") {
    syncGptStatsFilterInputs();
    renderGptStats();
    loadGptRangeStats({ silent: true }).catch((err) => {
      setGptStatsFeedback(err.message || String(err), "error");
    });
  }
  scheduleAiHostsLayoutSync();
}

function syncAuthLayout() {
  const guest = state.mode === "sender" && !state.collab.token;
  document.body.dataset.auth = guest ? "guest" : "member";

  const preferredView = guest
    ? "account"
    : (getAvailableViews().includes(state.view) ? state.view : (state.mode === "receiver" ? "receiver" : "sender"));

  setActiveView(preferredView);
}

function refreshSenderAccess() {
  const senderPanel = el("senderPanel");
  if (!senderPanel || state.mode === "receiver") return;

  const senderRunning = Boolean(state.status?.senderRunning);
  const canUseSender = isCollabOnline();
  const hint = el("senderAuthHint");
  const senderInputs = senderPanel.querySelectorAll("input, select, textarea");

  for (const input of senderInputs) {
    const isFallbackPort = input.id === "s_fallback_local_port";
    if (input.id === "s_target_domains") {
      input.readOnly = true;
    }
    if (isFallbackPort && el("s_fallback_mode")?.value === "direct") {
      input.disabled = true;
      continue;
    }
    input.disabled = !canUseSender || senderRunning;
  }

  if (el("btnStartSender")) el("btnStartSender").disabled = senderRunning || !canUseSender;
  if (el("btnSaveSender")) el("btnSaveSender").disabled = !canUseSender;
  if (el("btnStopSender")) el("btnStopSender").disabled = !senderRunning;

  if (hint) {
    hint.style.display = canUseSender ? "none" : "block";
  }
}

function syncReceiverOverview() {
  const receiverRunning = Boolean(state.status?.receiverFrpcRunning || state.status?.receiverSingboxRunning);
  const remotePort = safeText(el("r_remote_port")?.value);
  const forwardPort = safeText(el("r_forward_proxy_port")?.value);

  if (el("receiverOverviewState")) {
    el("receiverOverviewState").textContent = receiverRunning ? "运行中" : "未开启";
  }

  if (el("receiverOverviewRemote")) {
    el("receiverOverviewRemote").textContent = remotePort || "未填写";
  }

  if (el("receiverOverviewForward")) {
    el("receiverOverviewForward").textContent = forwardPort ? `127.0.0.1:${forwardPort}` : "未填写";
  }
}

function setStatus(status) {
  state.status = status;
  const senderRunning = Boolean(status?.senderRunning);
  const receiverRunning = Boolean(status?.receiverFrpcRunning || status?.receiverSingboxRunning);

  if (el("senderState")) el("senderState").textContent = `发送服务：${senderRunning ? "运行中" : "未开启"}`;
  if (el("receiverState")) el("receiverState").textContent = `接收服务：${receiverRunning ? "运行中" : "未开启"}`;

  if (el("senderDot")) el("senderDot").classList.toggle("running", senderRunning);
  if (el("receiverDot")) el("receiverDot").classList.toggle("running", receiverRunning);

  if (el("btnStartReceiver")) el("btnStartReceiver").disabled = receiverRunning;
  if (el("btnStopReceiver")) el("btnStopReceiver").disabled = !receiverRunning;

  refreshSenderAccess();
  syncReceiverOverview();
  updateGptRuntimeState();
  updateGeminiRuntimeState();

  if (senderRunning && state.view === "gpt" && !state.gpt.webviewInitialized) {
    ensureGptWorkspace().catch((err) => {
      setGptFeedback(err.message || String(err), "error");
    });
  }
  if (senderRunning && state.view === "gemini" && !state.gemini.webviewInitialized) {
    ensureGeminiWorkspace().catch((err) => {
      setGeminiFeedback(err.message || String(err), "error");
    });
  }
}

function applyModeLayout(mode) {
  const uiMode = mode === "receiver" ? "receiver" : "sender";
  state.mode = uiMode;
  document.body.dataset.mode = uiMode;
  syncAuthLayout();
}

function getSenderForm() {
  return {
    proxy_server: safeText(el("s_proxy_server")?.value),
    proxy_port: safeText(el("s_proxy_port")?.value),
    proxy_uuid: safeText(el("s_proxy_uuid")?.value),
    socks_listen_port: safeText(el("s_socks_listen_port")?.value),
    fallback_mode: el("s_fallback_mode")?.value,
    fallback_local_port: safeText(el("s_fallback_local_port")?.value),
    target_domains: DEFAULT_TARGET_DOMAINS,
  };
}

function getReceiverForm() {
  return {
    frps_server: safeText(el("r_frps_server")?.value),
    frps_port: safeText(el("r_frps_port")?.value),
    frps_token: safeText(el("r_frps_token")?.value),
    remote_port: safeText(el("r_remote_port")?.value),
    vmess_listen_port: safeText(el("r_vmess_listen_port")?.value),
    vmess_uuid: safeText(el("r_vmess_uuid")?.value),
    forward_proxy_port: safeText(el("r_forward_proxy_port")?.value),
    tls_enable: Boolean(el("r_tls_enable")?.checked),
    use_compression: Boolean(el("r_use_compression")?.checked),
    use_encryption: Boolean(el("r_use_encryption")?.checked),
  };
}

function getGptForm() {
  return {
    partition: state.gpt.partition,
    home_url: state.gpt.homeUrl,
    last_url: normalizeGptUrl(state.gpt.lastUrl),
    proxy_host: state.gpt.proxyHost,
    proxy_port: resolveGptProxyPort(),
    total_queries: gptTotalQueries(),
    query_users: state.gpt.queryUsers,
    stats_preset: state.gpt.statsPreset,
    stats_from: state.gpt.statsFrom,
    stats_to: state.gpt.statsTo,
  };
}

function getGeminiForm() {
  return {
    partition: state.gemini.partition,
    home_url: state.gemini.homeUrl,
    last_url: normalizeGeminiUrl(state.gemini.lastUrl),
    proxy_host: state.gemini.proxyHost,
    proxy_port: resolveGptProxyPort(),
  };
}

function getUiForm() {
  return {
    setup_guide_dismissed: Boolean(state.ui.setupGuideDismissed),
  };
}

function getCollabForm() {
  return {
    server_url: safeText(el("c_server_url")?.value),
    last_username: safeText(el("c_username")?.value),
    last_avatar: safeText(state.collab.avatar),
    remember_password: Boolean(state.collab.rememberPassword),
    saved_password: state.collab.rememberPassword ? String(state.collab.savedPassword || "") : "",
    notify_message_popup: Boolean(state.collab.notifyMessagePopup),
    notify_user_online: Boolean(state.collab.notifyUserOnline),
    pinned_users: [...state.collab.pinnedUsers],
  };
}

function fillForm(settings) {
  const sender = settings.sender || {};
  const receiver = settings.receiver || {};
  const collab = settings.collab || {};
  const gpt = settings.gpt || {};
  const gemini = settings.gemini || {};
  const ui = settings.ui || {};

  if (el("s_proxy_server")) el("s_proxy_server").value = sender.proxy_server || "";
  if (el("s_proxy_port")) el("s_proxy_port").value = sender.proxy_port || "";
  if (el("s_proxy_uuid")) el("s_proxy_uuid").value = sender.proxy_uuid || "";
  if (el("s_socks_listen_port")) el("s_socks_listen_port").value = sender.socks_listen_port || "";
  if (el("s_fallback_mode")) el("s_fallback_mode").value = sender.fallback_mode || "system_proxy";
  if (el("s_fallback_local_port")) el("s_fallback_local_port").value = sender.fallback_local_port || "";
  if (el("s_target_domains")) {
    el("s_target_domains").value = DEFAULT_TARGET_DOMAINS;
    el("s_target_domains").readOnly = true;
  }

  if (el("r_frps_server")) el("r_frps_server").value = receiver.frps_server || "";
  if (el("r_frps_port")) el("r_frps_port").value = receiver.frps_port || "";
  if (el("r_frps_token")) el("r_frps_token").value = receiver.frps_token || "";
  if (el("r_remote_port")) el("r_remote_port").value = receiver.remote_port || "";
  if (el("r_vmess_listen_port")) el("r_vmess_listen_port").value = receiver.vmess_listen_port || "";
  if (el("r_vmess_uuid")) el("r_vmess_uuid").value = receiver.vmess_uuid || "";
  if (el("r_forward_proxy_port")) el("r_forward_proxy_port").value = receiver.forward_proxy_port || "";
  if (el("r_tls_enable")) el("r_tls_enable").checked = Boolean(receiver.tls_enable);
  if (el("r_use_compression")) el("r_use_compression").checked = Boolean(receiver.use_compression);
  if (el("r_use_encryption")) el("r_use_encryption").checked = Boolean(receiver.use_encryption);

  if (el("c_server_url")) el("c_server_url").value = collab.server_url || "";
  if (el("c_username")) el("c_username").value = collab.last_username || "";
  state.collab.rememberPassword = Boolean(collab.remember_password);
  state.collab.savedPassword = state.collab.rememberPassword ? String(collab.saved_password || "") : "";
  state.collab.notifyMessagePopup = collab.notify_message_popup !== false;
  state.collab.notifyUserOnline = Boolean(collab.notify_user_online);
  if (el("c_password")) el("c_password").value = state.collab.savedPassword;
  if (el("c_remember_password")) el("c_remember_password").checked = state.collab.rememberPassword;
  if (el("c_notify_message_popup")) el("c_notify_message_popup").checked = state.collab.notifyMessagePopup;
  if (el("c_notify_user_online")) el("c_notify_user_online").checked = state.collab.notifyUserOnline;

  state.collab.avatar = safeText(collab.last_avatar);
  state.collab.pinnedUsers = new Set(Array.isArray(collab.pinned_users) ? collab.pinned_users.map((item) => safeText(item)).filter(Boolean) : []);
  state.gpt.partition = safeText(gpt.partition) || state.gpt.partition;
  state.gpt.homeUrl = normalizeGptUrl(gpt.home_url || state.gpt.homeUrl);
  state.gpt.lastUrl = normalizeGptUrl(gpt.last_url || state.gpt.homeUrl);
  state.gpt.proxyHost = safeText(gpt.proxy_host) || GPT_PROXY_HOST;
  state.gpt.proxyPort = safeText(gpt.proxy_port) || GPT_PROXY_PORT;
  state.gpt.totalQueries = Number(gpt.total_queries) || 0;
  state.gpt.queryUsers = Object.fromEntries(
    Object.entries(gpt.query_users || {})
      .map(([username, count]) => [safeText(username), Number(count) || 0])
      .filter(([username, count]) => username && count > 0),
  );
  const statsPreset = safeText(gpt.stats_preset);
  if (statsPreset === "custom") {
    state.gpt.statsPreset = "custom";
    state.gpt.statsFrom = safeText(gpt.stats_from);
    state.gpt.statsTo = safeText(gpt.stats_to);
  } else if (statsPreset === "all") {
    setGptStatsPreset("all");
  } else {
    setGptStatsPreset(statsPreset || "30d");
  }
  state.gemini.partition = safeText(gemini.partition) || state.gemini.partition;
  state.gemini.homeUrl = normalizeGeminiUrl(gemini.home_url || state.gemini.homeUrl);
  state.gemini.lastUrl = normalizeGeminiUrl(gemini.last_url || state.gemini.homeUrl);
  state.gemini.proxyHost = safeText(gemini.proxy_host) || GPT_PROXY_HOST;
  state.gemini.proxyPort = safeText(gemini.proxy_port) || GPT_PROXY_PORT;
  state.ui.setupGuideDismissed = Boolean(ui.setup_guide_dismissed);

  refreshFallbackVisibility();
  syncReceiverOverview();
  updateGptProxyInfo();
  updateGeminiProxyInfo();
  syncGptStatsFilterInputs();
  syncGptFullscreenState();
  syncGeminiFullscreenState();
  updateGptCounters();
  updateGptRuntimeState();
  updateGeminiRuntimeState();
  renderSetupGuide();
}

function applyDeviceInfo(deviceInfo) {
  const info = deviceInfo || {};
  const host = safeText(info.hostname) || "local";
  const preferredIp = safeText(info.preferredIpv4) || "127.0.0.1";

  state.deviceInfo = {
    hostname: host,
    preferredIpv4: preferredIp,
    ipv4List: Array.isArray(info.ipv4List) ? info.ipv4List : [],
  };

  if (el("c_local_info")) {
    el("c_local_info").textContent = `${host} / ${preferredIp}`;
  }
}

function normalizeServerOrigin(raw) {
  const text = safeText(raw);
  if (!text) return "";

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const protocol = url.protocol === "https:" ? "https:" : "http:";
      const port = url.port || "8088";
      return `${protocol}//${url.hostname}:${port}`;
    } catch {
      return "";
    }
  }

  return `http://${text}:8088`;
}

async function isServerReachable(serverOrigin, timeoutMs = 1200) {
  const origin = normalizeServerOrigin(serverOrigin);
  if (!origin) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/api/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function applySuggestedServerUrl() {
  const currentServer = safeText(el("c_server_url")?.value);
  if (!currentServer) {
    const senderProxyServer = safeText(el("s_proxy_server")?.value);
    const remoteCandidate = normalizeServerOrigin(senderProxyServer);
    if (remoteCandidate) {
      el("c_server_url").value = remoteCandidate;
    }
    return;
  }

  const localServer = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(currentServer);

  if (localServer) {
    const localOk = await isServerReachable(currentServer, 1200);
    if (!localOk) {
      const senderProxyServer = safeText(el("s_proxy_server")?.value);
      const remoteCandidate = normalizeServerOrigin(senderProxyServer);
      if (remoteCandidate) {
        el("c_server_url").value = remoteCandidate;
      }
    }
  }

}

async function syncWindowMaxButton() {
  const btn = el("btnWinMax");
  if (!btn) return;
  try {
    const maximized = await window.api.isWindowMaximized();
    btn.dataset.maximized = maximized ? "true" : "false";
    btn.title = maximized ? "恢复窗口" : "最大化";
    btn.setAttribute("aria-label", maximized ? "恢复窗口" : "最大化");
  } catch {
    btn.dataset.maximized = "false";
    btn.title = "最大化";
    btn.setAttribute("aria-label", "最大化");
  }
}
function refreshFallbackVisibility() {
  const direct = el("s_fallback_mode")?.value === "direct";
  if (el("fallbackPortWrap")) el("fallbackPortWrap").style.opacity = direct ? "0.5" : "1";
  if (el("s_fallback_local_port")) el("s_fallback_local_port").disabled = direct;
  if (el("s_target_domains")) el("s_target_domains").readOnly = true;
  refreshSenderAccess();
}

async function saveSettings(options = {}) {
  const silent = Boolean(options.silent);
  state.settings = {
    sender: getSenderForm(),
    receiver: getReceiverForm(),
    collab: getCollabForm(),
    gpt: getGptForm(),
    gemini: getGeminiForm(),
    ui: getUiForm(),
  };
  await window.api.saveSettings(state.settings);
  if (!silent) {
    logLine("app", "设置已保存");
  }
}

function setCollabState(text) {
  if (el("c_conn_state")) el("c_conn_state").textContent = text;
  if (el("c_chat_status_badge")) el("c_chat_status_badge").textContent = text;
}

function setCollabFeedback(text = "", tone = "") {
  const node = el("c_feedback");
  if (!node) return;

  const message = safeText(text);
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    delete node.dataset.tone;
    return;
  }

  node.hidden = false;
  node.textContent = message;
  if (tone) {
    node.dataset.tone = tone;
  } else {
    delete node.dataset.tone;
  }
}

function setPanelFeedback(id, text = "", tone = "") {
  const node = el(id);
  if (!node) return;

  const message = safeText(text);
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    delete node.dataset.tone;
    return;
  }

  node.hidden = false;
  node.textContent = message;
  if (tone) {
    node.dataset.tone = tone;
  } else {
    delete node.dataset.tone;
  }
}

function focusCollabField(id, select = false) {
  const node = el(id);
  if (!(node instanceof HTMLInputElement)) return;

  window.setTimeout(() => {
    node.focus();
    if (select) {
      node.select();
    }
  }, 0);
}

function focusAnyField(id, select = false) {
  const node = el(id);
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) return;

  window.setTimeout(() => {
    node.focus();
    if (select && "select" in node && typeof node.select === "function") {
      node.select();
    }
  }, 0);
}

function renderSetupGuide() {
  const overlay = el("setupGuide");
  const titleNode = el("setupGuideTitle");
  const introNode = el("setupGuideIntro");
  const listNode = el("setupGuideChecklist");
  const primaryBtn = el("btnSetupGuideAction");

  if (!overlay || !titleNode || !introNode || !listNode || !primaryBtn) return;

  if (!shouldShowSetupGuide()) {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  const needsLogin = !state.collab.token;
  titleNode.textContent = needsLogin ? "首次启动先完成基础配置" : "还差一步就可以开始使用";
  introNode.textContent = needsLogin
    ? "系统已经准备好本地配置模板。先补全账号服务地址并登录，随后再填写发送端连接信息。"
    : "账号已经就绪，补全发送端连接信息后就可以启动服务并打开内嵌 AI 页面。";
  primaryBtn.textContent = needsLogin ? "去填写登录信息" : "去填写连接设置";

  listNode.textContent = "";
  for (const item of buildSetupGuideItems()) {
    const li = document.createElement("li");
    li.textContent = item;
    listNode.appendChild(li);
  }
}

async function dismissSetupGuide() {
  state.ui.setupGuideDismissed = true;
  renderSetupGuide();
  await saveSettings({ silent: true });
}

function handleSetupGuideAction() {
  if (!state.collab.token) {
    setActiveView("account");
    focusCollabField("c_server_url", true);
    return;
  }

  setActiveView("sender");

  if (!isPlaceholderValue(el("s_proxy_server")?.value || state.settings?.sender?.proxy_server)) {
    if (!/^\d+$/.test(safeText(el("s_proxy_port")?.value || state.settings?.sender?.proxy_port))) {
      focusAnyField("s_proxy_port", true);
      return;
    }
    if (isPlaceholderValue(el("s_proxy_uuid")?.value || state.settings?.sender?.proxy_uuid)) {
      focusAnyField("s_proxy_uuid", true);
      return;
    }
  }

  focusAnyField("s_proxy_server", true);
}

function setCollabIdentity(text) {
  if (el("c_me")) el("c_me").textContent = text || "-";
  refreshTopIdentity();
}

function hideContextMenu() {
  const menu = el("appContextMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.textContent = "";
  state.contextMenuOpen = false;
}

function showContextMenu(x, y, items = []) {
  const menu = el("appContextMenu");
  if (!menu || !Array.isArray(items) || !items.length) return;

  if (state.contextMenuOpen) {
    hideContextMenu();
  }

  menu.textContent = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = safeText(item?.label) || "操作";
    btn.disabled = Boolean(item?.disabled);
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideContextMenu();
      if (typeof item?.onClick === "function") {
        try {
          await item.onClick();
        } catch (err) {
          logLine("collab", `操作未完成：${err.message || err}`);
        }
      }
    });
    menu.appendChild(btn);
  }

  menu.hidden = false;
  state.contextMenuOpen = true;

  menu.style.left = "0px";
  menu.style.top = "0px";
  const maxLeft = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
  const left = Math.min(Math.max(8, x), maxLeft);
  const top = Math.min(Math.max(8, y), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function sortUsers(users) {
  const pinned = state.collab.pinnedUsers;
  return [...users].sort((a, b) => {
    const aPinned = pinned.has(a.username) ? 1 : 0;
    const bPinned = pinned.has(b.username) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const aOnline = a.online ? 1 : 0;
    const bOnline = b.online ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;

    return String(a.displayName || a.username).localeCompare(String(b.displayName || b.username));
  });
}

function pickPrivateTarget(username) {
  const targetUser = safeText(username);
  if (!targetUser) return;
  if (el("c_chat_scope")) {
    el("c_chat_scope").value = "private";
  }
  refreshPrivateTargets();
  if (el("c_chat_target")) {
    el("c_chat_target").value = targetUser;
  }
  syncChatConversation();
  setPanelFeedback("chat_feedback", "");
  if (state.mode !== "receiver" && state.collab.token) {
    setActiveView("chat");
  }
}

function pickRoomConversation() {
  if (el("c_chat_scope")) {
    el("c_chat_scope").value = "subnet";
  }
  if (el("c_chat_target")) {
    el("c_chat_target").value = "";
  }
  syncChatConversation();
  setPanelFeedback("chat_feedback", "");
}

function openFriendActionsMenu(user, event) {
  const username = safeText(user?.username);
  if (!username) return;
  const pinned = state.collab.pinnedUsers.has(username);

  showContextMenu(event.clientX, event.clientY, [
    {
      label: pinned ? "取消置顶" : "置顶该好友",
      onClick: () => togglePinUser(username),
    },
    {
      label: "设为私聊对象",
      disabled: username === state.collab.username,
      onClick: () => {
        pickPrivateTarget(username);
      },
    },
  ]);
}

async function togglePinUser(username) {
  const user = safeText(username);
  if (!user) return;

  if (state.collab.pinnedUsers.has(user)) {
    state.collab.pinnedUsers.delete(user);
    logLine("collab", `已取消置顶: ${user}`);
  } else {
    state.collab.pinnedUsers.add(user);
    logLine("collab", `已置顶: ${user}`);
  }

  await saveSettings({ silent: true });
  renderUserDirectory(state.collab.userDirectory);
  refreshPrivateTargets();
}

function renderUserDirectory(users) {
  const list = el("c_online_list");
  if (!list) return;

  list.textContent = "";
  const sorted = sortUsers(users);
  const onlineCount = sorted.filter((item) => item.online).length;

  if (el("c_online_count")) {
    el("c_online_count").textContent = `${onlineCount} 人在线`;
  }

  if (!sorted.length) {
    const li = document.createElement("li");
    li.textContent = "暂时没有联系人";
    list.appendChild(li);
    return;
  }

  for (const user of sorted) {
    const username = safeText(user.username);
    const displayName = safeText(user.displayName) || username;
    const avatar = avatarMark(user.avatar, displayName);
    const online = Boolean(user.online);
    const pinned = state.collab.pinnedUsers.has(username);
    const self = username === state.collab.username;
    const selected = currentChatScope() === "private" && safeText(el("c_chat_target")?.value) === username;
    const unread = getUnreadCount(privateConversationKey(username));
    const subnet = safeText(user.subnetLabel || user.subnetKey);
    const subtitleBits = [self ? "当前账号" : username];

    if (subnet) {
      subtitleBits.push(subnet);
    }

    const li = document.createElement("li");
    li.className = `${online ? "online" : "offline"}${pinned ? " pinned" : ""}${selected ? " active" : ""}`;
    li.title = `${username}（左键切换聊天，右键查看更多操作）`;
    li.dataset.username = username;

    const main = document.createElement("div");
    main.className = "user-main";

    const avatarNode = document.createElement("span");
    avatarNode.className = "contact-avatar";
    avatarNode.textContent = avatar;

    const copy = document.createElement("div");
    copy.className = "contact-copy";

    const name = document.createElement("strong");
    const pinMark = pinned ? "置顶 · " : "";
    name.textContent = `${pinMark}${displayName}`;

    const meta = document.createElement("span");
    meta.textContent = subtitleBits.join(" · ");

    const badge = document.createElement("span");
    badge.className = `user-badge ${online ? "" : "off"}`;
    badge.textContent = self ? "自己" : (online ? "在线" : "离线");

    const side = document.createElement("div");
    side.className = "contact-side";
    side.appendChild(badge);

    if (unread > 0) {
      const unreadBadge = document.createElement("span");
      unreadBadge.className = "unread-badge";
      unreadBadge.textContent = formatUnreadCount(unread);
      side.appendChild(unreadBadge);
    }

    copy.appendChild(name);
    copy.appendChild(meta);
    main.appendChild(avatarNode);
    main.appendChild(copy);
    li.appendChild(main);
    li.appendChild(side);

    li.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (self) {
        setPanelFeedback("chat_feedback", "无需给自己发送私聊消息。", "error");
        return;
      }
      pickPrivateTarget(username);
    });

    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFriendActionsMenu(user, event);
    });

    list.appendChild(li);
  }
}

function setUserDirectory(users, options = {}) {
  const items = Array.isArray(users) ? users : [];
  const normalized = items.map((item) => ({
    username: safeText(item?.username),
    displayName: safeText(item?.displayName) || safeText(item?.username),
    avatar: safeText(item?.avatar),
    online: Boolean(item?.online),
    subnetKey: safeText(item?.subnetKey),
    subnetLabel: safeText(item?.subnetLabel),
  })).filter((item) => item.username);

  const nextOnlineUsers = new Set(normalized.filter((item) => item.online && item.username !== state.collab.username).map((item) => item.username));
  if (!options.silent && state.collab.presenceReady && state.collab.notifyUserOnline) {
    for (const user of normalized) {
      if (!user.online || user.username === state.collab.username) continue;
      if (state.collab.knownOnlineUsers.has(user.username)) continue;
      showToast("联系人已上线", `${user.displayName || user.username} 现在在线。`, "success");
    }
  }
  state.collab.knownOnlineUsers = nextOnlineUsers;
  state.collab.presenceReady = true;
  state.collab.userDirectory = normalized;

  renderUserDirectory(state.collab.userDirectory);
  refreshPrivateTargets();
}

function setCollabControls() {
  const connected = Boolean(state.collab.connected);
  const hasToken = Boolean(state.collab.token);
  const hasServerUrl = Boolean(safeText(el("c_server_url")?.value));
  const hasUsername = Boolean(safeText(el("c_username")?.value));
  const hasPassword = Boolean(String(el("c_password")?.value || ""));
  const canLogin = hasServerUrl && hasUsername && hasPassword;

  if (el("btnCollabLogin")) el("btnCollabLogin").disabled = hasToken || !canLogin;
  if (el("btnCollabLogout")) el("btnCollabLogout").disabled = !hasToken;
  if (el("btnAccountProfile")) el("btnAccountProfile").disabled = !hasToken;
  if (el("btnAccountLogout")) el("btnAccountLogout").disabled = !hasToken;
  if (el("btnChatSend")) el("btnChatSend").disabled = !connected;
  if (el("c_chat_input")) el("c_chat_input").disabled = !connected;
  if (el("c_chat_scope")) el("c_chat_scope").disabled = !connected;
  if (el("c_password")) el("c_password").disabled = hasToken;
  if (el("c_server_url")) el("c_server_url").disabled = hasToken;
  if (el("c_username")) el("c_username").disabled = hasToken;

  if (!hasToken && !connected && !hasServerUrl) {
    setCollabState("请填写服务地址");
  }

  refreshPrivateTargets();
  refreshSenderAccess();
  refreshTopIdentity();
  updateGptCounters();
  updateGptRuntimeState();
  updateGeminiRuntimeState();
  syncAuthLayout();
  renderSetupGuide();
}

function clearServiceFeedback(panel) {
  if (panel === "sender") {
    setPanelFeedback("s_feedback", "");
    return;
  }
  if (panel === "receiver") {
    setPanelFeedback("r_feedback", "");
  }
}

function refreshPrivateTargets() {
  const target = el("c_chat_target");
  if (!target) return;

  const oldValue = target.value;
  const scope = currentChatScope();
  const contacts = sortUsers(state.collab.userDirectory || []).filter((item) => item.username !== state.collab.username);

  target.textContent = "";

  if (!contacts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无可聊天的联系人";
    target.appendChild(option);
  } else {
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "请选择联系人";
    target.appendChild(first);

    for (const item of contacts) {
      const option = document.createElement("option");
      option.value = item.username;
      option.textContent = `${avatarMark(item.avatar, item.displayName)} ${item.displayName}${item.online ? "" : "（离线）"}`;
      target.appendChild(option);
    }
  }

  if (oldValue && contacts.some((item) => item.username === oldValue)) {
    target.value = oldValue;
  }

  target.disabled = !isCollabOnline() || scope !== "private" || !contacts.length;
  syncChatConversation();
}

function updateRoomUnreadBadge() {
  const badge = el("c_room_unread");
  if (!badge) return;
  const text = formatUnreadCount(getUnreadCount(roomConversationKey()));
  badge.hidden = !text;
  badge.textContent = text || "0";
}

function normalizeChatMessage(payload) {
  const scope = safeText(payload?.scope) === "private" ? "private" : "subnet";
  const from = safeText(payload?.from || payload?.username);
  const username = safeText(payload?.username || payload?.from) || "系统通知";
  const displayName = safeText(payload?.displayName) || username;
  const system = Boolean(payload?.system) || username === "系统通知";

  return {
    type: safeText(payload?.type) || (system ? "system" : "chat"),
    scope,
    from,
    to: safeText(payload?.to),
    username,
    displayName,
    avatar: safeText(payload?.avatar),
    text: safeText(payload?.text),
    timestamp: payload?.timestamp || new Date().toISOString(),
    subnetKey: safeText(payload?.subnetKey),
    subnetLabel: safeText(payload?.subnetLabel || payload?.roomScope),
    system,
  };
}

function conversationKeyForMessage(payload) {
  const message = normalizeChatMessage(payload);
  if (message.scope === "private") {
    const fromUser = safeText(message.from);
    const toUser = safeText(message.to);
    const otherUser = message.system
      ? toUser
      : (fromUser === state.collab.username ? toUser : safeText(fromUser || message.username));
    return privateConversationKey(otherUser);
  }

  const roomId = safeText(message.subnetLabel || message.subnetKey || state.collab.roomScope);
  return roomConversationKey(roomId);
}

function buildSystemMessage(text, extra = {}) {
  return normalizeChatMessage({
    type: "system",
    username: "系统通知",
    displayName: "系统通知",
    text,
    timestamp: extra.timestamp,
    scope: extra.scope || "subnet",
    to: extra.to,
    subnetKey: extra.subnetKey,
    subnetLabel: extra.subnetLabel,
    roomScope: extra.roomScope,
    system: true,
  });
}

function storeConversationMessage(payload) {
  const message = normalizeChatMessage(payload);
  const conversationKey = conversationKeyForMessage(message) || currentConversationKey();
  if (!conversationKey || !message.text) {
    return { conversationKey: "", message };
  }

  const items = state.collab.messagesByConversation.get(conversationKey) || [];
  items.push(message);
  if (items.length > 300) {
    items.splice(0, items.length - 300);
  }
  state.collab.messagesByConversation.set(conversationKey, items);
  return { conversationKey, message };
}

function renderActiveConversation() {
  const box = el("c_chat_box");
  if (!box) return;

  const conversationKey = currentConversationKey();
  const messages = conversationKey ? (state.collab.messagesByConversation.get(conversationKey) || []) : [];
  box.textContent = "";

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = currentChatScope() === "private"
      ? "这里暂时还没有私聊记录。选择联系人后，新消息会显示在这里。"
      : "这个房间还没有消息记录。";
    box.appendChild(empty);
    return;
  }

  for (const message of messages) {
    appendChatMessage(message, { box, scroll: false });
  }
  box.scrollTop = box.scrollHeight;
}

function replaceConversationHistory(messages) {
  resetConversationState();
  const items = Array.isArray(messages) ? messages : [];
  for (const item of items) {
    storeConversationMessage(item);
  }
  updateRoomUnreadBadge();
  renderUserDirectory(state.collab.userDirectory);
  renderActiveConversation();
}

function handleIncomingConversationMessage(payload) {
  const { conversationKey, message } = storeConversationMessage(payload);
  if (!conversationKey || !message.text) return;

  const activeKey = currentConversationKey();
  const fromSelf = safeText(message.from) === state.collab.username;
  const conversationVisible = state.view === "chat" && conversationKey === activeKey && state.windowFocused;
  const shouldNotify = !fromSelf && !message.system && state.collab.notifyMessagePopup && !conversationVisible;

  if (!fromSelf && !message.system && !conversationVisible) {
    increaseUnreadCount(conversationKey);
  }

  if (shouldNotify) {
    showToast(message.displayName || message.username, message.text, "info");
  }

  updateRoomUnreadBadge();
  renderUserDirectory(state.collab.userDirectory);

  if (conversationKey === activeKey) {
    renderActiveConversation();
  }
}

function syncChatConversation() {
  const scope = currentChatScope();
  const targetUsername = safeText(el("c_chat_target")?.value);
  const selectedUser = (state.collab.userDirectory || []).find((item) => item.username === targetUsername);
  const titleNode = el("c_chat_title");
  const subNode = el("c_chat_subtitle");
  const roomButton = el("c_room_channel");
  const inRoom = scope !== "private";

  if (roomButton) {
    roomButton.classList.toggle("active", inRoom);
  }

  document.querySelectorAll("#c_online_list li[data-username]").forEach((item) => {
    item.classList.toggle("active", !inRoom && item.getAttribute("data-username") === targetUsername);
  });

  if (inRoom) {
    const roomScope = safeText(state.collab.roomScope);
    if (titleNode) titleNode.textContent = "房间消息";
    if (subNode) {
      subNode.textContent = roomScope && roomScope !== "-"
        ? `发送给房间 ${roomScope} 内的所有在线联系人`
        : "发送给房间内的所有在线联系人";
    }
  } else if (!targetUsername) {
    if (titleNode) titleNode.textContent = "请选择联系人";
    if (subNode) subNode.textContent = "从左侧联系人列表中选择联系人后，就可以查看私聊记录并继续发送消息。";
  } else if (!selectedUser) {
    if (titleNode) titleNode.textContent = targetUsername;
    if (subNode) subNode.textContent = "暂未获取到该联系人的在线状态，历史消息仍会显示在这里。";
  } else {
    const subnet = safeText(selectedUser.subnetLabel || selectedUser.subnetKey);
    const detailBits = [
      selectedUser.online ? "在线" : "离线",
      selectedUser.username,
    ];
    if (subnet) {
      detailBits.push(subnet);
    }

    if (titleNode) titleNode.textContent = safeText(selectedUser.displayName) || selectedUser.username;
    if (subNode) subNode.textContent = detailBits.join(" · ");
  }

  const activeKey = inRoom ? roomConversationKey() : privateConversationKey(targetUsername);
  if (state.view === "chat") {
    clearUnreadCount(activeKey);
  }
  updateRoomUnreadBadge();
  renderUserDirectory(state.collab.userDirectory);
  renderActiveConversation();
}

function appendChatMessage(payload, options = {}) {
  const box = options.box || el("c_chat_box");
  if (!box) return;

  const row = document.createElement("div");
  const message = normalizeChatMessage(payload);
  const username = message.username || "系统通知";
  const displayName = message.displayName || username;
  const avatar = avatarMark(message.avatar, displayName);
  const rawFrom = safeText(message.from || message.username);
  const isSystem = Boolean(message.system);
  const isSelf = !isSystem && rawFrom && rawFrom === state.collab.username;
  row.className = `chat-item${isSelf ? " self" : ""}${isSystem ? " system" : ""}`;

  const avatarNode = document.createElement("div");
  avatarNode.className = "chat-avatar";
  avatarNode.textContent = avatar;

  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap";

  const meta = document.createElement("div");
  meta.className = "meta";
  const scope = message.scope === "private" ? "私聊消息" : "房间消息";
  const target = safeText(message.to);
  const toText = target ? ` -> ${target}` : "";
  const whoText = isSystem ? "系统通知" : (isSelf ? `我${toText}` : `${displayName}${toText}`);
  meta.textContent = `${formatTime(message.timestamp)} · ${scope} · ${whoText}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = message.text;

  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  row.appendChild(avatarNode);
  row.appendChild(wrap);
  box.appendChild(row);
  if (options.scroll !== false) {
    box.scrollTop = box.scrollHeight;
  }
}

function renderHistory(messages) {
  replaceConversationHistory(messages);
}

function closeCollabSocket() {
  if (state.collab.ws) {
    try {
      state.collab.ws.onopen = null;
      state.collab.ws.onmessage = null;
      state.collab.ws.onerror = null;
      state.collab.ws.onclose = null;
      state.collab.ws.close();
    } catch {
      // ignore
    }
  }
  state.collab.ws = null;
  state.collab.connected = false;
  setRoomScope("-");
}

function toWsUrl(httpUrl) {
  const raw = safeText(httpUrl);
  const normalized = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("服务地址需要以 http:// 或 https:// 开头");
  }
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}/ws`;
  }
  return `ws://${normalized.slice("http://".length)}/ws`;
}

async function fetchWithFriendlyError(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`连接超时：${url}`);
    }

    const message = String(err?.message || err || "");
    if (/failed to fetch/i.test(message)) {
      if (/127\.0\.0\.1|localhost/i.test(url)) {
        throw new Error(`无法连接到服务地址：${url}。如果这里填的是本机地址，请先确认本机服务已经启动；如果服务在其他电脑上，请改成那台电脑的地址和端口。`);
      }
      throw new Error(`无法连接到服务地址：${url}。请确认服务已经启动，地址和端口填写正确，并且网络可以访问。`);
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshUserDirectory() {
  if (!state.collab.serverUrl || !state.collab.token) return;
  try {
    const response = await fetchWithFriendlyError(`${state.collab.serverUrl}/api/users`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.collab.token}`,
      },
    }, 6000);

    if (!response.ok) return;
    const payload = await response.json();
    if (payload.roomScope) {
      setRoomScope(payload.roomScope);
    }
    setUserDirectory(payload.users || []);
  } catch (err) {
    logLine("collab", `刷新在线联系人失败：${err.message || err}`);
  }
}

async function collabLogout(notifyServer) {
  const serverUrl = state.collab.serverUrl;
  const token = state.collab.token;

  closeCollabSocket();

  if (notifyServer && serverUrl && token) {
    try {
      await fetchWithFriendlyError(`${serverUrl}/api/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }, 5000);
    } catch {
      // ignore
    }
  }

  state.collab.token = "";
  state.collab.username = "";
  state.collab.displayName = "";
  state.collab.avatar = "";
  state.collab.connected = false;
  resetConversationState();
  resetPresenceState();
  state.gpt.totalQueries = 0;
  state.gpt.queryUsers = {};
  state.gpt.statsTotalQueries = 0;
  state.gpt.statsUsers = {};
  state.gpt.statsEntries = [];
  state.gpt.statsUserCount = 0;
  if (el("c_chat_scope")) el("c_chat_scope").value = "subnet";
  if (el("c_chat_target")) el("c_chat_target").value = "";
  if (el("c_password")) {
    el("c_password").value = state.collab.rememberPassword ? state.collab.savedPassword : "";
  }
  setCollabState("未登录");
  setCollabFeedback("");
  setPanelFeedback("chat_feedback", "");
  setGptFeedback("");
  setGptStatsFeedback("");
  setCollabIdentity("-");
  setUserDirectory([], { silent: true });
  updateRoomUnreadBadge();
  renderActiveConversation();
  updateGptCounters();
  setCollabControls();
  hideContextMenu();
}

function connectCollabWebSocket() {
  const wsUrl = `${toWsUrl(state.collab.serverUrl)}?token=${encodeURIComponent(state.collab.token)}`;
  const ws = new WebSocket(wsUrl);
  state.collab.ws = ws;
  setCollabState("连接中");

  ws.onopen = () => {
    state.collab.connected = true;
    setCollabState("在线");
    setCollabControls();
    refreshTopIdentity();
    refreshUserDirectory();
    logLine("collab", "账号连接已建立");
  };

  ws.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(String(event.data || "{}"));
    } catch {
      return;
    }

    if (payload.type === "presence") {
      if (payload.roomScope) {
        setRoomScope(payload.roomScope);
      }
      refreshUserDirectory();
      return;
    }

    if (payload.type === "history") {
      renderHistory(payload.messages || []);
      if (payload.roomScope) {
        setRoomScope(payload.roomScope);
      }
      return;
    }

    if (payload.type === "session") {
      const me = safeText(payload.username);
      if (me) {
        state.collab.username = me;
      }
      const displayName = safeText(payload.displayName);
      state.collab.displayName = displayName || state.collab.username;
      state.collab.avatar = safeText(payload.avatar) || state.collab.avatar;
      if (payload.roomScope) {
        setRoomScope(payload.roomScope);
      }
      setCollabIdentity(state.collab.displayName || state.collab.username);
      refreshTopIdentity();
      return;
    }

    if (payload.type === "chat") {
      handleIncomingConversationMessage(payload);
      return;
    }

    if (payload.type === "system") {
      handleIncomingConversationMessage(buildSystemMessage(payload.text, {
        timestamp: payload.timestamp,
        scope: payload.scope || "subnet",
        subnetKey: payload.subnetKey,
        subnetLabel: payload.subnetLabel,
        roomScope: payload.roomScope || state.collab.roomScope,
      }));
      return;
    }

    if (payload.type === "error") {
      handleIncomingConversationMessage(buildSystemMessage(payload.text, {
        timestamp: payload.timestamp,
        scope: currentChatScope() === "private" ? "private" : "subnet",
        to: safeText(el("c_chat_target")?.value),
        roomScope: state.collab.roomScope,
      }));
    }
  };

  ws.onerror = () => {
    logLine("collab", "账号连接异常");
  };

  ws.onclose = () => {
    state.collab.connected = false;
    if (state.collab.token) {
      setCollabState("连接断开");
    } else {
      setCollabState("未登录");
    }
    setCollabControls();
    refreshTopIdentity();
    logLine("collab", "账号连接已关闭");
  };
}

async function collabLogin() {
  const serverUrl = safeText(el("c_server_url")?.value).replace(/\/+$/, "");
  const username = safeText(el("c_username")?.value);
  const password = String(el("c_password")?.value || "");
  const rememberPassword = Boolean(el("c_remember_password")?.checked);

  if (!serverUrl || !username || !password) {
    throw new Error("请先填写完整的服务地址、账号和密码");
  }

  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error("服务地址需要以 http:// 或 https:// 开头");
  }

  setCollabState("登录中");

  const response = await fetchWithFriendlyError(`${serverUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }, 10000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `登录失败（${response.status}）`);
  }

  const payload = await response.json();
  if (!payload?.token) {
    throw new Error("登录未成功，请稍后重试");
  }

  state.collab.serverUrl = serverUrl;
  state.collab.username = username;
  state.collab.token = payload.token;
  state.collab.avatar = safeText(payload?.profile?.avatar) || state.collab.avatar;
  state.collab.displayName = safeText(payload?.profile?.displayName) || username;
  state.collab.rememberPassword = rememberPassword;
  state.collab.savedPassword = rememberPassword ? password : "";
  setRoomScope(payload?.roomScope);

  setCollabIdentity(state.collab.displayName || username);
  refreshTopIdentity();

  await saveSettings({ silent: true });
  renderHistory(payload.history || []);
  resetPresenceState();
  setUserDirectory(payload.users || payload.onlineUsers || [], { silent: true });
  if (el("c_password")) {
    el("c_password").value = state.collab.rememberPassword ? state.collab.savedPassword : "";
  }
  syncGptStatsFilterInputs();
  const gptStatsTasks = await Promise.allSettled([
    loadGptSummaryStats(),
    loadGptRangeStats({ silent: true }),
  ]);
  gptStatsTasks
    .filter((item) => item.status === "rejected")
    .forEach((item) => {
      logLine("app", `加载 GPT 统计失败：${item.reason?.message || item.reason || "未知错误"}`);
    });
  setCollabFeedback("登录成功。", "success");
  state.view = "sender";
  setCollabControls();
  connectCollabWebSocket();
}

async function submitCollabLogin() {
  try {
    await collabLogin();
    logLine("collab", "登录成功");
  } catch (err) {
    const message = err.message || String(err);
    setCollabState("登录失败");
    setCollabControls();
    setCollabFeedback(message, "error");
    logLine("collab", `登录失败：${message}`);
    focusCollabField("c_password", true);
  }
}

async function persistCollabPreferences() {
  await saveSettings({ silent: true });
}

function sendChatMessage() {
  if (!state.collab.connected || !state.collab.ws || state.collab.ws.readyState !== WebSocket.OPEN) {
    setPanelFeedback("chat_feedback", "消息服务尚未连接，请稍后再试。", "error");
    return;
  }

  const input = el("c_chat_input");
  const text = safeText(input?.value);
  if (!text) return;

  const scope = currentChatScope();
  const target = safeText(el("c_chat_target")?.value);
  if (scope === "private" && !target) {
    setPanelFeedback("chat_feedback", "请先从左侧联系人列表中选择一个联系人。", "error");
    return;
  }

  state.collab.ws.send(
    JSON.stringify({
      type: "chat",
      scope,
      to: scope === "private" ? target : "",
      text,
    }),
  );

  if (input) input.value = "";
  setPanelFeedback("chat_feedback", "");
}

async function openProfileEditor() {
  if (!state.collab.token) {
    setCollabFeedback("请先登录账号，再打开个人资料。", "error");
    return;
  }

  await window.api.openProfileEditor({
    serverUrl: state.collab.serverUrl,
    token: state.collab.token,
    username: state.collab.username,
  });
}

async function handleProfileUpdated(payload) {
  const profile = payload?.profile || {};
  const username = safeText(profile.username) || state.collab.username;
  if (username && username === state.collab.username) {
    state.collab.displayName = safeText(profile.displayName) || username;
    state.collab.avatar = safeText(profile.avatar) || state.collab.avatar;
    setCollabIdentity(state.collab.displayName);
    refreshTopIdentity();
    await saveSettings({ silent: true });
  }
  await refreshUserDirectory();
}

async function main() {
  window.api.onLog(({ source, line }) => {
    if (!line) return;
    String(line)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        logLine(source, item);
        appendToReceiverSplit(source, item);
      });
  });

  window.api.onStatus((status) => setStatus(status));
  window.api.onProfileUpdated((payload) => {
    handleProfileUpdated(payload).catch((err) => {
      logLine("collab", `个人资料刷新失败：${err.message || err}`);
    });
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.getAttribute("data-view-target") || "");
    });
  });

  if (el("s_fallback_mode")) {
    el("s_fallback_mode").addEventListener("change", refreshFallbackVisibility);
  }

  if (el("senderPanel")) {
    el("senderPanel").querySelectorAll("input, select, textarea").forEach((node) => {
      node.addEventListener("input", () => {
        clearServiceFeedback("sender");
        renderSetupGuide();
        if (node.id === "s_socks_listen_port") {
          updateGptProxyInfo();
          updateGptRuntimeState();
          updateGeminiProxyInfo();
          updateGeminiRuntimeState();
        }
      });
      node.addEventListener("change", () => {
        clearServiceFeedback("sender");
        renderSetupGuide();
        if (node.id === "s_socks_listen_port") {
          updateGptProxyInfo();
          updateGptRuntimeState();
          updateGeminiProxyInfo();
          updateGeminiRuntimeState();
        }
      });
    });
  }

  if (el("receiverPanel")) {
    el("receiverPanel").querySelectorAll("input, select, textarea").forEach((node) => {
      node.addEventListener("input", () => {
        clearServiceFeedback("receiver");
        syncReceiverOverview();
      });
      node.addEventListener("change", () => {
        clearServiceFeedback("receiver");
        syncReceiverOverview();
      });
    });
  }

  if (el("btnSaveSender")) {
    el("btnSaveSender").addEventListener("click", async () => {
      if (!isCollabOnline()) {
        setPanelFeedback("s_feedback", "请先登录账号，并保持在线后再保存连接设置。", "error");
        return;
      }
      await saveSettings();
      setPanelFeedback("s_feedback", "连接设置已保存。", "success");
    });
  }

  if (el("btnSaveReceiver")) {
    el("btnSaveReceiver").addEventListener("click", async () => {
      await saveSettings();
      setPanelFeedback("r_feedback", "接收端设置已保存。", "success");
    });
  }

  if (el("btnStartSender")) {
    el("btnStartSender").addEventListener("click", async () => {
      try {
        if (!isCollabOnline()) {
          throw new Error("请先登录账号，再开启发送服务");
        }
        await saveSettings();
        await window.api.startSender(getSenderForm());
        logLine("sender", "发送服务已开启。");
        setPanelFeedback("s_feedback", "发送服务已开启。", "success");
      } catch (err) {
        logLine("sender", `开启失败：${err.message || err}`);
        setPanelFeedback("s_feedback", err.message || String(err), "error");
      }
    });
  }

  if (el("btnStopSender")) {
    el("btnStopSender").addEventListener("click", async () => {
      await window.api.stopSender();
      logLine("sender", "已发送停止指令");
      setPanelFeedback("s_feedback", "已发送停止指令，请稍候查看状态是否更新。", "success");
    });
  }

  if (el("btnStartReceiver")) {
    el("btnStartReceiver").addEventListener("click", async () => {
      try {
        await saveSettings();
        await window.api.startReceiver(getReceiverForm());
        logLine("receiver", "接收服务已开启。");
        setPanelFeedback("r_feedback", "接收服务已开启。", "success");
      } catch (err) {
        logLine("receiver", `开启失败：${err.message || err}`);
        setPanelFeedback("r_feedback", err.message || String(err), "error");
      }
    });
  }

  if (el("btnStopReceiver")) {
    el("btnStopReceiver").addEventListener("click", async () => {
      await window.api.stopReceiver();
      logLine("receiver", "已发送停止指令");
      setPanelFeedback("r_feedback", "已发送停止指令，请稍候查看状态是否更新。", "success");
    });
  }

  if (el("btnClearLog")) {
    el("btnClearLog").addEventListener("click", () => {
      if (el("logBox")) el("logBox").textContent = "";
      if (el("receiverSingboxLog")) el("receiverSingboxLog").textContent = "";
      if (el("receiverFrpcLog")) el("receiverFrpcLog").textContent = "";
    });
  }

  if (el("btnCollabLogin")) {
    el("btnCollabLogin").addEventListener("click", async () => {
      await submitCollabLogin();
    });
  }

  if (el("btnSetupGuideDismiss")) {
    el("btnSetupGuideDismiss").addEventListener("click", () => {
      dismissSetupGuide().catch((err) => {
        logLine("app", `保存首次引导状态失败：${err.message || err}`);
      });
    });
  }

  if (el("btnSetupGuideAction")) {
    el("btnSetupGuideAction").addEventListener("click", () => {
      dismissSetupGuide()
        .then(() => {
          handleSetupGuideAction();
        })
        .catch((err) => {
          logLine("app", `保存首次引导状态失败：${err.message || err}`);
          handleSetupGuideAction();
        });
    });
  }

  const handleImportConfig = async () => {
    try {
      const newSettings = await window.api.importSettings();
      if (newSettings) {
        logLine("app", "成功导入配置并更新表单");
        state.settings = newSettings;
        fillForm(newSettings);
        if (el("setupGuide")) {
          renderSetupGuide();
        }
      }
    } catch (err) {
      alert(err.message || "导入失败");
    }
  };

  if (el("btnSetupGuideImport")) el("btnSetupGuideImport").addEventListener("click", handleImportConfig);
  if (el("btnCollabImport")) el("btnCollabImport").addEventListener("click", handleImportConfig);
  if (el("btnImportSender")) el("btnImportSender").addEventListener("click", handleImportConfig);

  ["c_server_url", "c_username", "c_password"].forEach((id) => {
    const input = el(id);
    if (!input) return;
    input.addEventListener("input", () => {
      if (!state.collab.token && !state.collab.connected && !safeText(el("c_server_url")?.value)) {
        setCollabState("请填写服务地址");
      }
      if (!state.collab.token) {
        setCollabFeedback("");
      }
      setCollabControls();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !state.collab.token) {
        event.preventDefault();
        submitCollabLogin().catch((err) => {
          logLine("collab", `登录处理失败：${err.message || err}`);
        });
      }
    });
  });

  if (el("c_remember_password")) {
    el("c_remember_password").addEventListener("change", () => {
      state.collab.rememberPassword = Boolean(el("c_remember_password")?.checked);
      if (!state.collab.rememberPassword) {
        state.collab.savedPassword = "";
      }
      persistCollabPreferences().catch((err) => {
        logLine("collab", `保存登录选项失败：${err.message || err}`);
      });
    });
  }

  if (el("c_notify_message_popup")) {
    el("c_notify_message_popup").addEventListener("change", () => {
      state.collab.notifyMessagePopup = Boolean(el("c_notify_message_popup")?.checked);
      persistCollabPreferences().catch((err) => {
        logLine("collab", `保存消息提醒设置失败：${err.message || err}`);
      });
    });
  }

  if (el("c_notify_user_online")) {
    el("c_notify_user_online").addEventListener("change", () => {
      state.collab.notifyUserOnline = Boolean(el("c_notify_user_online")?.checked);
      persistCollabPreferences().catch((err) => {
        logLine("collab", `保存上线提醒设置失败：${err.message || err}`);
      });
    });
  }

  if (el("topCollabIdentity")) {
    el("topCollabIdentity").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        {
          label: "编辑个人资料",
          disabled: !state.collab.token,
          onClick: () => openProfileEditor(),
        },
        {
          label: "退出登录",
          disabled: !state.collab.token,
          onClick: async () => {
            await collabLogout(true);
            logLine("collab", "已退出登录");
          },
        },
      ]);
    });
  }

  if (el("btnCollabLogout")) {
    el("btnCollabLogout").addEventListener("click", async () => {
      await collabLogout(true);
      logLine("collab", "已退出登录");
    });
  }

  if (el("btnAccountProfile")) {
    el("btnAccountProfile").addEventListener("click", () => {
      openProfileEditor().catch((err) => {
        setCollabFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnAccountLogout")) {
    el("btnAccountLogout").addEventListener("click", async () => {
      await collabLogout(true);
      logLine("collab", "已退出登录");
    });
  }

  document.addEventListener("click", () => {
    if (state.contextMenuOpen) hideContextMenu();
  });

  document.addEventListener("contextmenu", (event) => {
    if (!state.contextMenuOpen) return;
    const target = event.target;
    const insideMenu = target instanceof Element && Boolean(target.closest("#appContextMenu"));
    const fromUserItem = target instanceof Element && Boolean(target.closest("#c_online_list li"));
    const fromTopIdentity = target instanceof Element && Boolean(target.closest("#topCollabIdentity"));
    if (!insideMenu && !fromUserItem && !fromTopIdentity) {
      hideContextMenu();
    }
  });

  document.addEventListener("scroll", () => {
    if (state.contextMenuOpen) hideContextMenu();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.contextMenuOpen) {
      hideContextMenu();
    }
  });

  window.addEventListener("blur", () => {
    state.windowFocused = false;
    if (state.contextMenuOpen) hideContextMenu();
  });

  window.addEventListener("focus", () => {
    state.windowFocused = true;
    if (state.collab.token && state.view === "chat") {
      syncChatConversation();
    }
  });

  window.addEventListener("resize", () => {
    if (state.contextMenuOpen) hideContextMenu();
    scheduleAiHostsLayoutSync();
  });
  document.addEventListener("fullscreenchange", () => {
    syncGptFullscreenState();
    syncGeminiFullscreenState();
    scheduleAiHostsLayoutSync();
  });

  if (el("c_chat_scope")) {
    el("c_chat_scope").addEventListener("change", () => {
      refreshPrivateTargets();
      setPanelFeedback("chat_feedback", "");
    });
  }

  if (el("c_room_channel")) {
    el("c_room_channel").addEventListener("click", () => {
      pickRoomConversation();
    });
  }

  if (el("btnOpenMessageSettings")) {
    el("btnOpenMessageSettings").addEventListener("click", () => {
      setActiveView("message-settings");
    });
  }

  if (el("btnBackToChat")) {
    el("btnBackToChat").addEventListener("click", () => {
      setActiveView("chat");
    });
  }

  if (el("btnGptOpenExternal")) {
    el("btnGptOpenExternal").addEventListener("click", () => {
      const url = normalizeGptUrl(state.gpt.lastUrl);
      openGptExternal(url).catch((err) => {
        setGptFeedback(`默认浏览器打开失败：${err.message || err}`, "error");
      });
    });
  }

  if (el("btnGeminiOpenExternal")) {
    el("btnGeminiOpenExternal").addEventListener("click", () => {
      const url = normalizeGeminiUrl(state.gemini.lastUrl);
      openGeminiExternal(url).catch((err) => {
        setGeminiFeedback(`默认浏览器打开失败：${err.message || err}`, "error");
      });
    });
  }

  if (el("btnGptBack")) {
    el("btnGptBack").addEventListener("click", () => {
      if (!state.gpt.canGoBack) return;
      window.api.navigateAiWorkspace({ kind: "gpt", action: "back" }).catch((err) => {
        setGptFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGeminiBack")) {
    el("btnGeminiBack").addEventListener("click", () => {
      if (!state.gemini.canGoBack) return;
      window.api.navigateAiWorkspace({ kind: "gemini", action: "back" }).catch((err) => {
        setGeminiFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGptForward")) {
    el("btnGptForward").addEventListener("click", () => {
      if (!state.gpt.canGoForward) return;
      window.api.navigateAiWorkspace({ kind: "gpt", action: "forward" }).catch((err) => {
        setGptFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGeminiForward")) {
    el("btnGeminiForward").addEventListener("click", () => {
      if (!state.gemini.canGoForward) return;
      window.api.navigateAiWorkspace({ kind: "gemini", action: "forward" }).catch((err) => {
        setGeminiFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGptReload")) {
    el("btnGptReload").addEventListener("click", () => {
      ensureGptWorkspace({ forceReload: true }).catch((err) => {
        setGptFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGeminiReload")) {
    el("btnGeminiReload").addEventListener("click", () => {
      ensureGeminiWorkspace({ forceReload: true }).catch((err) => {
        setGeminiFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnGptGoStats")) {
    el("btnGptGoStats").addEventListener("click", () => {
      setActiveView("gpt-stats");
    });
  }

  if (el("btnGptToggleFullscreen")) {
    el("btnGptToggleFullscreen").addEventListener("click", async () => {
      const shell = el("gptBrowserShell");
      if (!shell) return;

      try {
        if (document.fullscreenElement === shell) {
          await document.exitFullscreen();
        } else {
          await shell.requestFullscreen();
        }
      } catch (err) {
        setGptFeedback(`切换全屏失败：${err.message || err}`, "error");
      } finally {
        syncGptFullscreenState();
      }
    });
  }

  if (el("btnGeminiToggleFullscreen")) {
    el("btnGeminiToggleFullscreen").addEventListener("click", async () => {
      const shell = el("geminiBrowserShell");
      if (!shell) return;

      try {
        if (document.fullscreenElement === shell) {
          await document.exitFullscreen();
        } else {
          await shell.requestFullscreen();
        }
      } catch (err) {
        setGeminiFeedback(`切换全屏失败：${err.message || err}`, "error");
      } finally {
        syncGeminiFullscreenState();
      }
    });
  }

  if (el("btnBackToGpt")) {
    el("btnBackToGpt").addEventListener("click", () => {
      setActiveView("gpt");
    });
  }

  if (el("gptStatsPreset")) {
    el("gptStatsPreset").addEventListener("change", () => {
      readGptStatsRangeFromInputs();
      setGptStatsFeedback("");
      persistGptState().catch((err) => {
        logLine("app", `保存 GPT 统计筛选失败：${err.message || err}`);
      });
      if (state.gpt.statsPreset !== "custom") {
        loadGptRangeStats({ silent: false }).catch((err) => {
          setGptStatsFeedback(err.message || String(err), "error");
        });
      }
    });
  }

  ["gptStatsFrom", "gptStatsTo"].forEach((id) => {
    const input = el(id);
    if (!input) return;
    input.addEventListener("input", () => {
      if (el("gptStatsPreset")) {
        el("gptStatsPreset").value = "custom";
      }
      state.gpt.statsPreset = "custom";
      state.gpt.statsFrom = safeText(el("gptStatsFrom")?.value);
      state.gpt.statsTo = safeText(el("gptStatsTo")?.value);
      renderGptStats();
      setGptStatsFeedback("");
    });
  });

  if (el("btnGptApplyRange")) {
    el("btnGptApplyRange").addEventListener("click", () => {
      readGptStatsRangeFromInputs();
      loadGptRangeStats({ silent: false }).catch((err) => {
        setGptStatsFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnChatSend")) {
    el("btnChatSend").addEventListener("click", sendChatMessage);
  }

  if (el("c_chat_input")) {
    el("c_chat_input").addEventListener("input", () => {
      setPanelFeedback("chat_feedback", "");
    });
    el("c_chat_input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendChatMessage();
      }
    });
  }

  if (el("btnWinMin")) {
    el("btnWinMin").addEventListener("click", () => {
      window.api.minimizeWindow();
    });
  }

  if (el("btnWinMax")) {
    el("btnWinMax").addEventListener("click", async () => {
      await window.api.toggleMaximizeWindow();
      await syncWindowMaxButton();
    });
  }

  if (el("btnWinClose")) {
    el("btnWinClose").addEventListener("click", () => {
      window.api.closeWindow();
    });
  }

  const mode = await window.api.getMode();
  applyModeLayout(mode || "sender");
  await syncWindowMaxButton();
  bindAiWorkspaceEvents();
  initAiHostObservers();

  const settings = await window.api.loadSettings();
  state.settings = settings;
  fillForm(settings);

  const deviceInfo = await window.api.getDeviceInfo();
  applyDeviceInfo(deviceInfo);
  await applySuggestedServerUrl();

  state.collab.serverUrl = safeText(el("c_server_url")?.value).replace(/\/+$/, "");
  state.collab.username = safeText(el("c_username")?.value);
  resetConversationState();
  resetPresenceState();
  setCollabState(state.collab.serverUrl ? "未登录" : "请填写服务地址");
  setRoomScope("-");
  setCollabIdentity("-");
  refreshTopIdentity();
  setUserDirectory([], { silent: true });
  setCollabControls();

  await window.api.getPaths();
  logLine("app", "程序已启动");

  const status = await window.api.getStatus();
  setStatus(status);
  scheduleAiHostsLayoutSync();
}

main().catch((err) => {
  logLine("app", `程序启动失败：${err.message || err}`);
});


