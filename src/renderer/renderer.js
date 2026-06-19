const state = {
  settings: null,
  status: null,
  mode: "sender",
  view: "sender",
  deviceInfo: null,
  contextMenuOpen: false,
  windowFocused: typeof document !== "undefined" ? document.hasFocus() : true,
  app: {
    name: "ShareGPT",
    version: "",
    platform: "",
    arch: "",
    updateInfo: null,
    downloading: false,
    downloadedFilePath: "",
    updateProgress: null,
  },
  ui: {
    setupGuideDismissed: false,
    theme: "dark",
    aiEventsBound: false,
    chatImageZoom: 1,
    chatImagePanX: 0,
    chatImagePanY: 0,
    chatImageDragging: false,
    chatImagePointerId: null,
    chatImageDragStartX: 0,
    chatImageDragStartY: 0,
    chatImageDragOriginX: 0,
    chatImageDragOriginY: 0,
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
    runtimePassword: "",
    notifyMessagePopup: true,
    notifySystemNotification: true,
    notifySoundPlay: true,
    notifyUserOnline: false,
    messagesByConversation: new Map(),
    unreadByConversation: new Map(),
    typingByConversation: new Map(),
    knownOnlineUsers: new Set(),
    presenceReady: false,
    conversationFilter: "",
    chatSidebarTab: "recent",
    replyDraft: null,
    editDraft: null,
    forwardDraft: null,
    pendingAttachment: null,
    pendingInlineImage: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    reconnectStrategy: "socket",
    silentReloginInFlight: false,
    intentionalSocketClose: false,
    lastHistorySyncAt: "",
    lastTypingSentAt: new Map(),
  },
  gpt: {
    partition: "persist:gpt-chat",
    homeUrl: "https://chatgpt.com/auth/login",
    lastUrl: "https://chatgpt.com/auth/login",
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
    tabs: [],
    activeTabId: "",
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
const DEFAULT_TARGET_DOMAINS = [...new Set([...GPT_ALLOWED_HOSTS, ...GEMINI_ALLOWED_HOSTS])].join(
  ",",
);
const GPT_QUERY_MARKER = "__GPT_QUERY__";
const GPT_PROXY_HOST = "127.0.0.1";
const GPT_PROXY_PORT = "1080";
const CHAT_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;
const CHAT_IMAGE_ZOOM_MIN = 0.4;
const CHAT_IMAGE_ZOOM_MAX = 4;
const CHAT_IMAGE_ZOOM_STEP = 0.12;

function normalizeTheme(value) {
  return safeText(value).toLowerCase() === "light" ? "light" : "dark";
}

function syncThemeControls() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = safeText(button.dataset.themeChoice) === state.ui.theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function syncThemeQuickToggle() {
  const button = el("btnThemeQuickToggle");
  if (!button) return;
  const nextTheme = state.ui.theme === "light" ? "dark" : "light";
  button.dataset.nextTheme = nextTheme;
  button.textContent = nextTheme === "light" ? "切到日间" : "切到夜间";
  button.title = nextTheme === "light" ? "切换到日间模式" : "切换到夜间模式";
  button.setAttribute("aria-label", button.title);
}

function applyTheme(theme, options = {}) {
  const nextTheme = normalizeTheme(theme);
  state.ui.theme = nextTheme;
  if (document.body) {
    document.body.dataset.theme = nextTheme;
  }
  syncThemeQuickToggle();
  if (options.syncControls !== false) {
    syncThemeControls();
  }
}

function saveThemePreference(theme) {
  applyTheme(theme, { syncControls: true });
  return saveSettings({ silent: true }).catch((err) => {
    logLine("app", `保存主题设置失败：${err.message || err}`);
  });
}

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
let contextMenuAnchorNode = null;
const typingExpiryTimers = new Map();
let chatDropDragDepth = 0;

function safeText(value) {
  return String(value || "").trim();
}

function clampCount(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatBytes(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function compareVersions(left, right) {
  const leftParts = String(left || "")
    .split(".")
    .map((item) => Number.parseInt(item, 10) || 0);
  const rightParts = String(right || "")
    .split(".")
    .map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] || 0;
    const b = rightParts[index] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function currentUpdatePlatformKey() {
  if (window.api?.platform === "darwin") return "macos";
  return "windows";
}

function getClientVersionPayload() {
  return {
    name: safeText(state.app.name) || "ShareGPT",
    version: safeText(state.app.version),
    platform: safeText(state.app.platform || window.api?.platform),
    arch: safeText(state.app.arch),
    mode: safeText(state.mode),
    reportedAt: new Date().toISOString(),
  };
}

function normalizeMessageAttachments(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const dataUrl = safeText(item?.dataUrl);
      if (!dataUrl) return null;
      return {
        kind: safeText(item?.kind) === "image" ? "image" : "file",
        name: safeText(item?.name).slice(0, 200) || "file",
        mime: safeText(item?.mime).slice(0, 200),
        size: clampCount(item?.size, 0),
        dataUrl,
      };
    })
    .filter(Boolean);
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

function normalizeReadBy(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const username = safeText(item?.username || item?.from);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    normalized.push({
      username,
      displayName: safeText(item?.displayName || item?.username || item?.from) || username,
      readAt: safeText(item?.readAt || item?.timestamp) || new Date().toISOString(),
    });
  }
  return normalized.sort((a, b) => a.readAt.localeCompare(b.readAt));
}

function normalizeForwardedFrom(record) {
  const from = safeText(record?.from || record?.username);
  if (!from) return null;

  return {
    from,
    displayName: safeText(record?.displayName || record?.username || record?.from) || "转发消息",
  };
}

function hasMessageContent(message) {
  return Boolean(
    message?.recalled ||
    safeText(message?.text) ||
    normalizeMessageAttachments(message?.attachments).length,
  );
}

function messageFingerprint(message) {
  const normalized = normalizeChatMessage(message);
  return JSON.stringify({
    scope: normalized.scope,
    from: normalized.from,
    to: normalized.to,
    timestamp: normalized.timestamp,
    text: normalized.text,
    edited: normalized.edited,
    editedAt: normalized.editedAt,
    recalled: normalized.recalled,
    recalledAt: normalized.recalledAt,
    replyTo: normalized.replyTo ? normalized.replyTo.id : "",
    forwardedFrom: normalized.forwardedFrom ? normalized.forwardedFrom.from : "",
    attachments: normalized.attachments.map((item) => ({
      kind: item.kind,
      name: item.name,
      size: item.size,
      mime: item.mime,
    })),
  });
}

function serializeConversationStore() {
  const conversations = {};
  for (const [key, items] of state.collab.messagesByConversation.entries()) {
    if (!items?.length) continue;
    conversations[key] = items.map((item) => ({
      ...normalizeChatMessage(item),
      attachments: normalizeMessageAttachments(item.attachments),
      replyTo: normalizeReplyTarget(item.replyTo),
      forwardedFrom: normalizeForwardedFrom(item.forwardedFrom),
      readBy: normalizeReadBy(item.readBy),
    }));
  }
  return {
    version: 1,
    conversations,
  };
}

function hydrateConversationStore(payload, options = {}) {
  if (options.reset) {
    resetConversationState();
  }

  const conversations = payload && typeof payload === "object" ? payload.conversations : null;
  if (!conversations || typeof conversations !== "object") {
    renderActiveConversation();
    return;
  }

  for (const [conversationKey, rawItems] of Object.entries(conversations)) {
    const key = safeText(conversationKey);
    if (!key || !Array.isArray(rawItems)) continue;
    const items = rawItems.map((item) => normalizeChatMessage(item)).filter(hasMessageContent);
    if (!items.length) continue;
    state.collab.messagesByConversation.set(key, items.slice(-300));
  }

  renderActiveConversation();
  renderRecentConversations();
  updateRoomUnreadBadge();
}

let chatHistoryPersistTimer = null;

function scheduleChatHistoryPersist() {
  if (chatHistoryPersistTimer) {
    window.clearTimeout(chatHistoryPersistTimer);
  }

  chatHistoryPersistTimer = window.setTimeout(async () => {
    chatHistoryPersistTimer = null;
    try {
      await window.api.saveChatHistory(serializeConversationStore());
    } catch (err) {
      logLine("collab", `保存本地聊天记录失败：${err.message || err}`);
    }
  }, 240);
}

function messagePreviewText(message) {
  const normalized = normalizeChatMessage(message);
  if (normalized.recalled) return "[已撤回]";
  if (normalized.forwardedFrom && !safeText(normalized.text) && !normalized.attachments.length)
    return "[转发消息]";
  if (safeText(normalized.text)) return normalized.text;
  if (normalized.attachments.some((item) => item.kind === "image")) return "[图片]";
  if (normalized.attachments.length) return `[文件] ${normalized.attachments[0].name}`;
  return "新消息";
}

function createReplyDraftFromMessage(message) {
  const normalized = normalizeChatMessage(message);
  if (!normalized.id) return null;
  return normalizeReplyTarget({
    id: normalized.id,
    from: normalized.from || normalized.username,
    displayName: normalized.displayName || normalized.username,
    preview: messagePreviewText(normalized),
    timestamp: normalized.timestamp,
  });
}

function recentPreviewText(message, conversationUsername = "") {
  const normalized = normalizeChatMessage(message);
  const preview = messagePreviewText(normalized);
  if (!preview) return "还没有消息，点击后开始聊天";
  if (normalized.system) return preview;

  const currentUser = safeText(state.collab.username);
  const from = safeText(normalized.from || normalized.username);
  if (from && from === currentUser) {
    return `你: ${preview}`;
  }

  const otherUser = safeText(conversationUsername);
  if (otherUser && from && from === otherUser) {
    return preview;
  }

  const senderName = safeText(normalized.displayName || normalized.username || from);
  return senderName ? `${senderName}: ${preview}` : preview;
}

function recentMessageState(message, conversationUsername = "") {
  const normalized = normalizeChatMessage(message);
  if (normalized.system || normalized.scope !== "private") return null;

  const from = safeText(normalized.from || normalized.username);
  if (!from || from !== state.collab.username) return null;

  const to = safeText(normalized.to);
  if (conversationUsername && to && to !== safeText(conversationUsername)) return null;

  return {
    kind: safeText(normalized.readAt) ? "read" : "sent",
    label: safeText(normalized.readAt) ? "\u2713\u2713" : "\u2713",
    title: safeText(normalized.readAt) ? "已读" : "已送达",
  };
}

function clearTypingExpiryTimer(conversationKey) {
  const key = safeText(conversationKey);
  if (!key) return;
  const timer = typingExpiryTimers.get(key);
  if (!timer) return;
  window.clearTimeout(timer);
  typingExpiryTimers.delete(key);
}

function clearConversationTyping(conversationKey, options = {}) {
  const key = safeText(conversationKey);
  if (!key) return;
  clearTypingExpiryTimer(key);
  if (!state.collab.typingByConversation.has(key)) return;
  state.collab.typingByConversation.delete(key);
  if (options.render !== false) {
    renderRecentConversations();
    if (currentConversationKey() === key) {
      syncChatConversation();
    }
  }
}

function clearAllConversationTyping(options = {}) {
  for (const key of typingExpiryTimers.keys()) {
    clearTypingExpiryTimer(key);
  }
  if (!state.collab.typingByConversation.size) return;
  state.collab.typingByConversation.clear();
  if (options.render !== false) {
    renderRecentConversations();
    syncChatConversation();
  }
}

function typingConversationKey(scope, username = "") {
  return scope === "private" ? privateConversationKey(username) : roomConversationKey();
}

function getConversationTypingMeta(conversationKey) {
  const key = safeText(conversationKey);
  return key ? state.collab.typingByConversation.get(key) || null : null;
}

function setConversationTyping(conversationKey, payload = {}) {
  const key = safeText(conversationKey);
  if (!key) return;

  state.collab.typingByConversation.set(key, {
    from: safeText(payload.from),
    displayName: safeText(payload.displayName || payload.from) || "对方",
    scope: payload.scope === "private" ? "private" : "subnet",
    updatedAt: Date.now(),
  });

  clearTypingExpiryTimer(key);
  typingExpiryTimers.set(
    key,
    window.setTimeout(() => {
      clearConversationTyping(key);
    }, 3200),
  );

  renderRecentConversations();
  if (currentConversationKey() === key) {
    syncChatConversation();
  }
}

function conversationTypingSummary(scope, targetUsername = "") {
  const key = typingConversationKey(scope, targetUsername);
  const typing = getConversationTypingMeta(key);
  if (!typing) return "";

  if (scope === "private") {
    return `${typing.displayName || typing.from || "对方"} 正在输入…`;
  }

  const roomKey = roomConversationKey();
  const roomTypers = [...state.collab.typingByConversation.entries()].filter(
    ([entryKey, meta]) => entryKey === roomKey && meta?.scope === "subnet",
  );

  if (!roomTypers.length) return "";
  if (roomTypers.length === 1) {
    const meta = roomTypers[0][1];
    return `${meta.displayName || meta.from || "联系人"} 正在输入…`;
  }
  return `${roomTypers.length} 位联系人正在输入…`;
}
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<]+/i);
  return match ? match[0] : "";
}

function renderMessageRichText(text) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-bubble-rich";

  const source = String(text || "");
  if (!source.trim()) {
    return wrapper;
  }

  const codeBlocks = [];
  let html = escapeHtml(source).replace(/```([\s\S]*?)```/g, (_all, code) => {
    const token = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre class="chat-code-block"><code>${String(code || "").trim()}</code></pre>`);
    return token;
  });

  html = html.replace(/`([^`\n]+)`/g, '<code class="chat-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<em>$1</em>");
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a class="chat-inline-link" href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
  html = html.replace(/\n/g, "<br>");

  codeBlocks.forEach((block, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, block);
  });

  wrapper.innerHTML = html;
  return wrapper;
}

function buildMessageLinkPreview(rawUrl) {
  const url = safeText(rawUrl);
  if (!/^https?:\/\//i.test(url)) return null;

  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "");
  } catch {}

  const card = document.createElement("button");
  card.type = "button";
  card.className = "chat-link-preview";

  const title = document.createElement("strong");
  title.textContent = host || "链接";
  const sub = document.createElement("span");
  sub.textContent = url;

  card.appendChild(title);
  card.appendChild(sub);
  card.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await window.api.openExternal(url);
    } catch (err) {
      setPanelFeedback("chat_feedback", `打开链接失败：${err.message || err}`, "error");
    }
  });

  return card;
}

function currentChatSidebarTab() {
  return state.collab.chatSidebarTab === "contacts" ? "contacts" : "recent";
}

function updateChatFilterPlaceholder() {
  const filter = el("c_chat_filter");
  if (!filter) return;
  filter.placeholder = currentChatSidebarTab() === "contacts" ? "搜索联系人" : "搜索最近会话";
}

