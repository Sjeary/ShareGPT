const state = {
  serverUrl: "",
  token: "",
  profile: null,
  users: [],
  selectedUsername: "",
  bootstrap: null,
  releaseDraft: {
    windows: null,
    macos: null,
  },
  releaseProgress: {
    windows: null,
    macos: null,
  },
  activeTab: "users",
};

const el = (id) => document.getElementById(id);

function safeText(value) {
  return String(value || "").trim();
}

function formatBytes(size) {
  const value = Math.max(0, Number(size) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClientVersion(client = {}) {
  const version = safeText(client.version);
  const platform = safeText(client.platform);
  const arch = safeText(client.arch);
  const mode = safeText(client.mode);
  const parts = [];
  if (version) parts.push(`v${version}`);
  if (platform) parts.push(platform);
  if (arch) parts.push(arch);
  if (mode) parts.push(mode);
  return parts.length ? parts.join(" · ") : "未知版本";
}

function setFeedback(id, text = "", tone = "") {
  const node = el(id);
  if (!node) return;
  const message = safeText(text);
  node.hidden = !message;
  node.textContent = message;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

async function fetchJson(pathname, options = {}) {
  const serverUrl = safeText(state.serverUrl).replace(/\/+$/, "");
  const response = await fetch(`${serverUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `请求失败（${response.status}）`);
  }
  return text ? JSON.parse(text) : {};
}

function setLoginMode(isLoggedIn) {
  document.body.classList.toggle("is-authenticated", isLoggedIn);
  document.body.classList.toggle("is-guest", !isLoggedIn);
  el("loginShell").hidden = isLoggedIn;
  el("dashboardShell").hidden = !isLoggedIn;
  el("serverMeta").textContent = isLoggedIn ? state.serverUrl : "未连接服务器";
  el("adminMeta").textContent = isLoggedIn
    ? `${safeText(state.profile?.displayName) || safeText(state.profile?.username) || "管理员"}`
    : "未登录";
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === tab);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tab);
  });
}

function renderUserList() {
  const list = el("userList");
  if (!list) return;
  list.textContent = "";

  if (!state.users.length) {
    const empty = document.createElement("div");
    empty.className = "user-item";
    empty.textContent = "当前还没有用户。";
    list.appendChild(empty);
    return;
  }

  for (const user of state.users) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `user-item${user.username === state.selectedUsername ? " active" : ""}`;

    const head = document.createElement("div");
    head.className = "user-item-head";
    head.innerHTML = `<strong>${user.displayName || user.username}</strong><span>${user.username}</span>`;

    const badges = document.createElement("div");
    badges.className = "user-badges";
    if (user.online) badges.innerHTML += `<span class="badge online">在线</span>`;
    if (user.isAdmin) badges.innerHTML += `<span class="badge admin">管理员</span>`;
    if (user.disabled) badges.innerHTML += `<span class="badge disabled">已禁用</span>`;
    badges.innerHTML += `<span class="badge version">${formatClientVersion(user.client)}</span>`;

    const bio = document.createElement("div");
    bio.textContent = user.bio || "暂无简介";

    const clientMeta = document.createElement("div");
    clientMeta.className = "user-client-meta";
    clientMeta.textContent = user.client?.reportedAt
      ? `客户端上报：${new Date(user.client.reportedAt).toLocaleString()}`
      : "客户端上报：暂无";

    item.appendChild(head);
    item.appendChild(badges);
    item.appendChild(bio);
    item.appendChild(clientMeta);
    item.addEventListener("click", () => {
      state.selectedUsername = user.username;
      fillEditUserForm(user);
      renderUserList();
    });
    list.appendChild(item);
  }
}

function fillEditUserForm(user) {
  el("editUserUsername").value = user?.username || "";
  el("editUserDisplayName").value = user?.displayName || "";
  el("editUserPassword").value = "";
  el("editUserAvatar").value = user?.avatar || "";
  el("editUserBio").value = user?.bio || "";
  el("editUserIsAdmin").checked = Boolean(user?.isAdmin);
  el("editUserDisabled").checked = Boolean(user?.disabled);
}

function loadBootstrapForm(data) {
  state.bootstrap = data || { sender: {}, update: {}, extra: {} };
  const sender = state.bootstrap.sender || {};
  const update = state.bootstrap.update || {};
  el("bootstrapProxyServer").value = sender.proxy_server || "";
  el("bootstrapProxyPort").value = sender.proxy_port || "";
  el("bootstrapProxyUuid").value = sender.proxy_uuid || "";
  el("bootstrapSocksPort").value = sender.socks_listen_port || "1080";
  el("bootstrapFallbackMode").value = sender.fallback_mode || "system_proxy";
  el("bootstrapFallbackLocalPort").value = sender.fallback_local_port || "";
  el("bootstrapTargetDomains").value = sender.target_domains || "";

  el("releaseVersion").value = update.version || "";
  el("releaseNotes").value = update.notes || "";
  el("releasePublishedAt").value = update.publishedAt || "";
  el("windowsCurrentUrl").textContent = `当前地址：${safeText(update?.windows?.url) || "未配置"}`;
  el("macosCurrentUrl").textContent = `当前地址：${safeText(update?.macos?.url) || "未配置"}`;
  el("extraJsonInput").value = JSON.stringify(state.bootstrap.extra || {}, null, 2);
}

function fillSenderBootstrapFields(sender = {}) {
  el("bootstrapProxyServer").value = safeText(sender.proxy_server);
  el("bootstrapProxyPort").value = safeText(sender.proxy_port);
  el("bootstrapProxyUuid").value = safeText(sender.proxy_uuid);
  el("bootstrapSocksPort").value = safeText(sender.socks_listen_port) || "1080";
  el("bootstrapFallbackMode").value = safeText(sender.fallback_mode) || "system_proxy";
  el("bootstrapFallbackLocalPort").value = safeText(sender.fallback_local_port);
  el("bootstrapTargetDomains").value = safeText(sender.target_domains);
}

function collectBootstrapPayload() {
  return {
    sender: {
      proxy_server: safeText(el("bootstrapProxyServer").value),
      proxy_port: safeText(el("bootstrapProxyPort").value),
      proxy_uuid: safeText(el("bootstrapProxyUuid").value),
      socks_listen_port: safeText(el("bootstrapSocksPort").value),
      fallback_mode: safeText(el("bootstrapFallbackMode").value) || "system_proxy",
      fallback_local_port: safeText(el("bootstrapFallbackLocalPort").value),
      target_domains: safeText(el("bootstrapTargetDomains").value),
    },
    update: {
      version: safeText(el("releaseVersion").value),
      notes: safeText(el("releaseNotes").value),
      publishedAt: safeText(el("releasePublishedAt").value),
      windows: state.bootstrap?.update?.windows || { url: "", fileName: "" },
      macos: state.bootstrap?.update?.macos || { url: "", fileName: "" },
    },
    extra: JSON.parse(el("extraJsonInput").value || "{}"),
  };
}

function setReleaseDraft(platformKey, fileInfo) {
  state.releaseDraft[platformKey] = fileInfo;
  el(`${platformKey}FileName`).textContent = fileInfo?.fileName || "未选择文件";
  el(`${platformKey}FileSize`).textContent = fileInfo ? formatBytes(fileInfo.size) : "-";
}

function renderReleaseProgress(platformKey, progress = null) {
  const block = el(`${platformKey}UploadProgress`);
  const textNode = el(`${platformKey}UploadProgressText`);
  const percentNode = el(`${platformKey}UploadProgressPercent`);
  const fill = el(`${platformKey}UploadProgressFill`);
  if (!block || !textNode || !percentNode || !fill) return;

  block.hidden = !progress;
  if (!progress) {
    fill.style.width = "0%";
    textNode.textContent = "准备上传";
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
  textNode.textContent = `${safeText(progress.fileName) || "安装包"} · ${formatBytes(transferred)} / ${total ? formatBytes(total) : "未知大小"}`;
}

async function login() {
  try {
    const serverUrl = safeText(el("serverUrlInput").value).replace(/\/+$/, "");
    const username = safeText(el("adminUsernameInput").value);
    const password = String(el("adminPasswordInput").value || "");
    if (!serverUrl || !username || !password) {
      throw new Error("请先填写完整的服务地址、管理员账号和密码");
    }

    const response = await fetch(`${serverUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `登录失败（${response.status}）`);
    }
    const payload = text ? JSON.parse(text) : {};

    state.serverUrl = serverUrl;
    state.token = safeText(payload.token);
    state.profile = payload.profile || null;
    await window.adminApi.savePrefs({ serverUrl, username });
    setLoginMode(true);
    await Promise.all([loadUsers(), loadBootstrap()]);
    setFeedback("loginFeedback", "");
  } catch (err) {
    setFeedback("loginFeedback", err.message || String(err), "error");
  }
}

async function setupFirstAdmin() {
  try {
    const serverUrl = safeText(el("serverUrlInput").value).replace(/\/+$/, "");
    const username = safeText(el("adminUsernameInput").value);
    const password = String(el("adminPasswordInput").value || "");
    if (!serverUrl || !username || !password) {
      throw new Error("请先填写服务地址、管理员账号和密码");
    }

    const response = await fetch(`${serverUrl}/api/admin/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName: username }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `初始化失败（${response.status}）`);
    }
    const payload = text ? JSON.parse(text) : {};
    state.serverUrl = serverUrl;
    state.token = safeText(payload.token);
    state.profile = payload.profile || null;
    await window.adminApi.savePrefs({ serverUrl, username });
    setLoginMode(true);
    await Promise.all([loadUsers(), loadBootstrap()]);
    setFeedback("loginFeedback", "管理员已初始化，可以直接开始管理服务器。", "success");
  } catch (err) {
    setFeedback("loginFeedback", err.message || String(err), "error");
  }
}

async function logout() {
  try {
    await fetchJson("/api/admin/logout", { method: "POST" });
  } catch {
    // ignore
  }
  state.token = "";
  state.profile = null;
  state.users = [];
  state.selectedUsername = "";
  setLoginMode(false);
}

async function loadUsers() {
  const payload = await fetchJson("/api/admin/users");
  state.users = Array.isArray(payload.users) ? payload.users : [];
  if (!state.selectedUsername && state.users.length) {
    state.selectedUsername = state.users[0].username;
  }
  const selected =
    state.users.find((item) => item.username === state.selectedUsername) || state.users[0] || null;
  fillEditUserForm(selected);
  renderUserList();
}

async function createUser() {
  try {
    const payload = {
      username: safeText(el("newUserUsername").value),
      displayName: safeText(el("newUserDisplayName").value),
      password: String(el("newUserPassword").value || ""),
      avatar: safeText(el("newUserAvatar").value),
      bio: safeText(el("newUserBio").value),
      isAdmin: Boolean(el("newUserIsAdmin").checked),
    };
    const result = await fetchJson("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setFeedback(
      "userCreateFeedback",
      `已创建用户 ${result.user?.username || payload.username}`,
      "success",
    );
    el("newUserUsername").value = "";
    el("newUserDisplayName").value = "";
    el("newUserPassword").value = "";
    el("newUserAvatar").value = "";
    el("newUserBio").value = "";
    el("newUserIsAdmin").checked = false;
    await loadUsers();
  } catch (err) {
    setFeedback("userCreateFeedback", err.message || String(err), "error");
  }
}

async function saveUser() {
  try {
    const username = safeText(el("editUserUsername").value);
    if (!username) throw new Error("请先从左侧选择一个用户");
    const payload = {
      displayName: safeText(el("editUserDisplayName").value),
      password: String(el("editUserPassword").value || ""),
      avatar: safeText(el("editUserAvatar").value),
      bio: safeText(el("editUserBio").value),
      isAdmin: Boolean(el("editUserIsAdmin").checked),
      disabled: Boolean(el("editUserDisabled").checked),
    };
    await fetchJson(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setFeedback("userEditFeedback", `已保存用户 ${username}`, "success");
    await loadUsers();
  } catch (err) {
    setFeedback("userEditFeedback", err.message || String(err), "error");
  }
}

async function loadBootstrap() {
  const payload = await fetchJson("/api/admin/bootstrap");
  loadBootstrapForm(payload);
  setFeedback("bootstrapFeedback", "已读取服务器端 Sender 默认配置。", "success");
}

async function useServerSuggestedSenderConfig() {
  try {
    const payload = await fetchJson("/api/admin/bootstrap");
    loadBootstrapForm(payload);
    setFeedback(
      "bootstrapFeedback",
      "已读取服务器端准备分发的 Sender 配置。点击保存后会写入服务器配置文件。",
      "success",
    );
  } catch (err) {
    setFeedback("bootstrapFeedback", err.message || String(err), "error");
  }
}

async function saveBootstrap() {
  try {
    const payload = collectBootstrapPayload();
    const result = await fetchJson("/api/admin/bootstrap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    loadBootstrapForm(result.bootstrap);
    setFeedback("bootstrapFeedback", "Sender 默认配置已保存。", "success");
    setFeedback("extraFeedback", "备用配置已保存。", "success");
  } catch (err) {
    setFeedback("bootstrapFeedback", err.message || String(err), "error");
  }
}

async function saveExtrasOnly() {
  try {
    const payload = collectBootstrapPayload();
    const result = await fetchJson("/api/admin/bootstrap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    loadBootstrapForm(result.bootstrap);
    setFeedback("extraFeedback", "备用配置已保存。", "success");
  } catch (err) {
    setFeedback("extraFeedback", err.message || String(err), "error");
  }
}

async function pickRelease(platformKey) {
  const fileInfo = await window.adminApi.selectReleaseFile();
  if (!fileInfo) return;
  setReleaseDraft(platformKey, fileInfo);
}

async function uploadRelease(platformKey) {
  try {
    const draft = state.releaseDraft[platformKey];
    if (!draft?.filePath) throw new Error("请先选择安装包文件");
    state.releaseProgress[platformKey] = {
      fileName: draft.fileName,
      transferred: 0,
      total: draft.size,
      percent: 0,
    };
    renderReleaseProgress(platformKey, state.releaseProgress[platformKey]);
    const result = await window.adminApi.uploadRelease({
      serverUrl: state.serverUrl,
      token: state.token,
      filePath: draft.filePath,
      platformKey,
      version: safeText(el("releaseVersion").value),
      notes: safeText(el("releaseNotes").value),
    });
    loadBootstrapForm(result.bootstrap);
    setFeedback(
      "releaseFeedback",
      `${platformKey === "windows" ? "Windows" : "macOS"} 安装包已上传。`,
      "success",
    );
  } catch (err) {
    setFeedback("releaseFeedback", err.message || String(err), "error");
  }
}

async function syncWindowMaxButton() {
  const maximized = await window.adminApi.isWindowMaximized();
  el("btnWinMax").dataset.maximized = maximized ? "true" : "false";
}

async function main() {
  if (document.body) {
    document.body.dataset.platform = window.adminApi.platform || "";
  }
  const prefs = await window.adminApi.loadPrefs();
  el("serverUrlInput").value = prefs.serverUrl || "";
  el("adminUsernameInput").value = prefs.username || "";

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tabTarget));
  });

  el("btnAdminLogin").addEventListener("click", login);
  el("btnAdminSetup").addEventListener("click", setupFirstAdmin);
  el("adminPasswordInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });
  el("btnAdminLogout").addEventListener("click", logout);

  el("btnRefreshUsers").addEventListener("click", () =>
    loadUsers().catch((err) =>
      setFeedback("userEditFeedback", err.message || String(err), "error"),
    ),
  );
  el("btnCreateUser").addEventListener("click", createUser);
  el("btnSaveUser").addEventListener("click", saveUser);
  el("btnReloadBootstrap").addEventListener("click", () =>
    loadBootstrap().catch((err) =>
      setFeedback("bootstrapFeedback", err.message || String(err), "error"),
    ),
  );
  el("btnUseServerSuggestedSender").addEventListener("click", useServerSuggestedSenderConfig);
  el("btnSaveBootstrap").addEventListener("click", saveBootstrap);
  el("btnReloadReleaseInfo").addEventListener("click", () =>
    loadBootstrap().catch((err) =>
      setFeedback("releaseFeedback", err.message || String(err), "error"),
    ),
  );
  el("btnSaveExtras").addEventListener("click", saveExtrasOnly);
  el("btnPickWindowsRelease").addEventListener("click", () => pickRelease("windows"));
  el("btnUploadWindowsRelease").addEventListener("click", () => uploadRelease("windows"));
  el("btnPickMacRelease").addEventListener("click", () => pickRelease("macos"));
  el("btnUploadMacRelease").addEventListener("click", () => uploadRelease("macos"));

  if (window.adminApi.onReleaseUploadProgress) {
    window.adminApi.onReleaseUploadProgress((payload) => {
      const platformKey = safeText(payload?.platformKey);
      if (platformKey !== "windows" && platformKey !== "macos") return;
      state.releaseProgress[platformKey] = payload || null;
      renderReleaseProgress(platformKey, state.releaseProgress[platformKey]);
    });
  }

  el("btnWinMin").addEventListener("click", () => window.adminApi.minimizeWindow());
  el("btnWinMax").addEventListener("click", async () => {
    await window.adminApi.toggleMaximizeWindow();
    await syncWindowMaxButton();
  });
  el("btnWinClose").addEventListener("click", () => window.adminApi.closeWindow());

  await syncWindowMaxButton();
  setLoginMode(false);
  setActiveTab("users");
  el("serverUrlInput").focus();
}

main().catch((err) => {
  setFeedback("loginFeedback", err.message || String(err), "error");
});