function setChatSidebarTab(tab) {
  const next = tab === "contacts" ? "contacts" : "recent";
  state.collab.chatSidebarTab = next;

  document.querySelectorAll("[data-chat-sidebar-tab]").forEach((node) => {
    const active = node instanceof HTMLElement && node.dataset.chatSidebarTab === next;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll("[data-chat-sidebar-panel]").forEach((node) => {
    const active = node instanceof HTMLElement && node.dataset.chatSidebarPanel === next;
    node.classList.toggle("active", active);
    if (node instanceof HTMLElement) {
      node.hidden = !active;
    }
  });

  updateChatFilterPlaceholder();
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    throw new Error("没有可复制的文本");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("当前环境不支持复制到剪贴板");
  }
  return true;
}

function dataUrlToDownloadHref(dataUrl) {
  return safeText(dataUrl);
}

function isPlaceholderValue(value) {
  const text = safeText(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes("your-server.example.com") ||
    lower.includes("example.com") ||
    lower.includes("your-uuid") ||
    lower.includes("your-token") ||
    lower === "your-account"
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
  return (
    state.mode === "sender" &&
    !state.ui.setupGuideDismissed &&
    (!hasCollabServiceReady() || !hasSenderConnectionReady())
  );
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

  const nameText =
    displayName && displayName !== username
      ? `${displayName} (${username})`
      : displayName || username || "已登录";
  const statusText =
    safeText(el("c_conn_state")?.textContent) || (state.collab.connected ? "在线" : "连接中");
  const roomText =
    safeText(state.collab.roomScope) && state.collab.roomScope !== "-"
      ? `房间：${state.collab.roomScope}`
      : "房间：等待同步";

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

  const nameText =
    displayName && displayName !== username
      ? `${displayName} (${username})`
      : displayName || username || "已登录";
  const connText =
    safeText(el("c_conn_state")?.textContent) || (state.collab.connected ? "在线" : "连接中");
  const roomText =
    safeText(state.collab.roomScope) && state.collab.roomScope !== "-"
      ? ` · ${state.collab.roomScope}`
      : "";

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

function formatConversationTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatChatDateLabel(ts) {
  if (!ts) return "今天";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "今天";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return d.toLocaleDateString([], {
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function isSameCalendarDay(leftTs, rightTs) {
  const left = new Date(leftTs);
  const right = new Date(rightTs);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function shouldGroupMessages(previous, current) {
  if (!previous || !current) return false;
  const prevMessage = normalizeChatMessage(previous);
  const currentMessage = normalizeChatMessage(current);
  if (prevMessage.system || currentMessage.system) return false;
  if (prevMessage.scope !== currentMessage.scope) return false;
  if (
    safeText(prevMessage.from || prevMessage.username) !==
    safeText(currentMessage.from || currentMessage.username)
  ) {
    return false;
  }
  if (!isSameCalendarDay(prevMessage.timestamp, currentMessage.timestamp)) return false;
  const prevMs = new Date(prevMessage.timestamp).getTime();
  const currentMs = new Date(currentMessage.timestamp).getTime();
  if (!Number.isFinite(prevMs) || !Number.isFinite(currentMs)) return false;
  return Math.abs(currentMs - prevMs) <= 5 * 60 * 1000;
}

function currentGptUser() {
  return safeText(state.collab.username) || "未登录账号";
}

function gptTotalQueries() {
  const derived = Object.values(state.gpt.queryUsers || {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
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
  const value = safeText(
    el("s_socks_listen_port")?.value ||
      state.settings?.sender?.socks_listen_port ||
      state.gpt.proxyPort ||
      GPT_PROXY_PORT,
  );
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
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "chatgpt.com" && parsed.pathname === "/" && !parsed.search) {
        return state.gpt.homeUrl;
      }
    } catch {}
    return url;
  }
  return state.gpt.homeUrl;
}

function normalizeGptTab(item, index = 0) {
  const id = safeText(item?.id || item?.tabId);
  return {
    id,
    title: safeText(item?.title) || "ChatGPT",
    url: normalizeGptUrl(item?.url || state.gpt.homeUrl),
    webviewInitialized: Boolean(item?.initialized),
    webviewLoading: Boolean(item?.loading),
    canGoBack: Boolean(item?.canGoBack),
    canGoForward: Boolean(item?.canGoForward),
  };
}

function getActiveGptTab() {
  return state.gpt.tabs.find((item) => item.id === state.gpt.activeTabId) || null;
}

function syncActiveGptTabState() {
  const activeTab = getActiveGptTab();
  if (!activeTab) {
    state.gpt.lastUrl = normalizeGptUrl(state.gpt.lastUrl);
    state.gpt.webviewInitialized = false;
    state.gpt.webviewLoading = false;
    state.gpt.canGoBack = false;
    state.gpt.canGoForward = false;
    return;
  }

  state.gpt.lastUrl = normalizeGptUrl(activeTab.url);
  state.gpt.webviewInitialized = Boolean(activeTab.webviewInitialized);
  state.gpt.webviewLoading = Boolean(activeTab.webviewLoading);
  state.gpt.canGoBack = Boolean(activeTab.canGoBack);
  state.gpt.canGoForward = Boolean(activeTab.canGoForward);
}

function applyGptTabsPayload(payload = {}) {
  const rawTabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
  state.gpt.tabs = rawTabs
    .map((item, index) => normalizeGptTab(item, index))
    .filter((item) => item.id);

  const requestedActive = safeText(payload?.activeTabId);
  state.gpt.activeTabId = state.gpt.tabs.some((item) => item.id === requestedActive)
    ? requestedActive
    : safeText(state.gpt.tabs[0]?.id);

  const activeState = payload?.activeState;
  if (activeState && safeText(activeState?.tabId)) {
    applyAiWorkspaceState("gpt", activeState);
  } else {
    syncActiveGptTabState();
  }

  renderGptTabs();
  updateGptRuntimeState();
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
  return String(window.navigator.userAgent || "")
    .replace(/\s*Electron\/[^\s]+/gi, "")
    .replace(/\s*ShareGPT\/[^\s]+/gi, "")
    .replace(/\s*ChatPortal(?:\s+X1)?(?:\s+V\d+)?\/[^\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  return kind === "gpt" ? state.gpt : kind === "gemini" ? state.gemini : null;
}

function getAiHostElement(kind) {
  return el(AI_HOST_IDS[kind] || "");
}

function shouldShowAiWorkspace(kind) {
  return (
    state.mode === "sender" &&
    state.view === kind &&
    Boolean(state.status?.senderRunning) &&
    Boolean(getAiHostElement(kind))
  );
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

  window.api
    .syncAiViewHost({
      kind,
      visible: rect.width > 1 && rect.height > 1,
      bounds,
    })
    .catch(() => {});
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

  if (kind === "gpt") {
    const tabId = safeText(payload.tabId) || state.gpt.activeTabId;
    const tab = state.gpt.tabs.find((item) => item.id === tabId);

    if (tab) {
      if (typeof payload.initialized === "boolean") {
        tab.webviewInitialized = payload.initialized;
      }
      if (typeof payload.loading === "boolean") {
        tab.webviewLoading = payload.loading;
      }
      if (typeof payload.canGoBack === "boolean") {
        tab.canGoBack = payload.canGoBack;
      }
      if (typeof payload.canGoForward === "boolean") {
        tab.canGoForward = payload.canGoForward;
      }

      const nextTitle = safeText(payload.title);
      if (nextTitle) {
        tab.title = nextTitle;
      }

      const nextUrl = safeText(payload.url);
      if (nextUrl && isGptAllowedUrl(nextUrl)) {
        tab.url = normalizeGptUrl(nextUrl);
      }
    }

    if (tabId === state.gpt.activeTabId) {
      if (tab?.url) {
        rememberGptUrl(tab.url, tab.id);
      }
      syncActiveGptTabState();
    }
    return;
  }

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
  if (nextUrl && kind === "gemini" && isGeminiAllowedUrl(nextUrl)) {
    rememberGeminiUrl(nextUrl);
  }
}

function bindAiWorkspaceEvents() {
  if (!window.api?.onAiEvent || state.ui.aiEventsBound) return;
  state.ui.aiEventsBound = true;

  window.api.onAiEvent((payload) => {
    const kind = safeText(payload?.kind);
    if (!kind) return;

    if (kind === "gpt" && payload?.type === "tabs-changed") {
      applyGptTabsPayload(payload);
      return;
    }

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

    if (payload?.type === "raw-document-detected" && kind === "gpt") {
      setGptFeedback(
        "检测到 GPT 登录页返回异常文本，程序已自动重试。若仍异常，请刷新一次页面。",
        "warning",
      );
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
      installGptQueryTracker(payload.tabId);
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

function renderGptTabs() {
  const list = el("gptTabList");
  if (!list) return;

  list.textContent = "";

  for (const tab of state.gpt.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gpt-tab${tab.id === state.gpt.activeTabId ? " active" : ""}`;
    button.dataset.gptTabId = tab.id;
    button.title = tab.title;

    const label = document.createElement("span");
    label.className = "gpt-tab-label";
    label.textContent = tab.title;

    const close = document.createElement("span");
    close.className = "gpt-tab-close";
    close.textContent = "×";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", `关闭 ${tab.title}`);

    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeGptTab(tab.id).catch((err) => {
        setGptFeedback(err.message || String(err), "error");
      });
    });

    button.appendChild(label);
    button.appendChild(close);
    button.addEventListener("click", () => {
      switchGptTab(tab.id).catch((err) => {
        setGptFeedback(err.message || String(err), "error");
      });
    });
    list.appendChild(button);
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
    } else if (!state.gpt.activeTabId) {
      runtimeNode.textContent = "暂无会话";
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

  if (!state.gpt.activeTabId) {
    overlay.hidden = false;
    overlayTitle.textContent = "当前没有打开的网页标签";
    overlayText.textContent = "请点击上方的 + 按钮，新建一个 ChatGPT 标签页。";
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
  const rawEntries =
    Array.isArray(state.gpt.statsEntries) && state.gpt.statsEntries.length
      ? state.gpt.statsEntries
      : Object.entries(state.gpt.statsUsers || {}).map(([username, count]) => ({
          username,
          count,
        }));
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

  const colors = [
    "#0a84ff",
    "#f59e0b",
    "#fb7185",
    "#22c55e",
    "#a855f7",
    "#14b8a6",
    "#f97316",
    "#eab308",
  ];
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
    const displayName =
      item.displayName && item.displayName !== username
        ? `${item.displayName} (${username})`
        : item.displayName || username;
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
    normalizedText &&
    normalizedText === state.gpt.lastTrackedQueryText &&
    now - state.gpt.lastTrackedQueryAt < 1800
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

  const response = await fetchWithFriendlyError(
    `${state.collab.serverUrl}/api/gpt/stats`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.collab.token}`,
      },
    },
    8000,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `加载 GPT 使用统计失败（${response.status}）`);
  }

  const payload = await response.json();
  state.gpt.totalQueries = Number(payload.totalQueries) || 0;
  state.gpt.queryUsers = Object.fromEntries(
    (payload.users || [])
      .map((item) => [safeText(item.username), Number(item.count) || 0])
      .filter(([username]) => username),
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
  const response = await fetchWithFriendlyError(
    `${state.collab.serverUrl}/api/gpt/stats${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.collab.token}`,
      },
    },
    8000,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `查询 GPT 使用统计失败（${response.status}）`);
  }

  const payload = await response.json();
  state.gpt.statsTotalQueries = Number(payload.totalQueries) || 0;
  state.gpt.statsUserCount = Number(payload.userCount) || 0;
  state.gpt.statsEntries = (payload.users || [])
    .map((item) => ({
      username: safeText(item?.username),
      displayName: safeText(item?.displayName),
      count: Number(item?.count) || 0,
      ratio: Number(item?.ratio) || 0,
    }))
    .filter((item) => item.username && item.count > 0);
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

  const response = await fetchWithFriendlyError(
    `${state.collab.serverUrl}/api/gpt/usage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.collab.token}`,
      },
      body: JSON.stringify({ count: 1 }),
    },
    8000,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `记录 GPT 使用次数失败（${response.status}）`);
  }

  await loadGptSummaryStats();
  await loadGptRangeStats({ silent: true });
}

async function openGptExternal(rawUrl) {
  const url = safeText(rawUrl) || normalizeGptUrl(getActiveGptTab()?.url || state.gpt.lastUrl);
  if (!url) return;
  await window.api.openExternal(url);
}

function rememberGptUrl(rawUrl, tabId = state.gpt.activeTabId) {
  const url = normalizeGptUrl(rawUrl);
  const targetId = safeText(tabId);
  const tab = state.gpt.tabs.find((item) => item.id === targetId);
  if (tab) {
    tab.url = url;
  }
  if (!targetId || targetId === state.gpt.activeTabId) {
    state.gpt.lastUrl = url;
  }
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

function installGptQueryTracker(tabId = state.gpt.activeTabId) {
  const targetId = safeText(tabId) || state.gpt.activeTabId;
  const activeTab = state.gpt.tabs.find((item) => item.id === targetId);
  if (!window.api?.executeAiJavaScript || !activeTab || !isGptAllowedUrl(activeTab.url)) return;

  const marker = JSON.stringify(GPT_QUERY_MARKER);
  window.api
    .executeAiJavaScript({
      kind: "gpt",
      tabId: targetId,
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
    })
    .catch(() => {
      // ignore tracker injection failures
    });
}

async function createGptTab() {
  const payload = await window.api.createGptView({
    lastUrl: state.gpt.homeUrl,
  });
  applyGptTabsPayload(payload);
  if (state.status?.senderRunning && state.view === "gpt") {
    await ensureGptWorkspace();
  }
}

async function switchGptTab(tabId) {
  const targetId = safeText(tabId);
  if (!targetId || targetId === state.gpt.activeTabId) return;
  const payload = await window.api.switchGptView({ tabId: targetId });
  applyGptTabsPayload(payload);
  if (state.status?.senderRunning && state.view === "gpt") {
    await ensureGptWorkspace();
  }
}

async function closeGptTab(tabId) {
  const targetId = safeText(tabId);
  if (!targetId || !window.api?.closeGptView) return;
  const payload = await window.api.closeGptView({ tabId: targetId });
  applyGptTabsPayload(payload);
  if (state.status?.senderRunning && state.view === "gpt") {
    await ensureGptWorkspace();
  }
}

async function ensureGptWorkspace(options = {}) {
  const forceReload = Boolean(options.forceReload);
  updateGptProxyInfo();
  updateGptRuntimeState();

  const activeTab = getActiveGptTab();
  if (!activeTab) {
    updateGptRuntimeState();
    return;
  }

  if (!state.status?.senderRunning) {
    return;
  }

  const payload = await window.api.ensureAiWorkspace({
    kind: "gpt",
    tabId: activeTab.id,
    partition: state.gpt.partition,
    host: state.gpt.proxyHost,
    port: state.gpt.proxyPort,
    homeUrl: state.gpt.homeUrl,
    lastUrl: normalizeGptUrl(activeTab.url || state.gpt.lastUrl),
    userAgent: gptUserAgent(),
    forceReload,
  });

  if (!payload) {
    updateGptRuntimeState();
    return;
  }

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
    el("geminiProxyInfo").textContent =
      `SOCKS5 ${state.gemini.proxyHost}:${state.gemini.proxyPort}`;
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
    overlayText.textContent =
      "正在初始化内置页面并连接本地代理。Google 登录可能会跳转到账号验证页面。";
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

function openConversationFromNotification(route) {
  const scope = safeText(route?.scope) === "private" ? "private" : "subnet";
  const targetUsername = safeText(route?.targetUsername || route?.from);
  const messageId = safeText(route?.messageId);

  setActiveView("chat");
  if (scope === "private" && targetUsername) {
    pickPrivateTarget(targetUsername);
  } else {
    pickRoomConversation();
  }

  if (messageId) {
    window.setTimeout(() => {
      focusMessageById(messageId);
    }, 120);
  }
}

function conversationMatchesFilter(...parts) {
  const query = safeText(state.collab.conversationFilter).toLowerCase();
  if (!query) return true;
  return parts.some((part) => safeText(part).toLowerCase().includes(query));
}

function conversationPartner(username) {
  const name = safeText(username);
  if (!name) return null;
  return (state.collab.userDirectory || []).find((item) => item.username === name) || null;
}

function privateConversationMeta(username) {
  const user = conversationPartner(username);
  const fallbackName = safeText(username) || "联系人";
  return {
    username: safeText(username),
    displayName: safeText(user?.displayName) || fallbackName,
    avatar: safeText(user?.avatar),
    subtitle: "",
  };
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

function messageActivityCursor(message) {
  const normalized = normalizeChatMessage(message);
  return safeText(normalized.readAt || normalized.recalledAt || normalized.timestamp);
}

function collectUnreadPrivateIncomingMessageIds(username) {
  const partner = safeText(username);
  if (!partner) return [];
  const key = privateConversationKey(partner);
  const items = state.collab.messagesByConversation.get(key) || [];
  return items
    .filter((item) => {
      const message = normalizeChatMessage(item);
      return (
        message.scope === "private" &&
        safeText(message.from) === partner &&
        safeText(message.to) === state.collab.username &&
        !safeText(message.readAt) &&
        !message.recalled &&
        safeText(message.id)
      );
    })
    .map((item) => safeText(item.id));
}

function sendPrivateReadReceipt(username, messageIds) {
  const partner = safeText(username);
  const ids = Array.isArray(messageIds)
    ? [...new Set(messageIds.map((item) => safeText(item)).filter(Boolean))]
    : [];
  if (!partner || !ids.length) return;
  if (!state.collab.connected || !state.collab.ws || state.collab.ws.readyState !== WebSocket.OPEN)
    return;

  state.collab.ws.send(
    JSON.stringify({
      type: "chat_read",
      with: partner,
      messageIds: ids,
    }),
  );
}

function sendRoomReadReceipt(messageIds) {
  const ids = Array.isArray(messageIds)
    ? [...new Set(messageIds.map((item) => safeText(item)).filter(Boolean))]
    : [];
  if (!ids.length) return;
  if (!state.collab.connected || !state.collab.ws || state.collab.ws.readyState !== WebSocket.OPEN)
    return;

  state.collab.ws.send(
    JSON.stringify({
      type: "chat_read",
      scope: "subnet",
      messageIds: ids,
    }),
  );
}

function markVisiblePrivateConversationRead() {
  if (state.view !== "chat" || currentChatScope() !== "private") return;
  const partner = safeText(el("c_chat_target")?.value);
  if (!partner) return;
  const ids = collectUnreadPrivateIncomingMessageIds(partner);
  if (!ids.length) return;
  sendPrivateReadReceipt(partner, ids);
}

function collectUnreadRoomIncomingMessageIds() {
  const roomKey = roomConversationKey();
  const items = state.collab.messagesByConversation.get(roomKey) || [];
  return items
    .map((item) => normalizeChatMessage(item))
    .filter((item) => {
      if (item.scope !== "subnet") return false;
      if (item.system || item.recalled) return false;
      if (safeText(item.from) === state.collab.username) return false;
      const readers = normalizeReadBy(item.readBy);
      return !readers.some((reader) => reader.username === state.collab.username);
    })
    .map((item) => item.id)
    .filter(Boolean);
}

function markVisibleRoomConversationRead() {
  if (state.view !== "chat" || currentChatScope() !== "subnet") return;
  const ids = collectUnreadRoomIncomingMessageIds();
  if (!ids.length) return;
  sendRoomReadReceipt(ids);
}

function sendChatTyping(active) {
  const scope = currentChatScope();
  const target = safeText(el("c_chat_target")?.value);
  if (scope === "private" && !target) return;
  if (!state.collab.connected || !state.collab.ws || state.collab.ws.readyState !== WebSocket.OPEN)
    return;

  const key = typingConversationKey(scope, target);
  const previous = state.collab.lastTypingSentAt.get(key) || { active: false, at: 0 };
  const now = Date.now();

  if (active) {
    if (previous.active && now - previous.at < 1800) {
      return;
    }
  } else if (!previous.active) {
    return;
  }

  state.collab.lastTypingSentAt.set(key, { active, at: now });
  state.collab.ws.send(
    JSON.stringify({
      type: "chat_typing",
      scope,
      to: scope === "private" ? target : "",
      active: Boolean(active),
    }),
  );
}

function resetConversationState() {
  state.collab.messagesByConversation = new Map();
  state.collab.unreadByConversation = new Map();
  clearAllConversationTyping({ render: false });
  state.collab.lastTypingSentAt = new Map();
  state.collab.lastHistorySyncAt = "";
  state.collab.replyDraft = null;
  state.collab.editDraft = null;
  state.collab.forwardDraft = null;
  renderReplyDraft();
  renderEditDraft();
  renderForwardDraft();
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

function playNotificationTone() {
  if (!state.collab.notifySoundPlay) return;

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
    oscillator.onended = () => {
      void context.close().catch(() => {});
    };
  } catch {
    // ignore
  }
}

async function showSystemNotification(title, message, route = null) {
  if (!state.collab.notifySystemNotification) return;
  try {
    const sender = safeText(title) || "新消息";
    const content = safeText(message) || "";
    await window.api.showSystemNotification({
      title: "ShareGPT",
      body: content ? `${sender}：${content}` : sender,
      route: route && typeof route === "object" ? route : {},
    });
  } catch (err) {
    logLine("collab", `发送系统通知失败：${err.message || err}`);
  }
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
      subtitle:
        "填写接收端信息后，可在当前设备开启接收服务，让另一台设备的连接通过这里完成接收和转发。",
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
    : nextView === "gpt-stats"
      ? "gpt-stats"
      : nextView;
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
    : getAvailableViews().includes(state.view)
      ? state.view
      : state.mode === "receiver"
        ? "receiver"
        : "sender";

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
  const receiverRunning = Boolean(
    state.status?.receiverFrpcRunning || state.status?.receiverSingboxRunning,
  );
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

  if (el("senderState"))
    el("senderState").textContent = `发送服务：${senderRunning ? "运行中" : "未开启"}`;
  if (el("receiverState"))
    el("receiverState").textContent = `接收服务：${receiverRunning ? "运行中" : "未开启"}`;

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
    target_domains: safeText(el("s_target_domains")?.value) || DEFAULT_TARGET_DOMAINS,
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
    theme: state.ui.theme,
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
    notify_system_notification: Boolean(state.collab.notifySystemNotification),
    notify_sound_play: Boolean(state.collab.notifySoundPlay),
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
  if (el("s_fallback_local_port"))
    el("s_fallback_local_port").value = sender.fallback_local_port || "";
  if (el("s_target_domains")) {
    el("s_target_domains").value = sender.target_domains || DEFAULT_TARGET_DOMAINS;
    el("s_target_domains").readOnly = true;
  }

  if (el("r_frps_server")) el("r_frps_server").value = receiver.frps_server || "";
  if (el("r_frps_port")) el("r_frps_port").value = receiver.frps_port || "";
  if (el("r_frps_token")) el("r_frps_token").value = receiver.frps_token || "";
  if (el("r_remote_port")) el("r_remote_port").value = receiver.remote_port || "";
  if (el("r_vmess_listen_port")) el("r_vmess_listen_port").value = receiver.vmess_listen_port || "";
  if (el("r_vmess_uuid")) el("r_vmess_uuid").value = receiver.vmess_uuid || "";
  if (el("r_forward_proxy_port"))
    el("r_forward_proxy_port").value = receiver.forward_proxy_port || "";
  if (el("r_tls_enable")) el("r_tls_enable").checked = Boolean(receiver.tls_enable);
  if (el("r_use_compression")) el("r_use_compression").checked = Boolean(receiver.use_compression);
  if (el("r_use_encryption")) el("r_use_encryption").checked = Boolean(receiver.use_encryption);

  if (el("c_server_url")) el("c_server_url").value = collab.server_url || "";
  if (el("c_username")) el("c_username").value = collab.last_username || "";
  state.collab.rememberPassword = Boolean(collab.remember_password);
  state.collab.savedPassword = state.collab.rememberPassword
    ? String(collab.saved_password || "")
    : "";
  state.collab.notifyMessagePopup = collab.notify_message_popup !== false;
  state.collab.notifySystemNotification = collab.notify_system_notification !== false;
  state.collab.notifySoundPlay = collab.notify_sound_play !== false;
  state.collab.notifyUserOnline = Boolean(collab.notify_user_online);
  if (el("c_password")) el("c_password").value = state.collab.savedPassword;
  if (el("c_remember_password")) el("c_remember_password").checked = state.collab.rememberPassword;
  if (el("c_notify_message_popup"))
    el("c_notify_message_popup").checked = state.collab.notifyMessagePopup;
  if (el("c_notify_system_notification"))
    el("c_notify_system_notification").checked = state.collab.notifySystemNotification;
  if (el("c_notify_sound_play")) el("c_notify_sound_play").checked = state.collab.notifySoundPlay;
  if (el("c_notify_user_online"))
    el("c_notify_user_online").checked = state.collab.notifyUserOnline;

  state.collab.avatar = safeText(collab.last_avatar);
  state.collab.pinnedUsers = new Set(
    Array.isArray(collab.pinned_users)
      ? collab.pinned_users.map((item) => safeText(item)).filter(Boolean)
      : [],
  );
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
  applyTheme(ui.theme, { syncControls: true });

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
  syncUpdateControls();
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

function setAppUpdateFeedback(text = "", tone = "") {
  setPanelFeedback("app_update_feedback", text, tone);
}

function updateAppUpdateProgress(progress = null) {
  const block = el("appUpdateProgress");
  const fill = el("appUpdateProgressFill");
  const textNode = el("appUpdateProgressText");
  const percentNode = el("appUpdateProgressPercent");
  if (!block || !fill || !textNode || !percentNode) return;

  const active = Boolean(progress && (state.app.downloading || progress.done));
  block.hidden = !active;
  if (!active) {
    fill.style.width = "0%";
    textNode.textContent = "准备下载";
    percentNode.textContent = "0%";
    return;
  }

  const total = Number(progress.total || 0);
  const transferred = Number(progress.transferred || 0);
  const percent = total
    ? Math.min(100, Math.max(0, Math.round((transferred / total) * 100)))
    : Math.min(100, Math.max(0, Number(progress.percent || 0)));
  fill.style.width = `${percent}%`;
  percentNode.textContent = `${percent}%`;
  textNode.textContent = total
    ? `${safeText(progress.fileName) || "更新包"} · ${formatBytes(transferred)} / ${formatBytes(total)}`
    : `${safeText(progress.fileName) || "更新包"} · ${formatBytes(transferred)}`;
}

function normalizeBootstrapPayload(payload = {}) {
  const sender = payload?.sender && typeof payload.sender === "object" ? payload.sender : {};
  const platformUpdate =
    payload?.update?.[currentUpdatePlatformKey()] &&
    typeof payload.update[currentUpdatePlatformKey()] === "object"
      ? payload.update[currentUpdatePlatformKey()]
      : {};

  return {
    sender: {
      proxy_server: safeText(sender.proxy_server),
      proxy_port: safeText(sender.proxy_port),
      proxy_uuid: safeText(sender.proxy_uuid),
      socks_listen_port: safeText(sender.socks_listen_port),
      fallback_mode: safeText(sender.fallback_mode) || "system_proxy",
      fallback_local_port: safeText(sender.fallback_local_port),
      target_domains: safeText(sender.target_domains) || DEFAULT_TARGET_DOMAINS,
    },
    update: {
      version: safeText(payload?.update?.version),
      notes: safeText(payload?.update?.notes),
      publishedAt: safeText(payload?.update?.publishedAt),
      url: safeText(platformUpdate.url),
      fileName: safeText(platformUpdate.fileName),
    },
  };
}

function hasCompleteSenderBootstrap(sender = getSenderForm()) {
  return Boolean(
    safeText(sender?.proxy_server) && safeText(sender?.proxy_port) && safeText(sender?.proxy_uuid),
  );
}

async function applySenderBootstrapConfig(serverSender, options = {}) {
  const silent = Boolean(options.silent);
  const normalized = normalizeBootstrapPayload({ sender: serverSender }).sender;
  if (!hasCompleteSenderBootstrap(normalized)) {
    return false;
  }

  const current = getSenderForm();
  if (hasCompleteSenderBootstrap(current)) {
    return false;
  }

  const mergedSender = {
    ...current,
    proxy_server: normalized.proxy_server || current.proxy_server,
    proxy_port: normalized.proxy_port || current.proxy_port,
    proxy_uuid: normalized.proxy_uuid || current.proxy_uuid,
    socks_listen_port: normalized.socks_listen_port || current.socks_listen_port,
    fallback_mode: normalized.fallback_mode || current.fallback_mode,
    fallback_local_port: normalized.fallback_local_port || current.fallback_local_port,
    target_domains: normalized.target_domains || current.target_domains || DEFAULT_TARGET_DOMAINS,
  };

  const nextSettings = {
    ...(state.settings || {}),
    sender: {
      ...((state.settings && state.settings.sender) || {}),
      ...mergedSender,
    },
  };

  fillForm(nextSettings);
  refreshFallbackVisibility();
  await saveSettings({ silent: true });

  if (!silent) {
    setCollabFeedback("已从服务器同步发送服务配置。", "success");
  }
  return true;
}

function syncUpdateControls() {
  const versionNode = el("appVersionText");
  const latestNode = el("appLatestVersion");
  const notesNode = el("appUpdateNotes");
  const checkButton = el("btnCheckAppUpdate");
  const installButton = el("btnInstallAppUpdate");
  const update = state.app.updateInfo;
  const currentVersion = safeText(state.app.version) || "-";
  const latestVersion = safeText(update?.version);
  const hasPackage = Boolean(update?.url);
  const hasNewVersion = Boolean(
    latestVersion &&
    currentVersion &&
    compareVersions(latestVersion, currentVersion) > 0 &&
    hasPackage,
  );

  if (versionNode) {
    versionNode.textContent = currentVersion;
  }
  if (latestNode) {
    latestNode.textContent = latestVersion || "未发布";
  }
  if (notesNode) {
    notesNode.textContent = safeText(update?.notes) || "服务器未提供更新说明。";
  }
  if (checkButton) {
    checkButton.disabled = !state.collab.token || state.app.downloading;
  }
  if (installButton) {
    installButton.disabled = !hasPackage || state.app.downloading;
    installButton.textContent = state.app.downloading
      ? "下载中…"
      : hasNewVersion
        ? "下载并安装更新"
        : "重新下载安装包";
  }

  if (!state.collab.token) {
    setAppUpdateFeedback("登录后可检查新版本。");
    return;
  }

  if (!update) {
    setAppUpdateFeedback("点击“检查更新”后，会从当前服务器读取发布信息。");
    return;
  }

  if (!hasPackage) {
    setAppUpdateFeedback("当前服务器还没有配置本平台的安装包。");
    return;
  }

  if (hasNewVersion) {
    setAppUpdateFeedback(
      `发现新版本 ${latestVersion}，下载后会保留账号、聊天记录、配置和网页登录状态。`,
      "success",
    );
    return;
  }

  setAppUpdateFeedback("当前已经是最新版本。", "success");
}

async function fetchClientBootstrap(options = {}) {
  const silent = Boolean(options.silent);
  if (!state.collab.serverUrl || !state.collab.token) {
    return null;
  }

  const response = await fetchWithFriendlyError(
    `${state.collab.serverUrl.replace(/\/+$/, "")}/api/client/bootstrap`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.collab.token}`,
      },
    },
    10000,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `读取客户端配置失败（${response.status}）`);
  }

  const payload = normalizeBootstrapPayload(await response.json());
  state.app.updateInfo = payload.update;
  syncUpdateControls();

  await applySenderBootstrapConfig(payload.sender, { silent });
  return payload;
}

async function checkAppUpdate(options = {}) {
  const silent = Boolean(options.silent);
  try {
    await fetchClientBootstrap({ silent: true });
    if (!silent) {
      syncUpdateControls();
    }
  } catch (err) {
    if (!silent) {
      setAppUpdateFeedback(err.message || String(err), "error");
    }
    throw err;
  }
}

async function installAppUpdate() {
  const update = state.app.updateInfo;
  if (!update?.url) {
    setAppUpdateFeedback("当前服务器还没有配置本平台的安装包。", "error");
    return;
  }

  state.app.downloading = true;
  state.app.updateProgress = {
    transferred: 0,
    total: 0,
    percent: 0,
    fileName: safeText(update.fileName) || "更新包",
  };
  syncUpdateControls();
  updateAppUpdateProgress(state.app.updateProgress);
  setAppUpdateFeedback("正在下载更新包…");
  let finalMessage = "";
  let finalTone = "";

  try {
    const result = await window.api.downloadAppUpdate({
      url: update.url,
      fileName: update.fileName,
      version: update.version,
    });
    state.app.downloadedFilePath = safeText(result?.filePath);
    const opened = await window.api.openAppUpdate({
      filePath: state.app.downloadedFilePath,
      quitAfterOpen: true,
    });
    finalMessage = opened?.backupDir
      ? `更新包已保存到：${state.app.downloadedFilePath}。已完成更新前资料快照：${opened.backupDir}。当前程序将自动退出以便完成更新。`
      : `更新包已保存到：${state.app.downloadedFilePath}。安装程序已经打开，当前程序将自动退出。`;
    finalTone = "success";
  } catch (err) {
    finalMessage = err.message || String(err);
    finalTone = "error";
  } finally {
    state.app.downloading = false;
    syncUpdateControls();
    updateAppUpdateProgress(state.app.updateProgress);
    if (finalMessage) {
      setAppUpdateFeedback(finalMessage, finalTone);
    }
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
  if (
    !(
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
    )
  )
    return;

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
  if (contextMenuAnchorNode instanceof HTMLElement) {
    contextMenuAnchorNode.classList.remove("chat-item-context-target");
  }
  contextMenuAnchorNode = null;
}

function showContextMenu(x, y, items = [], options = {}) {
  const menu = el("appContextMenu");
  if (!menu || !Array.isArray(items) || !items.length) return;

  if (state.contextMenuOpen) {
    hideContextMenu();
  }

  const anchorNode = options.anchorNode instanceof HTMLElement ? options.anchorNode : null;
  if (anchorNode) {
    contextMenuAnchorNode = anchorNode;
    contextMenuAnchorNode.classList.add("chat-item-context-target");
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
  sendChatTyping(false);
  clearReplyDraft();
  clearEditDraft({ resetInput: true });
  clearForwardDraft();
  if (el("c_chat_scope")) {
    el("c_chat_scope").value = "private";
  }
  refreshPrivateTargets();
  if (el("c_chat_target")) {
    el("c_chat_target").value = targetUser;
  }
  syncChatComposerLayout({ defer: true });
  syncChatConversation();
  setPanelFeedback("chat_feedback", "");
  if (state.mode !== "receiver" && state.collab.token) {
    setActiveView("chat");
  }
}

function pickRoomConversation() {
  sendChatTyping(false);
  clearReplyDraft();
  clearEditDraft({ resetInput: true });
  clearForwardDraft();
  if (el("c_chat_scope")) {
    el("c_chat_scope").value = "subnet";
  }
  if (el("c_chat_target")) {
    el("c_chat_target").value = "";
  }
  syncChatComposerLayout({ defer: true });
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

function listRecentConversationKeys() {
  const keys = new Set();
  for (const key of state.collab.messagesByConversation.keys()) {
    if (safeText(key).startsWith("user:")) {
      keys.add(key);
    }
  }

  const currentPrivateUser =
    currentChatScope() === "private" ? safeText(el("c_chat_target")?.value) : "";
  if (currentPrivateUser) {
    keys.add(privateConversationKey(currentPrivateUser));
  }

  return [...keys].sort((a, b) => {
    const aItems = state.collab.messagesByConversation.get(a) || [];
    const bItems = state.collab.messagesByConversation.get(b) || [];
    const aLast = aItems[aItems.length - 1];
    const bLast = bItems[bItems.length - 1];
    const aPinned = state.collab.pinnedUsers.has(safeText(a).replace(/^user:/, "")) ? 1 : 0;
    const bPinned = state.collab.pinnedUsers.has(safeText(b).replace(/^user:/, "")) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    const aUnread = getUnreadCount(a);
    const bUnread = getUnreadCount(b);
    if (aUnread !== bUnread) return bUnread - aUnread;
    const aTs = safeText(aLast?.recalledAt || aLast?.timestamp);
    const bTs = safeText(bLast?.recalledAt || bLast?.timestamp);
    return bTs.localeCompare(aTs);
  });
}

function renderRecentConversations() {
  const list = el("c_recent_list");
  const countNode = el("c_recent_count");
  if (!list) return;

  list.textContent = "";
  const keys = listRecentConversationKeys().filter((key) => {
    const username = safeText(key).replace(/^user:/, "");
    const meta = privateConversationMeta(username);
    const items = state.collab.messagesByConversation.get(key) || [];
    const last = items[items.length - 1];
    return conversationMatchesFilter(meta.displayName, meta.username, messagePreviewText(last));
  });

  if (countNode) {
    countNode.textContent = `${keys.length} 个`;
  }

  if (!keys.length) {
    const li = document.createElement("li");
    li.textContent = safeText(state.collab.conversationFilter)
      ? "没有匹配到会话"
      : "最近会话会显示在这里";
    list.appendChild(li);
    return;
  }

  const activeKey = currentConversationKey();
  for (const key of keys) {
    const username = safeText(key).replace(/^user:/, "");
    const meta = privateConversationMeta(username);
    const items = state.collab.messagesByConversation.get(key) || [];
    const last = items[items.length - 1];
    const pinned = state.collab.pinnedUsers.has(username);
    const li = document.createElement("li");
    li.dataset.conversationKey = key;
    li.className = `${activeKey === key ? "active" : ""}${pinned ? " pinned" : ""}`.trim();

    const main = document.createElement("div");
    main.className = "recent-main";

    const avatarNode = document.createElement("span");
    avatarNode.className = "recent-avatar";
    avatarNode.textContent = avatarMark(meta.avatar, meta.displayName);

    const copy = document.createElement("div");
    copy.className = "recent-copy";

    const line = document.createElement("div");
    line.className = "recent-line";

    const title = document.createElement("strong");
    title.textContent = meta.displayName;

    const time = document.createElement("span");
    time.textContent = formatConversationTime(last?.recalledAt || last?.timestamp);

    if (pinned) {
      const pinnedTag = document.createElement("em");
      pinnedTag.className = "recent-tag";
      pinnedTag.textContent = "置顶";
      line.appendChild(pinnedTag);
    }
    const previewRow = document.createElement("div");
    previewRow.className = "recent-preview-row";

    const typing = getConversationTypingMeta(key);
    const stateMeta = typing ? null : recentMessageState(last, username);
    if (stateMeta) {
      const stateNode = document.createElement("span");
      stateNode.className = `recent-message-state ${stateMeta.kind}`;
      stateNode.textContent = stateMeta.label;
      stateNode.title = stateMeta.title;
      previewRow.appendChild(stateNode);
    }

    const preview = document.createElement("div");
    preview.className = `recent-preview${typing ? " typing" : ""}`;
    preview.textContent = typing
      ? `${typing.displayName || typing.from || "对方"} 正在输入…`
      : last
        ? recentPreviewText(last, username)
        : "还没有消息，点击后开始聊天";

    line.appendChild(title);
    line.appendChild(time);
    copy.appendChild(line);
    previewRow.appendChild(preview);
    copy.appendChild(previewRow);
    main.appendChild(avatarNode);
    main.appendChild(copy);
    li.appendChild(main);

    const side = document.createElement("div");
    side.className = "recent-side";
    const unread = getUnreadCount(key);
    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = formatUnreadCount(unread);
      side.appendChild(badge);
    }
    li.appendChild(side);

    li.addEventListener("click", () => {
      pickPrivateTarget(username);
    });

    list.appendChild(li);
  }
}

function renderUserDirectory(users) {
  const list = el("c_online_list");
  if (!list) return;

  list.textContent = "";
  const sorted = sortUsers(users).filter((user) =>
    conversationMatchesFilter(user.username, user.displayName, user.subnetLabel, user.subnetKey),
  );
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
    const selected =
      currentChatScope() === "private" && safeText(el("c_chat_target")?.value) === username;
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
    badge.textContent = self ? "自己" : online ? "在线" : "离线";

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
  const normalized = items
    .map((item) => ({
      username: safeText(item?.username),
      displayName: safeText(item?.displayName) || safeText(item?.username),
      avatar: safeText(item?.avatar),
      online: Boolean(item?.online),
      subnetKey: safeText(item?.subnetKey),
      subnetLabel: safeText(item?.subnetLabel),
    }))
    .filter((item) => item.username);

  const nextOnlineUsers = new Set(
    normalized
      .filter((item) => item.online && item.username !== state.collab.username)
      .map((item) => item.username),
  );
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

  renderRecentConversations();
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
  syncUpdateControls();
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
  const contacts = sortUsers(state.collab.userDirectory || []).filter(
    (item) => item.username !== state.collab.username,
  );

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
  const attachments = normalizeMessageAttachments(payload?.attachments);
  const replyTo = normalizeReplyTarget(payload?.replyTo);
  const forwardedFrom = normalizeForwardedFrom(payload?.forwardedFrom);
  const recalled = Boolean(payload?.recalled);

  return {
    id: safeText(payload?.id),
    type: safeText(payload?.type) || (system ? "system" : "chat"),
    scope,
    from,
    to: safeText(payload?.to),
    username,
    displayName,
    avatar: safeText(payload?.avatar),
    text: safeText(payload?.text),
    attachments,
    replyTo,
    forwardedFrom,
    timestamp: payload?.timestamp || new Date().toISOString(),
    readAt: scope === "private" ? safeText(payload?.readAt) : "",
    readBy: scope === "subnet" ? normalizeReadBy(payload?.readBy) : [],
    edited: Boolean(payload?.edited),
    editedAt: Boolean(payload?.edited)
      ? safeText(payload?.editedAt) || new Date().toISOString()
      : "",
    subnetKey: safeText(payload?.subnetKey),
    subnetLabel: safeText(payload?.subnetLabel || payload?.roomScope),
    system,
    recalled,
    recalledAt: recalled ? safeText(payload?.recalledAt) || new Date().toISOString() : "",
  };
}

function conversationKeyForMessage(payload) {
  const message = normalizeChatMessage(payload);
  if (message.scope === "private") {
    const fromUser = safeText(message.from);
    const toUser = safeText(message.to);
    const otherUser = message.system
      ? toUser
      : fromUser === state.collab.username
        ? toUser
        : safeText(fromUser || message.username);
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
  if (!conversationKey || !hasMessageContent(message)) {
    return { conversationKey: "", message };
  }

  const items = state.collab.messagesByConversation.get(conversationKey) || [];
  const messageId = safeText(message.id);
  if (messageId) {
    const existingIndex = items.findIndex((item) => safeText(item.id) === messageId);
    if (existingIndex >= 0) {
      items[existingIndex] = {
        ...items[existingIndex],
        ...message,
      };
      state.collab.messagesByConversation.set(conversationKey, items);
      updateHistoryCursorFromMessage(message);
      scheduleChatHistoryPersist();
      return { conversationKey, message };
    }
  }
  const fingerprint = messageFingerprint(message);
  if (items.some((item) => messageFingerprint(item) === fingerprint)) {
    return { conversationKey, message };
  }
  items.push(message);
  if (items.length > 300) {
    items.splice(0, items.length - 300);
  }
  state.collab.messagesByConversation.set(conversationKey, items);
  updateHistoryCursorFromMessage(message);
  scheduleChatHistoryPersist();
  return { conversationKey, message };
}

function renderActiveConversation() {
  const box = el("c_chat_box");
  if (!box) return;

  const conversationKey = currentConversationKey();
  const messages = conversationKey
    ? state.collab.messagesByConversation.get(conversationKey) || []
    : [];
  box.textContent = "";

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent =
      currentChatScope() === "private"
        ? "这里暂时还没有私聊记录。选择联系人后，新消息会显示在这里。"
        : "这个房间还没有消息记录。";
    box.appendChild(empty);
    return;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const previous = index > 0 ? messages[index - 1] : null;
    const next = index < messages.length - 1 ? messages[index + 1] : null;

    if (!previous || !isSameCalendarDay(previous?.timestamp, message?.timestamp)) {
      const separator = document.createElement("div");
      separator.className = "chat-date-separator";
      separator.textContent = formatChatDateLabel(message?.timestamp);
      box.appendChild(separator);
    }

    appendChatMessage(message, { box, scroll: false, previous, next });
  }
  box.scrollTop = box.scrollHeight;
}

function mergeConversationHistory(messages, options = {}) {
  if (options.reset) {
    resetConversationState();
  }
  const items = Array.isArray(messages) ? messages : [];
  for (const item of items) {
    storeConversationMessage(item);
  }
  updateRoomUnreadBadge();
  renderRecentConversations();
  renderUserDirectory(state.collab.userDirectory);
  renderActiveConversation();
}

function handleIncomingConversationMessage(payload) {
  const { conversationKey, message } = storeConversationMessage(payload);
  if (!conversationKey || !hasMessageContent(message)) return;

  const activeKey = currentConversationKey();
  const fromSelf = safeText(message.from) === state.collab.username;
  if (!fromSelf) {
    clearConversationTyping(conversationKey, { render: false });
  }
  const conversationVisible =
    state.view === "chat" && conversationKey === activeKey && state.windowFocused;
  const shouldNotify =
    !fromSelf && !message.system && state.collab.notifyMessagePopup && !conversationVisible;

  if (!fromSelf && !message.system && !conversationVisible) {
    increaseUnreadCount(conversationKey);
  }

  if (shouldNotify) {
    const preview = messagePreviewText(message);
    showToast(message.displayName || message.username, preview, "info");
    void showSystemNotification(message.displayName || message.username, preview, {
      scope: message.scope,
      targetUsername: message.scope === "private" ? safeText(message.from || message.username) : "",
      roomScope:
        message.scope === "subnet" ? safeText(message.subnetLabel || message.subnetKey) : "",
      messageId: safeText(message.id),
    });
    playNotificationTone();
  }

  updateRoomUnreadBadge();
  renderRecentConversations();
  renderUserDirectory(state.collab.userDirectory);

  if (conversationKey === activeKey) {
    renderActiveConversation();
  }

  if (conversationVisible && message.scope === "private" && !fromSelf) {
    sendPrivateReadReceipt(safeText(message.from), [message.id]);
  }
  if (conversationVisible && message.scope === "subnet" && !fromSelf) {
    sendRoomReadReceipt([message.id]);
  }
}

function syncChatConversation() {
  const scope = currentChatScope();
  const targetUsername = safeText(el("c_chat_target")?.value);
  const selectedUser = (state.collab.userDirectory || []).find(
    (item) => item.username === targetUsername,
  );
  const titleNode = el("c_chat_title");
  const subNode = el("c_chat_subtitle");
  const roomButton = el("c_room_channel");
  const inRoom = scope !== "private";

  if (roomButton) {
    roomButton.classList.toggle("active", inRoom);
  }

  document.querySelectorAll("#c_online_list li[data-username]").forEach((item) => {
    item.classList.toggle(
      "active",
      !inRoom && item.getAttribute("data-username") === targetUsername,
    );
  });

  const typingSummary = conversationTypingSummary(scope, targetUsername);

  if (inRoom) {
    const roomScope = safeText(state.collab.roomScope);
    if (titleNode) titleNode.textContent = "房间消息";
    if (subNode) {
      subNode.textContent =
        typingSummary ||
        (roomScope && roomScope !== "-"
          ? `发送给房间 ${roomScope} 内的所有在线联系人`
          : "发送给房间内的所有在线联系人");
    }
  } else if (!targetUsername) {
    if (titleNode) titleNode.textContent = "请选择联系人";
    if (subNode)
      subNode.textContent = "从左侧联系人列表中选择联系人后，就可以查看私聊记录并继续发送消息。";
  } else if (!selectedUser) {
    if (titleNode) titleNode.textContent = targetUsername;
    if (subNode)
      subNode.textContent =
        typingSummary || "暂未获取到该联系人的在线状态，历史消息仍会显示在这里。";
  } else {
    const subnet = safeText(selectedUser.subnetLabel || selectedUser.subnetKey);
    const detailBits = [selectedUser.online ? "在线" : "离线", selectedUser.username];
    if (subnet) {
      detailBits.push(subnet);
    }

    if (titleNode)
      titleNode.textContent = safeText(selectedUser.displayName) || selectedUser.username;
    if (subNode) subNode.textContent = typingSummary || detailBits.join(" · ");
  }

  const activeKey = inRoom ? roomConversationKey() : privateConversationKey(targetUsername);
  if (state.view === "chat") {
    clearUnreadCount(activeKey);
  }
  updateRoomUnreadBadge();
  renderRecentConversations();
  renderUserDirectory(state.collab.userDirectory);
  renderActiveConversation();
  markVisiblePrivateConversationRead();
  markVisibleRoomConversationRead();
}

function appendChatMessage(payload, options = {}) {
  const box = options.box || el("c_chat_box");
  if (!box) return;

  const row = document.createElement("div");
  const message = normalizeChatMessage(payload);
  const previous = options.previous ? normalizeChatMessage(options.previous) : null;
  const next = options.next ? normalizeChatMessage(options.next) : null;
  const username = message.username || "系统通知";
  const displayName = message.displayName || username;
  const avatar = avatarMark(message.avatar, displayName);
  const rawFrom = safeText(message.from || message.username);
  const isSystem = Boolean(message.system);
  const isSelf = !isSystem && rawFrom && rawFrom === state.collab.username;
  const groupedPrev = shouldGroupMessages(previous, message);
  const groupedNext = shouldGroupMessages(message, next);
  row.className = `chat-item${isSelf ? " self" : ""}${isSystem ? " system" : ""}${groupedPrev ? " grouped-prev" : ""}${groupedNext ? " grouped-next" : ""}`;
  if (message.id) {
    row.dataset.messageId = message.id;
  }

  const avatarNode = document.createElement("div");
  avatarNode.className = "chat-avatar";
  avatarNode.textContent = avatar;

  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap";

  const showAuthor = !isSystem && !isSelf && !groupedPrev && message.scope === "subnet";
  if (showAuthor) {
    const author = document.createElement("div");
    author.className = "chat-author";
    author.textContent = displayName;
    wrap.appendChild(author);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  const showReadState = isSelf && message.scope === "private" && !isSystem && !message.recalled;
  const readByUsers = normalizeReadBy(message.readBy).filter(
    (item) => item.username !== state.collab.username,
  );
  const showSubnetReadState =
    isSelf && message.scope === "subnet" && !isSystem && !message.recalled;
  const compactMeta = !message.recalled && message.attachments.length === 0 && !showSubnetReadState;
  if (compactMeta) {
    bubble.classList.add("compact-meta");
  }
  if (showReadState) {
    bubble.classList.add("has-read-state");
  }

  if (message.forwardedFrom?.from) {
    const forwardedNode = document.createElement("div");
    forwardedNode.className = "chat-forwarded";

    const forwardedTitle = document.createElement("strong");
    forwardedTitle.textContent = "转发消息";
    const forwardedMeta = document.createElement("span");
    forwardedMeta.textContent = message.forwardedFrom.displayName || message.forwardedFrom.from;

    forwardedNode.appendChild(forwardedTitle);
    forwardedNode.appendChild(forwardedMeta);
    bubble.appendChild(forwardedNode);
  }

  if (!message.recalled && message.replyTo?.id) {
    const replyNode = document.createElement("button");
    replyNode.type = "button";
    replyNode.className = "chat-reply-ref";

    const replyName = document.createElement("strong");
    replyName.textContent = message.replyTo.displayName || message.replyTo.from || "消息";
    const replyText = document.createElement("span");
    replyText.textContent = message.replyTo.preview || "原消息";

    replyNode.appendChild(replyName);
    replyNode.appendChild(replyText);
    replyNode.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      focusMessageById(message.replyTo.id);
    });
    bubble.appendChild(replyNode);
  }
  if (message.recalled) {
    const recalledNode = document.createElement("div");
    recalledNode.className = "chat-recalled-text";
    recalledNode.textContent = isSelf ? "你撤回了一条消息" : `${displayName} 撤回了一条消息`;
    bubble.appendChild(recalledNode);
  } else if (message.text) {
    const textNode = renderMessageRichText(message.text);
    textNode.classList.add("chat-bubble-text");
    if (compactMeta) {
      textNode.classList.add("compact-meta-text");
    }
    bubble.appendChild(textNode);

    const previewUrl = extractFirstUrl(message.text);
    const previewCard = buildMessageLinkPreview(previewUrl);
    if (previewCard) {
      bubble.appendChild(previewCard);
    }
  }

  for (const attachment of message.recalled ? [] : message.attachments) {
    if (attachment.kind === "image") {
      const media = document.createElement("button");
      media.type = "button";
      media.className = "chat-attachment chat-attachment-image";
      media.setAttribute("aria-label", attachment.name || "查看图片");
      media.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openChatImageLightbox(attachment.dataUrl, attachment.name || "聊天图片");
      });

      const img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = attachment.name || "图片";
      media.appendChild(img);

      bubble.appendChild(media);
      continue;
    }

    const fileCard = document.createElement("a");
    fileCard.className = "chat-attachment chat-attachment-file";
    fileCard.href = dataUrlToDownloadHref(attachment.dataUrl);
    fileCard.download = attachment.name || "file";
    fileCard.target = "_blank";
    fileCard.rel = "noreferrer";

    const strong = document.createElement("strong");
    strong.textContent = attachment.name || "文件";
    const metaText = document.createElement("span");
    metaText.textContent = `${attachment.mime || "文件"}${attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}`;
    fileCard.appendChild(strong);
    fileCard.appendChild(metaText);
    bubble.appendChild(fileCard);
  }

  const footer = document.createElement("div");
  footer.className = "chat-bubble-footer";

  if (showReadState) {
    const readStateNode = document.createElement("span");
    readStateNode.className = `chat-status ${safeText(message.readAt) ? "read" : "unread"}`;
    readStateNode.textContent = safeText(message.readAt) ? "✓✓" : "✓";
    readStateNode.title = safeText(message.readAt) ? "已读" : "已送达";
    footer.appendChild(readStateNode);
  }

  if (showSubnetReadState && readByUsers.length) {
    const readStateNode = document.createElement("span");
    readStateNode.className = "chat-status group-read";
    const names = readByUsers.map((item) => item.displayName || item.username);
    const summary =
      names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等${names.length}人`;
    readStateNode.textContent = `${readByUsers.length}人已读`;
    readStateNode.title = `已读：${summary}`;
    footer.appendChild(readStateNode);

    const detailNode = document.createElement("span");
    detailNode.className = "chat-readers";
    detailNode.textContent = summary;
    footer.appendChild(detailNode);
  }

  const timeNode = document.createElement("span");
  timeNode.className = "chat-time";
  timeNode.textContent = formatTime(message.timestamp);
  footer.appendChild(timeNode);

  if (message.edited && !message.recalled) {
    const editNode = document.createElement("span");
    editNode.className = "chat-time chat-edited";
    editNode.textContent = "已编辑";
    footer.appendChild(editNode);
  }

  if (message.recalled) {
    const stateNode = document.createElement("span");
    stateNode.className = "chat-time";
    stateNode.textContent = "已撤回";
    footer.appendChild(stateNode);
  }

  bubble.appendChild(footer);
  wrap.appendChild(bubble);
  row.appendChild(avatarNode);
  row.appendChild(wrap);

  if (!isSystem && message.id && !message.recalled) {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const messageText = safeText(message.text);
      const items = [
        {
          label: "复制文本",
          disabled: !messageText,
          onClick: async () => {
            await copyTextToClipboard(messageText);
            showToast("已复制", "消息文本已复制到剪贴板。", "success");
          },
        },
        {
          label: "回复消息",
          onClick: () => setReplyDraftFromMessage(message),
        },
        {
          label: "转发消息",
          onClick: () => setForwardDraftFromMessage(message),
        },
      ];
      if (isSelf && messageText && !message.attachments.length) {
        items.push({
          label: "编辑消息",
          onClick: () => setEditDraftFromMessage(message),
        });
      }
      if (isSelf) {
        items.push({
          label: "双向删除",
          onClick: () => recallOwnMessage(message.id),
        });
      }
      showContextMenu(event.clientX, event.clientY, items, { anchorNode: row });
    });
  }

  box.appendChild(row);
  if (options.scroll !== false) {
    box.scrollTop = box.scrollHeight;
  }
}

function renderHistory(messages) {
  mergeConversationHistory(messages);
}

function latestHistoryCursor() {
  let latest = safeText(state.collab.lastHistorySyncAt);
  for (const items of state.collab.messagesByConversation.values()) {
    for (const item of items) {
      const candidate = messageActivityCursor(item);
      if (candidate && (!latest || candidate > latest)) {
        latest = candidate;
      }
    }
  }
  return latest;
}

function updateHistoryCursorFromMessage(message) {
  const candidate = messageActivityCursor(message);
  if (
    candidate &&
    (!state.collab.lastHistorySyncAt || candidate > state.collab.lastHistorySyncAt)
  ) {
    state.collab.lastHistorySyncAt = candidate;
  }
}

function getCollabResumePassword() {
  return String(state.collab.runtimePassword || state.collab.savedPassword || "");
}

function hasCollabResumeCredentials() {
  return Boolean(
    safeText(state.collab.serverUrl) &&
    safeText(state.collab.username) &&
    safeText(getCollabResumePassword()),
  );
}

function scheduleCollabReconnect(strategy = state.collab.reconnectStrategy || "socket") {
  if (
    state.collab.intentionalSocketClose ||
    state.collab.reconnectTimer ||
    (strategy === "socket" && !state.collab.token) ||
    (strategy === "relogin" && state.collab.silentReloginInFlight)
  ) {
    return;
  }

  state.collab.reconnectStrategy = strategy === "relogin" ? "relogin" : "socket";
  const delay = Math.min(12000, 1500 * Math.max(1, state.collab.reconnectAttempt + 1));
  state.collab.reconnectTimer = window.setTimeout(() => {
    state.collab.reconnectTimer = null;
    state.collab.reconnectAttempt += 1;
    if (state.collab.reconnectStrategy === "relogin") {
      logLine("collab", `正在尝试恢复登录（第 ${state.collab.reconnectAttempt} 次）`);
      attemptSilentCollabRelogin().catch((err) => {
        logLine("collab", `自动恢复登录失败：${err.message || err}`);
      });
      return;
    }

    logLine("collab", `正在尝试重新连接消息服务（第 ${state.collab.reconnectAttempt} 次）`);
    connectCollabWebSocket();
  }, delay);
}

function cancelCollabReconnect() {
  if (!state.collab.reconnectTimer) return;
  window.clearTimeout(state.collab.reconnectTimer);
  state.collab.reconnectTimer = null;
}

function closeCollabSocket() {
  state.collab.intentionalSocketClose = true;
  cancelCollabReconnect();
  state.collab.silentReloginInFlight = false;
  try {
    sendChatTyping(false);
  } catch {
    // ignore
  }
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
  clearAllConversationTyping({ render: false });
  state.collab.lastTypingSentAt = new Map();
  setRoomScope("-");
}

async function stopSenderBecauseAccountOffline(reason = "账号已下线") {
  if (state.mode === "receiver" || !window.api?.stopSender) return;

  const wasRunning = Boolean(state.status?.senderRunning);
  try {
    const status = await window.api.stopSender();
    if (status) {
      setStatus(status);
    }

    if (wasRunning) {
      const message = `${reason}，已自动关闭本机发送服务。`;
      logLine("sender", message);
      setPanelFeedback("s_feedback", message, "error");
    }
  } catch (err) {
    const message = `${reason}，但自动关闭发送服务失败：${err.message || err}`;
    logLine("sender", message);
    setPanelFeedback("s_feedback", message, "error");
  }
}

function requestStopSenderBecauseAccountOffline(reason) {
  stopSenderBecauseAccountOffline(reason).catch((err) => {
    logLine("sender", `账号下线保护失败：${err.message || err}`);
  });
}

function setCollabManualReloginRequired(message) {
  cancelCollabReconnect();
  requestStopSenderBecauseAccountOffline(message || "账号登录状态已失效");
  state.collab.connected = false;
  state.collab.token = "";
  state.collab.runtimePassword = "";
  state.app.updateInfo = null;
  state.collab.reconnectStrategy = "socket";
  state.collab.silentReloginInFlight = false;
  setCollabState("请重新登录");
  setCollabFeedback(message, "error");
  setCollabControls();
  refreshTopIdentity();
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
        throw new Error(
          `无法连接到服务地址：${url}。如果这里填的是本机地址，请先确认本机服务已经启动；如果服务在其他电脑上，请改成那台电脑的地址和端口。`,
        );
      }
      throw new Error(
        `无法连接到服务地址：${url}。请确认服务已经启动，地址和端口填写正确，并且网络可以访问。`,
      );
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshUserDirectory() {
  if (!state.collab.serverUrl || !state.collab.token) return;
  try {
    const response = await fetchWithFriendlyError(
      `${state.collab.serverUrl}/api/users`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${state.collab.token}`,
        },
      },
      6000,
    );

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
  const reason = notifyServer ? "账号已退出登录" : "账号已下线";

  closeCollabSocket();
  await stopSenderBecauseAccountOffline(reason);

  if (notifyServer && serverUrl && token) {
    try {
      await fetchWithFriendlyError(
        `${serverUrl}/api/logout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
        5000,
      );
    } catch {
      // ignore
    }
  }

  state.collab.token = "";
  state.collab.username = "";
  state.collab.displayName = "";
  state.collab.avatar = "";
  state.app.updateInfo = null;
  state.app.downloadedFilePath = "";
  state.collab.runtimePassword = "";
  state.collab.connected = false;
  state.collab.conversationFilter = "";
  state.collab.reconnectStrategy = "socket";
  state.collab.silentReloginInFlight = false;
  resetConversationState();
  resetPresenceState();
  state.gpt.totalQueries = 0;
  state.gpt.queryUsers = {};
  state.gpt.statsTotalQueries = 0;
  state.gpt.statsUsers = {};
  state.gpt.statsEntries = [];
  state.gpt.statsUserCount = 0;
  clearPendingAttachment();
  clearPendingInlineImage();
  if (el("c_chat_scope")) el("c_chat_scope").value = "subnet";
  if (el("c_chat_target")) el("c_chat_target").value = "";
  if (el("c_password")) {
    el("c_password").value = state.collab.rememberPassword ? state.collab.savedPassword : "";
  }
  if (el("c_chat_filter")) {
    el("c_chat_filter").value = "";
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
  cancelCollabReconnect();
  const expectedToken = safeText(state.collab.token);
  if (!expectedToken) {
    setCollabState("未登录");
    return;
  }
  state.collab.intentionalSocketClose = false;
  const wsUrl = `${toWsUrl(state.collab.serverUrl)}?token=${encodeURIComponent(expectedToken)}`;
  const ws = new WebSocket(wsUrl);
  let opened = false;
  state.collab.ws = ws;
  setCollabState("连接中");

  ws.onopen = () => {
    if (safeText(state.collab.token) !== expectedToken || state.collab.ws !== ws) {
      try {
        ws.close();
      } catch {}
      return;
    }
    opened = true;
    state.collab.reconnectAttempt = 0;
    state.collab.reconnectStrategy = "socket";
    state.collab.silentReloginInFlight = false;
    state.collab.connected = true;
    setCollabState("在线");
    setCollabControls();
    refreshTopIdentity();
    refreshUserDirectory();
    const since = latestHistoryCursor();
    ws.send(
      JSON.stringify({
        type: "history_sync",
        since,
      }),
    );
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
      markVisiblePrivateConversationRead();
      markVisibleRoomConversationRead();
      return;
    }

    if (payload.type === "history_sync") {
      mergeConversationHistory(payload.messages || []);
      if (payload.roomScope) {
        setRoomScope(payload.roomScope);
      }
      markVisiblePrivateConversationRead();
      markVisibleRoomConversationRead();
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

    if (payload.type === "chat_typing") {
      const scope = payload.scope === "private" ? "private" : "subnet";
      const from = safeText(payload.from);
      if (!from || from === state.collab.username) {
        return;
      }

      const conversationKey = typingConversationKey(scope, scope === "private" ? from : "");
      if (!payload.active) {
        clearConversationTyping(conversationKey);
      } else {
        setConversationTyping(conversationKey, payload);
      }
      return;
    }

    if (payload.type === "chat_recall") {
      if (payload.message) {
        storeConversationMessage(payload.message);
        updateRoomUnreadBadge();
        renderUserDirectory(state.collab.userDirectory);
        renderActiveConversation();
      }
      return;
    }

    if (payload.type === "chat_edit") {
      if (payload.message) {
        storeConversationMessage(payload.message);
        renderRecentConversations();
        renderUserDirectory(state.collab.userDirectory);
        renderActiveConversation();
      }
      return;
    }

    if (payload.type === "chat_read") {
      mergeConversationHistory(payload.messages || []);
      return;
    }

    if (payload.type === "system") {
      handleIncomingConversationMessage(
        buildSystemMessage(payload.text, {
          timestamp: payload.timestamp,
          scope: payload.scope || "subnet",
          subnetKey: payload.subnetKey,
          subnetLabel: payload.subnetLabel,
          roomScope: payload.roomScope || state.collab.roomScope,
        }),
      );
      return;
    }

    if (payload.type === "error") {
      handleIncomingConversationMessage(
        buildSystemMessage(payload.text, {
          timestamp: payload.timestamp,
          scope: currentChatScope() === "private" ? "private" : "subnet",
          to: safeText(el("c_chat_target")?.value),
          roomScope: state.collab.roomScope,
        }),
      );
    }
  };

  ws.onerror = () => {
    logLine("collab", "账号连接异常");
  };

  ws.onclose = (event) => {
    if (state.collab.ws === ws) {
      state.collab.ws = null;
    }
    state.collab.connected = false;
    clearAllConversationTyping();
    state.collab.lastTypingSentAt = new Map();
    const tokenStillCurrent = safeText(state.collab.token) === expectedToken;
    if (tokenStillCurrent && expectedToken) {
      setCollabState("连接断开");
    } else {
      setCollabState("未登录");
    }
    setCollabControls();
    refreshTopIdentity();
    logLine("collab", "账号连接已关闭");
    if (tokenStillCurrent && !state.collab.intentionalSocketClose) {
      if (event?.code === 4003) {
        setCollabManualReloginRequired("当前账号已在其他地方登录，请重新登录。");
        return;
      }
      if (event?.code === 4002) {
        if (hasCollabResumeCredentials()) {
          scheduleCollabReconnect("relogin");
        } else {
          setCollabManualReloginRequired("服务已重启，请重新登录。");
        }
        return;
      }
      if (opened) {
        scheduleCollabReconnect("socket");
      } else if (hasCollabResumeCredentials()) {
        scheduleCollabReconnect("relogin");
      } else {
        setCollabManualReloginRequired("服务连接已失效，请重新登录。");
      }
    }
  };
}

async function performCollabLogin({
  serverUrl,
  username,
  password,
  rememberPassword,
  silent = false,
}) {
  if (!serverUrl || !username || !password) {
    throw new Error("请先填写完整的服务地址、账号和密码");
  }

  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error("服务地址需要以 http:// 或 https:// 开头");
  }

  if (!silent) {
    setCollabState("登录中");
  }

  const response = await fetchWithFriendlyError(
    `${serverUrl}/api/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        client: getClientVersionPayload(),
      }),
    },
    10000,
  );

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
  state.collab.runtimePassword = password;
  state.collab.rememberPassword = rememberPassword;
  state.collab.savedPassword = rememberPassword ? password : "";
  state.collab.reconnectStrategy = "socket";
  state.collab.silentReloginInFlight = false;
  setRoomScope(payload?.roomScope);

  setCollabIdentity(state.collab.displayName || username);
  refreshTopIdentity();

  await saveSettings({ silent: true });
  try {
    await fetchClientBootstrap({ silent: true });
  } catch (err) {
    logLine("collab", `读取客户端配置失败：${err.message || err}`);
  }
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
  if (!silent) {
    setCollabFeedback("登录成功。", "success");
    state.view = "sender";
  }
  setCollabControls();
  return payload;
}

async function collabLogin() {
  const serverUrl = safeText(el("c_server_url")?.value).replace(/\/+$/, "");
  const username = safeText(el("c_username")?.value);
  const password = String(el("c_password")?.value || "");
  const rememberPassword = Boolean(el("c_remember_password")?.checked);
  await performCollabLogin({
    serverUrl,
    username,
    password,
    rememberPassword,
    silent: false,
  });
  connectCollabWebSocket();
}

async function attemptSilentCollabRelogin() {
  if (state.collab.silentReloginInFlight) {
    return;
  }

  const serverUrl = safeText(state.collab.serverUrl);
  const username = safeText(state.collab.username);
  const password = getCollabResumePassword();
  if (!serverUrl || !username || !password) {
    setCollabManualReloginRequired("服务已重启，请重新登录。");
    return;
  }

  state.collab.silentReloginInFlight = true;
  state.collab.connected = false;
  setCollabState("恢复连接中");
  setCollabControls();
  refreshTopIdentity();

  try {
    await performCollabLogin({
      serverUrl,
      username,
      password,
      rememberPassword: Boolean(state.collab.rememberPassword),
      silent: true,
    });
    setCollabFeedback("服务已恢复连接。", "success");
    connectCollabWebSocket();
  } catch (err) {
    state.collab.silentReloginInFlight = false;
    state.collab.connected = false;
    const message = err?.message || String(err);
    const needsManualRelogin = /401|403|账号|密码|登录失败|失效|未授权/i.test(message);
    if (needsManualRelogin) {
      setCollabManualReloginRequired("服务已重启，原登录状态已失效，请重新登录。");
      logLine("collab", `自动恢复登录失败：${message}`);
      return;
    }
    setCollabState("恢复连接中");
    setCollabFeedback("正在尝试恢复连接，请稍候。", "error");
    scheduleCollabReconnect("relogin");
    throw err;
  }
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

function recallOwnMessage(messageId) {
  const id = safeText(messageId);
  if (!id) return;

  if (
    !state.collab.connected ||
    !state.collab.ws ||
    state.collab.ws.readyState !== WebSocket.OPEN
  ) {
    setPanelFeedback("chat_feedback", "当前未连接消息服务，暂时无法撤回。", "error");
    return;
  }

  state.collab.ws.send(
    JSON.stringify({
      type: "chat_recall",
      messageId: id,
    }),
  );
}

function renderReplyDraft() {
  const wrap = el("c_reply_draft");
  const nameNode = el("c_reply_draft_name");
  const textNode = el("c_reply_draft_text");
  const reply = normalizeReplyTarget(state.collab.replyDraft);
  if (!wrap || !nameNode || !textNode) return;

  if (!reply) {
    wrap.hidden = true;
    nameNode.textContent = "";
    textNode.textContent = "";
    return;
  }

  wrap.hidden = false;
  nameNode.textContent = `回复 ${reply.displayName}`;
  textNode.textContent = reply.preview || "原消息";
}

function renderEditDraft() {
  const wrap = el("c_edit_draft");
  const nameNode = el("c_edit_draft_name");
  const textNode = el("c_edit_draft_text");
  const draft = state.collab.editDraft;
  if (!wrap || !nameNode || !textNode) return;

  if (!draft?.id) {
    wrap.hidden = true;
    nameNode.textContent = "";
    textNode.textContent = "";
    return;
  }

  wrap.hidden = false;
  nameNode.textContent = "编辑消息";
  textNode.textContent = draft.preview || "原消息";
}

function renderForwardDraft() {
  const wrap = el("c_forward_draft");
  const nameNode = el("c_forward_draft_name");
  const textNode = el("c_forward_draft_text");
  const draft = state.collab.forwardDraft;
  if (!wrap || !nameNode || !textNode) return;

  if (!draft?.id) {
    wrap.hidden = true;
    nameNode.textContent = "";
    textNode.textContent = "";
    return;
  }

  wrap.hidden = false;
  nameNode.textContent = `转发自 ${draft.displayName || draft.from || "消息"}`;
  textNode.textContent = draft.preview || "转发消息";
}

function clearReplyDraft(options = {}) {
  state.collab.replyDraft = null;
  renderReplyDraft();
  if (options.focus) {
    el("c_chat_input")?.focus();
  }
}

function clearEditDraft(options = {}) {
  state.collab.editDraft = null;
  renderEditDraft();
  if (options.resetInput && el("c_chat_input")) {
    el("c_chat_input").value = "";
    syncChatComposerLayout({ defer: true });
  }
  if (options.focus) {
    el("c_chat_input")?.focus();
  }
}

function clearForwardDraft(options = {}) {
  state.collab.forwardDraft = null;
  renderForwardDraft();
  if (options.focus) {
    el("c_chat_input")?.focus();
  }
}

function setReplyDraftFromMessage(message) {
  clearEditDraft();
  clearForwardDraft();
  const reply = createReplyDraftFromMessage(message);
  if (!reply) return;
  state.collab.replyDraft = reply;
  renderReplyDraft();
  el("c_chat_input")?.focus();
}

function setEditDraftFromMessage(message) {
  const normalized = normalizeChatMessage(message);
  if (!normalized.id || normalized.recalled || normalized.attachments.length) return;
  clearReplyDraft();
  clearForwardDraft();
  state.collab.editDraft = {
    id: normalized.id,
    preview: messagePreviewText(normalized),
  };
  if (el("c_chat_input")) {
    el("c_chat_input").value = normalized.text || "";
    resizeChatComposer();
    el("c_chat_input").focus();
    el("c_chat_input").setSelectionRange(
      el("c_chat_input").value.length,
      el("c_chat_input").value.length,
    );
  }
  renderEditDraft();
}

function setForwardDraftFromMessage(message) {
  const normalized = normalizeChatMessage(message);
  if (!normalized.id || normalized.recalled) return;
  clearReplyDraft();
  clearEditDraft();
  state.collab.forwardDraft = {
    id: normalized.id,
    from: normalized.from || normalized.username,
    displayName: normalized.displayName || normalized.username,
    preview: messagePreviewText(normalized),
    text: normalized.text,
    attachments: normalizeMessageAttachments(normalized.attachments),
  };
  renderForwardDraft();
  el("c_chat_input")?.focus();
}

function cancelComposerIntent() {
  if (state.collab.editDraft?.id) {
    clearEditDraft({ resetInput: true, focus: true });
    return true;
  }
  if (state.collab.replyDraft?.id) {
    clearReplyDraft({ focus: true });
    return true;
  }
  if (state.collab.forwardDraft?.id) {
    clearForwardDraft({ focus: true });
    return true;
  }
  return false;
}

function findLastOwnEditableMessage() {
  const conversationKey = currentConversationKey();
  const items = conversationKey
    ? state.collab.messagesByConversation.get(conversationKey) || []
    : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = normalizeChatMessage(items[index]);
    if (message.system || message.recalled) continue;
    if (safeText(message.from) !== state.collab.username) continue;
    if (message.attachments.length) continue;
    if (!safeText(message.text)) continue;
    return message;
  }
  return null;
}

function focusMessageById(messageId) {
  const id = safeText(messageId);
  if (!id) return;
  const row = document.querySelector(`#c_chat_box [data-message-id="${CSS.escape(id)}"]`);
  if (!(row instanceof HTMLElement)) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.add("chat-item-targeted");
  window.setTimeout(() => {
    row.classList.remove("chat-item-targeted");
  }, 1600);
}

function renderPendingAttachment() {
  const wrap = el("c_attachment_preview");
  const nameNode = el("c_attachment_name");
  const metaNode = el("c_attachment_meta");
  const thumbNode = el("c_attachment_thumb");
  const attachment = state.collab.pendingAttachment;

  if (!wrap || !nameNode || !metaNode || !thumbNode) return;

  if (!attachment) {
    wrap.hidden = true;
    nameNode.textContent = "";
    metaNode.textContent = "";
    thumbNode.textContent = "+";
    thumbNode.style.backgroundImage = "";
    return;
  }

  wrap.hidden = false;
  nameNode.textContent = attachment.name || (attachment.kind === "image" ? "图片" : "文件");
  metaNode.textContent = `${attachment.kind === "image" ? "图片" : "文件"}${attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}`;
  thumbNode.textContent = attachment.kind === "image" ? "" : "文";
  thumbNode.style.backgroundImage =
    attachment.kind === "image" ? `url("${attachment.dataUrl}")` : "";
}

function renderPendingInlineImage() {
  const wrap = el("c_inline_preview");
  const img = el("c_inline_preview_img");
  const nameNode = el("c_inline_preview_name");
  const metaNode = el("c_inline_preview_meta");
  const attachment = state.collab.pendingInlineImage;

  if (!wrap || !img || !nameNode || !metaNode) return;

  if (!attachment) {
    wrap.hidden = true;
    img.removeAttribute("src");
    nameNode.textContent = "";
    metaNode.textContent = "";
    syncChatComposerLayout({ defer: true });
    return;
  }

  wrap.hidden = false;
  img.src = attachment.dataUrl;
  nameNode.textContent = attachment.name || "粘贴图片";
  metaNode.textContent = `${attachment.mime || "图片"}${attachment.size ? ` · ${formatBytes(attachment.size)}` : ""}`;
  syncChatComposerLayout({ defer: true });
}

function clearPendingAttachment() {
  state.collab.pendingAttachment = null;
  if (el("c_chat_file")) {
    el("c_chat_file").value = "";
  }
  renderPendingAttachment();
}

function syncChatComposerLayout(options = {}) {
  const shell = el("c_chat_input_shell");
  if (shell) {
    shell.classList.toggle("has-inline-preview", Boolean(state.collab.pendingInlineImage));
  }

  const run = () => resizeChatComposer();
  if (options.defer) {
    window.requestAnimationFrame(run);
  } else {
    run();
  }
}

function clampChatImagePan() {
  const stage = el("chatImageLightboxStage");
  const image = el("chatImageLightboxImg");
  if (!(stage instanceof HTMLElement) || !(image instanceof HTMLImageElement)) return;

  const baseWidth = image.clientWidth;
  const baseHeight = image.clientHeight;
  if (!baseWidth || !baseHeight) {
    state.ui.chatImagePanX = 0;
    state.ui.chatImagePanY = 0;
    return;
  }

  const maxX = Math.max(0, (baseWidth * state.ui.chatImageZoom - stage.clientWidth) / 2);
  const maxY = Math.max(0, (baseHeight * state.ui.chatImageZoom - stage.clientHeight) / 2);

  state.ui.chatImagePanX = Math.min(maxX, Math.max(-maxX, state.ui.chatImagePanX));
  state.ui.chatImagePanY = Math.min(maxY, Math.max(-maxY, state.ui.chatImagePanY));
}

function openChatImageLightbox(dataUrl, altText = "聊天图片") {
  const overlay = el("chatImageLightbox");
  const image = el("chatImageLightboxImg");
  if (!overlay || !image) return;
  state.ui.chatImageZoom = 1;
  state.ui.chatImagePanX = 0;
  state.ui.chatImagePanY = 0;
  state.ui.chatImageDragging = false;
  state.ui.chatImagePointerId = null;
  image.src = safeText(dataUrl);
  image.alt = safeText(altText) || "聊天图片";
  overlay.hidden = false;
  syncChatImageZoom();
}

function closeChatImageLightbox() {
  const overlay = el("chatImageLightbox");
  const image = el("chatImageLightboxImg");
  if (!overlay || !image) return;
  overlay.hidden = true;
  image.removeAttribute("src");
  state.ui.chatImageZoom = 1;
  state.ui.chatImagePanX = 0;
  state.ui.chatImagePanY = 0;
  state.ui.chatImageDragging = false;
  state.ui.chatImagePointerId = null;
  syncChatImageZoom();
}

function syncChatImageZoom() {
  const stage = el("chatImageLightboxStage");
  const image = el("chatImageLightboxImg");
  const zoomNode = el("chatImageLightboxZoom");
  clampChatImagePan();
  if (image) {
    image.style.transform = `translate3d(${state.ui.chatImagePanX}px, ${state.ui.chatImagePanY}px, 0) scale(${state.ui.chatImageZoom})`;
  }
  if (zoomNode) {
    zoomNode.textContent = `${Math.round(state.ui.chatImageZoom * 100)}%`;
  }
  if (stage) {
    stage.classList.toggle("is-draggable", state.ui.chatImageZoom > 1);
    stage.classList.toggle("is-dragging", Boolean(state.ui.chatImageDragging));
  }
}

function adjustChatImageZoom(delta) {
  const next = Math.min(
    CHAT_IMAGE_ZOOM_MAX,
    Math.max(CHAT_IMAGE_ZOOM_MIN, Number((state.ui.chatImageZoom + delta).toFixed(2))),
  );
  state.ui.chatImageZoom = next;
  if (next <= 1) {
    state.ui.chatImagePanX = 0;
    state.ui.chatImagePanY = 0;
  }
  syncChatImageZoom();
}

function beginChatImageDrag(event) {
  if (state.ui.chatImageZoom <= 1) return;
  state.ui.chatImageDragging = true;
  state.ui.chatImagePointerId = event.pointerId;
  state.ui.chatImageDragStartX = event.clientX;
  state.ui.chatImageDragStartY = event.clientY;
  state.ui.chatImageDragOriginX = state.ui.chatImagePanX;
  state.ui.chatImageDragOriginY = state.ui.chatImagePanY;
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  syncChatImageZoom();
}

function moveChatImageDrag(event) {
  if (!state.ui.chatImageDragging || state.ui.chatImagePointerId !== event.pointerId) return;
  state.ui.chatImagePanX =
    state.ui.chatImageDragOriginX + (event.clientX - state.ui.chatImageDragStartX);
  state.ui.chatImagePanY =
    state.ui.chatImageDragOriginY + (event.clientY - state.ui.chatImageDragStartY);
  syncChatImageZoom();
}

function endChatImageDrag(event) {
  if (state.ui.chatImagePointerId !== null && event?.currentTarget?.releasePointerCapture) {
    try {
      event.currentTarget.releasePointerCapture(state.ui.chatImagePointerId);
    } catch {}
  }
  state.ui.chatImageDragging = false;
  state.ui.chatImagePointerId = null;
  syncChatImageZoom();
}

function clearPendingInlineImage() {
  state.collab.pendingInlineImage = null;
  renderPendingInlineImage();
}

function sendChatPayload(payload) {
  if (
    !state.collab.connected ||
    !state.collab.ws ||
    state.collab.ws.readyState !== WebSocket.OPEN
  ) {
    throw new Error("消息服务尚未连接，请稍后再试。");
  }
  state.collab.ws.send(JSON.stringify(payload));
}

function setChatDropOverlayVisible(visible) {
  const overlay = el("c_chat_drop_overlay");
  if (!overlay) return;
  overlay.hidden = !visible;
}

function resetChatDropOverlay() {
  chatDropDragDepth = 0;
  setChatDropOverlayVisible(false);
}

function dragEventHasFiles(event) {
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes("Files");
}

function resizeChatComposer() {
  const input = el("c_chat_input");
  if (!(input instanceof HTMLTextAreaElement)) return;
  input.style.height = "0px";
  const nextHeight = Math.min(140, Math.max(32, input.scrollHeight));
  input.style.height = `${nextHeight}px`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function applyPendingAttachmentDescriptor(descriptor) {
  if (!descriptor?.dataUrl) return;
  if ((Number(descriptor.size) || 0) > CHAT_ATTACHMENT_MAX_BYTES) {
    setPanelFeedback(
      "chat_feedback",
      `文件不能超过 ${formatBytes(CHAT_ATTACHMENT_MAX_BYTES)}。`,
      "error",
    );
    return;
  }
  state.collab.pendingAttachment = {
    kind: descriptor.kind === "image" ? "image" : "file",
    name: safeText(descriptor.name) || "file",
    mime: safeText(descriptor.mime),
    size: Number(descriptor.size) || 0,
    dataUrl: String(descriptor.dataUrl || ""),
  };
  setPanelFeedback("chat_feedback", "");
  renderPendingAttachment();
}

function applyPendingInlineImageDescriptor(descriptor) {
  if (!descriptor?.dataUrl) return;
  if ((Number(descriptor.size) || 0) > CHAT_ATTACHMENT_MAX_BYTES) {
    setPanelFeedback(
      "chat_feedback",
      `图片不能超过 ${formatBytes(CHAT_ATTACHMENT_MAX_BYTES)}。`,
      "error",
    );
    return;
  }
  state.collab.pendingInlineImage = {
    kind: "image",
    name: safeText(descriptor.name) || "pasted-image.png",
    mime: safeText(descriptor.mime) || "image/png",
    size: Number(descriptor.size) || 0,
    dataUrl: String(descriptor.dataUrl || ""),
  };
  setPanelFeedback("chat_feedback", "");
  renderPendingInlineImage();
}

async function handleChatAttachmentFile(file) {
  if (!file) return;
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    setPanelFeedback(
      "chat_feedback",
      `文件不能超过 ${formatBytes(CHAT_ATTACHMENT_MAX_BYTES)}。`,
      "error",
    );
    if (el("c_chat_file")) {
      el("c_chat_file").value = "";
    }
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  applyPendingAttachmentDescriptor({
    kind: String(file.type || "").startsWith("image/") ? "image" : "file",
    name: file.name || "file",
    mime: file.type || "",
    size: file.size || 0,
    dataUrl,
  });
}

async function handleChatInlineImageFile(file) {
  if (!file) return;
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    setPanelFeedback(
      "chat_feedback",
      `图片不能超过 ${formatBytes(CHAT_ATTACHMENT_MAX_BYTES)}。`,
      "error",
    );
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  applyPendingInlineImageDescriptor({
    kind: "image",
    name: file.name || "pasted-image.png",
    mime: file.type || "image/png",
    size: file.size || 0,
    dataUrl,
  });
}

function sendChatMessage() {
  try {
    const input = el("c_chat_input");
    const text = safeText(input?.value);
    const attachment = state.collab.pendingAttachment;
    const inlineImage = state.collab.pendingInlineImage;
    const replyTo = normalizeReplyTarget(state.collab.replyDraft);
    const editDraft = state.collab.editDraft;
    const forwardDraft = state.collab.forwardDraft;

    const scope = currentChatScope();
    const target = safeText(el("c_chat_target")?.value);
    if (scope === "private" && !target) {
      throw new Error("请先从左侧联系人列表中选择一个联系人。");
    }

    if (editDraft?.id) {
      if (!text) {
        throw new Error("编辑后的消息内容不能为空。");
      }
      sendChatPayload({
        type: "chat_edit",
        messageId: editDraft.id,
        text,
      });
      if (input) input.value = "";
      sendChatTyping(false);
      clearEditDraft();
      syncChatComposerLayout({ defer: true });
      setPanelFeedback("chat_feedback", "");
      return;
    }

    if (!text && !attachment && !inlineImage && !forwardDraft?.id) return;

    if (text || attachment || inlineImage) {
      sendChatPayload({
        type: "chat",
        scope,
        to: scope === "private" ? target : "",
        text,
        replyTo,
        attachments: [attachment, inlineImage].filter(Boolean),
      });
    }

    if (forwardDraft?.id) {
      sendChatPayload({
        type: "chat",
        scope,
        to: scope === "private" ? target : "",
        text: safeText(forwardDraft.text),
        forwardedFrom: {
          from: forwardDraft.from,
          displayName: forwardDraft.displayName,
        },
        attachments: normalizeMessageAttachments(forwardDraft.attachments),
      });
    }

    if (input) input.value = "";
    clearReplyDraft();
    clearForwardDraft();
    clearPendingAttachment();
    clearPendingInlineImage();
    sendChatTyping(false);
    syncChatComposerLayout({ defer: true });
    setPanelFeedback("chat_feedback", "");
  } catch (err) {
    setPanelFeedback("chat_feedback", err.message || "发送失败", "error");
  }
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
  document.body.dataset.platform = window.api.platform || "unknown";
  applyTheme(state.ui.theme, { syncControls: true });

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
  if (window.api.onAppEvent) {
    window.api.onAppEvent((payload) => {
      if (safeText(payload?.type) !== "notification-click") return;
      openConversationFromNotification(payload);
    });
  }
  if (window.api.onAppUpdateProgress) {
    window.api.onAppUpdateProgress((payload) => {
      state.app.updateProgress = payload || null;
      updateAppUpdateProgress(state.app.updateProgress);
    });
  }

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.getAttribute("data-view-target") || "");
    });
  });

  if (el("s_fallback_mode")) {
    el("s_fallback_mode").addEventListener("change", refreshFallbackVisibility);
  }

  if (el("senderPanel")) {
    el("senderPanel")
      .querySelectorAll("input, select, textarea")
      .forEach((node) => {
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
    el("receiverPanel")
      .querySelectorAll("input, select, textarea")
      .forEach((node) => {
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
      setCollabFeedback(err.message || "导入失败", "error");
      logLine("app", `导入配置失败：${err.message || err}`);
    }
  };

  const handleImportUserData = async () => {
    try {
      const payload = await window.api.importUserData();
      if (!payload) return;
      if (payload.settings) {
        state.settings = payload.settings;
        fillForm(payload.settings);
      }
      hydrateConversationStore(payload.chatHistory, { reset: true });
      renderPendingAttachment();
      setCollabFeedback("本机资料包已导入。", "success");
      logLine("app", `已导入本机资料包：${payload.filePath || "未知位置"}`);
    } catch (err) {
      setCollabFeedback(err.message || "导入资料包失败", "error");
      logLine("app", `导入资料包失败：${err.message || err}`);
    }
  };

  const handleExportUserData = async () => {
    try {
      const payload = await window.api.exportUserData();
      if (!payload?.filePath) return;
      setCollabFeedback("本机资料包已导出。", "success");
      logLine("app", `已导出本机资料包：${payload.filePath}`);
    } catch (err) {
      setCollabFeedback(err.message || "导出资料包失败", "error");
      logLine("app", `导出资料包失败：${err.message || err}`);
    }
  };

  if (el("btnSetupGuideImport"))
    el("btnSetupGuideImport").addEventListener("click", handleImportConfig);
  if (el("btnCollabImport")) el("btnCollabImport").addEventListener("click", handleImportConfig);
  if (el("btnImportSender")) el("btnImportSender").addEventListener("click", handleImportConfig);
  if (el("btnImportUserData"))
    el("btnImportUserData").addEventListener("click", handleImportUserData);
  if (el("btnExportUserData"))
    el("btnExportUserData").addEventListener("click", handleExportUserData);

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

  if (el("c_notify_system_notification")) {
    el("c_notify_system_notification").addEventListener("change", () => {
      state.collab.notifySystemNotification = Boolean(el("c_notify_system_notification")?.checked);
      persistCollabPreferences().catch((err) => {
        logLine("collab", `保存系统通知设置失败：${err.message || err}`);
      });
    });
  }

  if (el("c_notify_sound_play")) {
    el("c_notify_sound_play").addEventListener("change", () => {
      state.collab.notifySoundPlay = Boolean(el("c_notify_sound_play")?.checked);
      persistCollabPreferences().catch((err) => {
        logLine("collab", `保存铃声设置失败：${err.message || err}`);
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

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTheme = normalizeTheme(button.dataset.themeChoice);
      if (nextTheme === state.ui.theme) return;
      saveThemePreference(nextTheme);
    });
  });

  if (el("btnThemeQuickToggle")) {
    el("btnThemeQuickToggle").addEventListener("click", () => {
      const nextTheme = normalizeTheme(el("btnThemeQuickToggle")?.dataset.nextTheme || "");
      saveThemePreference(nextTheme);
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

  if (el("btnCheckAppUpdate")) {
    el("btnCheckAppUpdate").addEventListener("click", () => {
      checkAppUpdate().catch((err) => {
        setAppUpdateFeedback(err.message || String(err), "error");
      });
    });
  }

  if (el("btnInstallAppUpdate")) {
    el("btnInstallAppUpdate").addEventListener("click", () => {
      installAppUpdate().catch((err) => {
        setAppUpdateFeedback(err.message || String(err), "error");
      });
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
    const fromChatItem =
      target instanceof Element && Boolean(target.closest("#c_chat_box .chat-item"));
    const fromTopIdentity =
      target instanceof Element && Boolean(target.closest("#topCollabIdentity"));
    if (!insideMenu && !fromUserItem && !fromChatItem && !fromTopIdentity) {
      hideContextMenu();
    }
  });

  document.addEventListener(
    "scroll",
    () => {
      if (state.contextMenuOpen) hideContextMenu();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.contextMenuOpen) {
      hideContextMenu();
      return;
    }
    if (event.key === "Escape" && !el("chatImageLightbox")?.hidden) {
      closeChatImageLightbox();
      return;
    }
    if (event.key === "Escape" && cancelComposerIntent()) {
      event.preventDefault();
      sendChatTyping(Boolean(safeText(el("c_chat_input")?.value)));
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
      sendChatTyping(false);
      clearReplyDraft();
      clearEditDraft({ resetInput: true });
      clearForwardDraft();
      refreshPrivateTargets();
      syncChatComposerLayout({ defer: true });
      setPanelFeedback("chat_feedback", "");
    });
  }

  if (el("c_chat_target")) {
    el("c_chat_target").addEventListener("change", () => {
      sendChatTyping(false);
      clearReplyDraft();
      clearEditDraft({ resetInput: true });
      clearForwardDraft();
      syncChatConversation();
      syncChatComposerLayout({ defer: true });
      setPanelFeedback("chat_feedback", "");
    });
  }

  if (el("c_room_channel")) {
    el("c_room_channel").addEventListener("click", () => {
      pickRoomConversation();
    });
  }

  if (el("btnChatSidebarRecent")) {
    el("btnChatSidebarRecent").addEventListener("click", () => {
      setChatSidebarTab("recent");
    });
  }

  if (el("btnChatSidebarContacts")) {
    el("btnChatSidebarContacts").addEventListener("click", () => {
      setChatSidebarTab("contacts");
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

  if (el("btnChatImageLightboxClose")) {
    el("btnChatImageLightboxClose").addEventListener("click", () => {
      closeChatImageLightbox();
    });
  }

  if (el("chatImageLightbox")) {
    el("chatImageLightbox").addEventListener("click", (event) => {
      if (event.target === el("chatImageLightbox")) {
        closeChatImageLightbox();
      }
    });
  }

  if (el("chatImageLightboxStage")) {
    el("chatImageLightboxStage").addEventListener(
      "wheel",
      (event) => {
        if (el("chatImageLightbox")?.hidden) return;
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        adjustChatImageZoom(direction * CHAT_IMAGE_ZOOM_STEP);
      },
      { passive: false },
    );
    el("chatImageLightboxStage").addEventListener("pointerdown", (event) => {
      if (el("chatImageLightbox")?.hidden) return;
      beginChatImageDrag(event);
    });
    el("chatImageLightboxStage").addEventListener("pointermove", (event) => {
      moveChatImageDrag(event);
    });
    el("chatImageLightboxStage").addEventListener("pointerup", (event) => {
      endChatImageDrag(event);
    });
    el("chatImageLightboxStage").addEventListener("pointercancel", (event) => {
      endChatImageDrag(event);
    });
  }

  if (el("btnGptOpenExternal")) {
    el("btnGptOpenExternal").addEventListener("click", () => {
      const url = normalizeGptUrl(getActiveGptTab()?.url || state.gpt.lastUrl);
      openGptExternal(url).catch((err) => {
        setGptFeedback(`默认浏览器打开失败：${err.message || err}`, "error");
      });
    });
  }

  if (el("btnGptNewTab")) {
    el("btnGptNewTab").addEventListener("click", () => {
      createGptTab().catch((err) => {
        setGptFeedback(err.message || String(err), "error");
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
      window.api
        .navigateAiWorkspace({ kind: "gpt", tabId: state.gpt.activeTabId, action: "back" })
        .catch((err) => {
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
      window.api
        .navigateAiWorkspace({ kind: "gpt", tabId: state.gpt.activeTabId, action: "forward" })
        .catch((err) => {
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

  if (el("btnReplyDraftClear")) {
    el("btnReplyDraftClear").addEventListener("click", () => {
      clearReplyDraft({ focus: true });
    });
  }

  if (el("btnEditDraftClear")) {
    el("btnEditDraftClear").addEventListener("click", () => {
      clearEditDraft({ resetInput: true, focus: true });
      sendChatTyping(false);
    });
  }

  if (el("btnForwardDraftClear")) {
    el("btnForwardDraftClear").addEventListener("click", () => {
      clearForwardDraft({ focus: true });
      sendChatTyping(Boolean(safeText(el("c_chat_input")?.value)));
    });
  }

  if (el("btnChatAttach")) {
    el("btnChatAttach").addEventListener("click", () => {
      el("c_chat_file")?.click();
    });
  }

  if (el("btnAttachmentRemove")) {
    el("btnAttachmentRemove").addEventListener("click", () => {
      clearPendingAttachment();
    });
  }

  if (el("btnInlineAttachmentRemove")) {
    el("btnInlineAttachmentRemove").addEventListener("click", () => {
      clearPendingInlineImage();
      el("c_chat_input")?.focus();
    });
  }

  if (el("c_chat_file")) {
    el("c_chat_file").addEventListener("change", async (event) => {
      const input = event.currentTarget;
      const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
      if (!file) return;
      try {
        await handleChatAttachmentFile(file);
      } catch (err) {
        setPanelFeedback("chat_feedback", err.message || "读取文件失败", "error");
      } finally {
        if (input instanceof HTMLInputElement) {
          input.value = "";
        }
      }
    });
  }

  if (el("c_chat_input")) {
    el("c_chat_input").addEventListener("input", () => {
      setPanelFeedback("chat_feedback", "");
      syncChatComposerLayout();
      sendChatTyping(Boolean(safeText(el("c_chat_input")?.value)));
    });
    el("c_chat_input").addEventListener("paste", async (event) => {
      const clipboardItems = Array.from(event.clipboardData?.items || []);
      const imageItem = clipboardItems.find((item) => String(item.type || "").startsWith("image/"));
      const fileItem = clipboardItems.find((item) => item.kind === "file");
      try {
        if (imageItem || fileItem) {
          event.preventDefault();
          const file = imageItem?.getAsFile?.() || fileItem?.getAsFile?.();
          if (!file) return;
          if (String(file.type || "").startsWith("image/") && imageItem) {
            await handleChatInlineImageFile(file);
          } else {
            await handleChatAttachmentFile(file);
          }
        } else {
          const descriptor = await window.api.readClipboardAttachment?.();
          if (!descriptor?.dataUrl) return;
          event.preventDefault();
          if (descriptor.preferredMode === "inline-image" && descriptor.kind === "image") {
            applyPendingInlineImageDescriptor(descriptor);
          } else {
            applyPendingAttachmentDescriptor(descriptor);
          }
        }
      } catch (err) {
        setPanelFeedback("chat_feedback", err.message || "读取剪贴板内容失败", "error");
      }
    });
    el("c_chat_input").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (cancelComposerIntent()) {
          event.preventDefault();
          sendChatTyping(Boolean(safeText(el("c_chat_input")?.value)));
        }
        return;
      }

      if (
        event.key === "ArrowUp" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing &&
        !safeText(el("c_chat_input")?.value) &&
        !state.collab.pendingAttachment &&
        !state.collab.pendingInlineImage &&
        !state.collab.editDraft?.id
      ) {
        const lastOwnMessage = findLastOwnEditableMessage();
        if (lastOwnMessage) {
          event.preventDefault();
          setEditDraftFromMessage(lastOwnMessage);
        }
        return;
      }

      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendChatMessage();
      }
    });
  }

  const chatStage = document.querySelector(".chat-stage");
  if (chatStage instanceof HTMLElement) {
    chatStage.addEventListener("dragenter", (event) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      chatDropDragDepth += 1;
      setChatDropOverlayVisible(true);
    });
    chatStage.addEventListener("dragover", (event) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setChatDropOverlayVisible(true);
    });
    chatStage.addEventListener("dragleave", (event) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      chatDropDragDepth = Math.max(0, chatDropDragDepth - 1);
      if (chatDropDragDepth === 0) {
        setChatDropOverlayVisible(false);
      }
    });
    chatStage.addEventListener("drop", async (event) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      resetChatDropOverlay();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        await handleChatAttachmentFile(file);
      } catch (err) {
        setPanelFeedback("chat_feedback", err.message || "拖拽文件失败", "error");
      }
    });
  }

  document.addEventListener("dragover", (event) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (!dragEventHasFiles(event)) return;
    const insideChatStage =
      event.target instanceof Element && Boolean(event.target.closest(".chat-stage"));
    if (!insideChatStage) {
      event.preventDefault();
      resetChatDropOverlay();
    }
  });

  if (el("c_chat_filter")) {
    el("c_chat_filter").addEventListener("input", () => {
      state.collab.conversationFilter = safeText(el("c_chat_filter")?.value);
      renderRecentConversations();
      renderUserDirectory(state.collab.userDirectory);
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
  if (window.api.getAppMeta) {
    const meta = await window.api.getAppMeta();
    state.app.name = safeText(meta?.name) || "ShareGPT";
    state.app.version = safeText(meta?.version) || "";
    state.app.platform = safeText(meta?.platform) || "";
    state.app.arch = safeText(meta?.arch) || "";
  }
  bindAiWorkspaceEvents();
  initAiHostObservers();
  setChatSidebarTab(state.collab.chatSidebarTab);
  if (window.api?.listGptViews) {
    applyGptTabsPayload(await window.api.listGptViews());
  }

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
  const localChatHistory = await window.api.loadChatHistory();
  hydrateConversationStore(localChatHistory, { reset: true });
  setCollabState(state.collab.serverUrl ? "未登录" : "请填写服务地址");
  setRoomScope("-");
  setCollabIdentity("-");
  refreshTopIdentity();
  setUserDirectory([], { silent: true });
  setCollabControls();
  renderPendingAttachment();
  renderPendingInlineImage();
  renderReplyDraft();
  renderRecentConversations();
  syncChatComposerLayout();

  await window.api.getPaths();
  logLine("app", "程序已启动");

  const status = await window.api.getStatus();
  setStatus(status);
  scheduleAiHostsLayoutSync();
}

main().catch((err) => {
  logLine("app", `程序启动失败：${err.message || err}`);
});
